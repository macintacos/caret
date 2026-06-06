// The caret daemon: a single Bun.serve that holds reviews in memory, serves the
// single-file UI, bridges the hook's long-poll to the browser's decision, and
// idle-auto-shuts-down when no reviews remain.

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { createDecisions } from "./decisions.ts";
import { type CaretLogger, noopLogger, shortId } from "./log.ts";
import { type DaemonLock, IDENTITY, prefsFile } from "./paths.ts";
import { readApproveMode, writeApproveMode } from "./prefs.ts";
import { routeIncomingPlan } from "./reviews.ts";
import { DEFAULTS } from "./settings.ts";
import type { Store } from "./store.ts";
import { MAX_BODY_BYTES, parseUiLogBatch } from "./ui-log-bridge.ts";
import {
  type AcceptMode,
  type Behavior,
  currentVersion,
  type Decision,
  type DraftBody,
  type HealthIdentity,
  isAcceptMode,
  type PlanInput,
  type ResolveBody,
  toClientReview,
} from "./types.ts";

const PLACEHOLDER_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>caret</title></head><body><div id="app">caret daemon — UI not built yet</div></body></html>`;

/** Decides whether an incoming plan starts a new review or appends a version.
 * The router owns the review record (created vs appended), so it receives the
 * daemon's logger. */
export type RoutePlan = (
  input: PlanInput,
  store: Store,
  log?: CaretLogger,
) => Promise<{ id: string; expired: string[] }>;

export interface CreateServerOptions {
  store: Store;
  port?: number;
  /** Idle auto-shutdown delay (ms); defaults to the schema default. runDaemon
   * passes the env/file-resolved value (settings.idleMs) captured at boot. */
  idleMs?: number;
  /** Decision long-poll heartbeat window (ms); defaults to the schema default.
   * runDaemon passes the env/file-resolved value (settings.heartbeatMs)
   * captured at boot. The pure defaults keep createServer free of config-file
   * reads, so tests stay hermetic. */
  heartbeatMs?: number;
  serveHtml?: () => string | Promise<string>;
  onShutdown?: () => void;
  routePlan?: RoutePlan;
  /** Path to the machine-global prefs file; defaults to paths.prefsFile(). */
  prefsPath?: string;
  /** Single-instance lock file path. When set, the daemon writes the lock on a
   * successful bind and removes it on stop(); omitted (default) means no lock is
   * managed, so existing call sites/tests are unaffected. */
  lockPath?: string;
  /** Build fingerprint (paths.buildHash of the served UI) reported in
   * /api/health and recorded in the lock, so a newer caret can detect staleness. */
  buildId?: string;
  /** Commit the server runs from (build-id.ts resolveCommit), reported in the listen
   * record so daemon.log ties a boot back to a source revision (EXC-452). */
  commit?: string;
  /** The daemon's resolved state dir — its world identity (EXC-461), reported
   * in /api/health and recorded in the lock so a hook can refuse to
   * cross-attach to a foreign world. Identifying (contains the username):
   * never logged — the listen record carries instanceId instead. */
  stateDir?: string;
  /** Per-boot opaque id (EXC-461). /api/health carries it for the UI's swap
   * detection; the lock and listen-record copies tie a lock file and a
   * daemon.log boot back to the same boot for diagnostics. Safe to log. */
  instanceId?: string;
  /** Leveled lifecycle logger (see log.ts CaretLogger); defaults to a no-op so
   * tests stay quiet. Lifecycle events log at info, handler failures at error. */
  log?: CaretLogger;
}

export interface CaretServer {
  port: number;
  stop(): void;
}

/** The vanity host the hook opens the review UI under (EXC-426). Resolves to
 * loopback per RFC 6761 (mDNSResponder system-wide; Chrome/Firefox special-case
 * it internally), so the 127.0.0.1 bind needs no change. */
export const VANITY_HOST = "caret.localhost";

/** Reject mutating requests that aren't same-origin (loopback). The daemon has
 * no auth, so this is CSRF defense-in-depth: a hook/CLI request carries no
 * Origin (allowed); the same-origin browser UI carries a loopback Origin
 * (allowed); a page on another site carries a foreign Origin (blocked). */
export function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const host = new URL(origin).hostname;
      if (host !== "127.0.0.1" && host !== "localhost" && host !== VANITY_HOST) return true;
    } catch {
      return true;
    }
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  return false;
}

// Request-body schemas at the browser trust boundary. They are deliberately
// lenient — a malformed body degrades to the schema's fallback rather than
// rejecting, matching the cast-and-trust behavior they replace. The win is a
// named boundary and per-field validation, not stricter rejection.

// POST /api/reviews: an incoming plan. Every field is optional and the whole
// object falls back to {} on a non-object body, mirroring the `req.json()
// .catch(() => ({}))` tolerance the body parser keeps — the router then defaults
// each absent field itself.
const PlanInputSchema: z.ZodType<PlanInput> = z
  .object({
    sessionId: z.string().optional(),
    cwd: z.string().optional(),
    title: z.string().optional(),
    plan: z.string().optional(),
  })
  .catch({});

const BehaviorSchema: z.ZodType<Behavior> = z.enum(["allow", "deny"]);
const AcceptModeSchema: z.ZodType<AcceptMode> = z.enum(["default", "acceptEdits", "auto"]);

// POST /api/reviews/:id/resolve. `behavior` falls back to "allow" unless the
// body explicitly says "deny" (fail-safe: an absent or garbled behavior never
// denies on its own). An unrecognized `acceptMode` degrades to undefined at the
// field, leaving the rest of the decision intact; the isAcceptMode guard
// downstream then decides which tokens seed prefs.
const ResolveBodySchema: z.ZodType<ResolveBody> = z
  .object({
    behavior: BehaviorSchema.catch("allow"),
    feedback: z.string().optional(),
    acceptMode: AcceptModeSchema.optional().catch(undefined),
  })
  .catch({ behavior: "allow" });

// PUT /api/reviews/:id/draft. Each field is independently optional; the handler
// leaves an absent field untouched (`!= null`), so a draft-only write never
// wipes annotations and vice versa. An explicit null normalizes to undefined so
// a malformed null payload is treated as absent, not a clobber.
const AnnotationSchema = z.object({
  id: z.string(),
  blockId: z.string(),
  startOffset: z.number(),
  endOffset: z.number(),
  quote: z.string(),
  comment: z.string(),
});
const nullToUndefined = <T>(v: T | null | undefined): T | undefined => v ?? undefined;
const DraftBodySchema: z.ZodType<DraftBody> = z
  .object({
    annotations: z.array(AnnotationSchema).nullish().transform(nullToUndefined),
    generalCommentDraft: z.string().nullish().transform(nullToUndefined),
  })
  .catch({ annotations: undefined, generalCommentDraft: undefined });

/** Parse a request body that may be malformed JSON. A JSON parse failure
 * degrades to `{}`; a body that fails the schema degrades to the schema's
 * `.catch` fallback — these routes never rejected a bad body, they tolerated
 * it. */
async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await req.json().catch(() => ({})));
}

/** The createServer options resolved against their defaults once, so the route
 * handlers and lifecycle close over a single config object instead of a dozen
 * destructured locals. */
interface ResolvedOptions {
  store: Store;
  idle: number;
  heartbeat: number;
  serveHtml: () => string | Promise<string>;
  onShutdown: () => void;
  routePlan: RoutePlan;
  prefsPath: string;
  lockPath: string | undefined;
  buildId: string | undefined;
  commit: string | undefined;
  stateDir: string | undefined;
  instanceId: string | undefined;
  log: CaretLogger;
}

function resolveOptions(opts: CreateServerOptions): ResolvedOptions {
  return {
    store: opts.store,
    idle: opts.idleMs ?? DEFAULTS.daemon.idle_ms,
    heartbeat: opts.heartbeatMs ?? DEFAULTS.daemon.heartbeat_ms,
    serveHtml: opts.serveHtml ?? (() => PLACEHOLDER_HTML),
    onShutdown: opts.onShutdown ?? (() => process.exit(0)),
    routePlan: opts.routePlan ?? routeIncomingPlan,
    prefsPath: opts.prefsPath ?? prefsFile(),
    lockPath: opts.lockPath,
    buildId: opts.buildId,
    commit: opts.commit,
    stateDir: opts.stateDir,
    instanceId: opts.instanceId,
    log: opts.log ?? noopLogger,
  };
}

// A request matched to one of the :id sub-routes, with the review id decoded and
// the optional sub-path (/decision, /resolve, /draft, /expire) split out.
interface IdRoute {
  id: string;
  sub: string | undefined;
}

const ID_ROUTE_RE = /^\/api\/reviews\/([^/]+)(\/decision|\/resolve|\/draft|\/expire)?$/;

/** Match an /api/reviews/:id[/sub] path, decoding the id; null for any other path. */
function matchIdRoute(path: string): IdRoute | null {
  const m = path.match(ID_ROUTE_RE);
  if (!m) return null;
  return { id: decodeURIComponent(m[1] as string), sub: m[2] };
}

export function createServer(opts: CreateServerOptions): CaretServer {
  const cfg = resolveOptions(opts);
  const { store, idle, heartbeat, serveHtml, onShutdown, routePlan, prefsPath, log } = cfg;
  const { buildId, commit, stateDir, instanceId, lockPath } = cfg;
  const { awaitDecision, resolveDecision, clearDecision, openDecisionCount } = createDecisions(log);

  // Wait for a decision but no longer than `ms` — resolves to null on timeout so
  // the handler can return a 204 heartbeat. The pending promise is left intact
  // (not settled or cleared) so the next poll reuses it.
  function raceDecision(id: string, ms: number): Promise<Decision | null> {
    return new Promise<Decision | null>((resolve) => {
      const t = setTimeout(() => resolve(null), ms);
      awaitDecision(id).then((d) => {
        clearTimeout(t);
        resolve(d);
      });
    });
  }

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = 0;
  let stopped = false;

  function cancelIdle() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }
  function armIdle() {
    if (idleTimer || stopped || store.pendingCount() !== 0) return;
    idleTimer = setTimeout(maybeShutdown, idle);
  }
  // Arm when no review is awaiting a decision; cancel while one is pending.
  // (A `rejected` review persists to disk and rehydrates when its revision
  // arrives, so it must not keep the daemon alive.)
  function refreshIdle() {
    if (store.pendingCount() === 0) armIdle();
    else cancelIdle();
  }
  function maybeShutdown() {
    idleTimer = null;
    // Re-check liveness atomically (single-threaded loop): never exit while a
    // review is pending, a hook is mid-long-poll, or a request is in flight.
    if (store.pendingCount() === 0 && openDecisionCount() === 0 && inFlight === 0) {
      log.info("idle", "idle shutdown");
      stop();
      onShutdown();
    } else if (store.pendingCount() === 0) {
      armIdle();
    }
  }

  function notFound() {
    return new Response("not found", { status: 404 });
  }

  // GET /api/health — the daemon's identity signature.
  function handleHealth(): Response {
    // Undefined fields are dropped from the JSON, so a daemon missing any
    // reports the bare {service, version}. `commit` is the commit this daemon
    // runs from (EXC-452), surfaced for a diagnostics client's discovery report;
    // stateDir (world) and instanceId (boot) are the EXC-461 identity fields
    // that let a hook and the UI tell daemons apart.
    const body: HealthIdentity = { ...IDENTITY, build: buildId, commit, stateDir, instanceId };
    return Response.json(body);
  }

  // POST /api/retire — graceful single-instance retire (EXC-406): a newer caret
  // asks this daemon to step down so it can take over the port. Loopback-guarded
  // by the cross-origin check in the wrapper. Pending reviews are already
  // write-through to disk (store), so they rehydrate on the next daemon's start.
  function handleRetire(): Response {
    log.info("retire", "retire requested");
    // Defer one tick so this 200 flushes before stop()/onShutdown (which may
    // process.exit) — same pattern as the /resolve unblock below.
    setTimeout(() => {
      stop();
      onShutdown();
    }, 0);
    return new Response(null, { status: 200 });
  }

  // GET / or /index.html — the single-file UI.
  async function handleHtml(): Promise<Response> {
    return new Response(await serveHtml(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // POST /api/reviews — an incoming plan from the hook.
  async function handleCreateReview(req: Request): Promise<Response> {
    const body = await parseBody(req, PlanInputSchema);
    // The router logs the review record (created vs appended) itself.
    const routed = await routePlan(body, store, log);
    // Drop superseded reviews' unsettled long-poll entries — their hooks have
    // given up (or will, at their own timeout), and a lingering unsettled entry
    // pins openDecisionCount, blocking idle shutdown (EXC-454). A still-polling
    // hook re-creates its entry per heartbeat, but that's bounded by its
    // timeout, whose /expire clears it for good.
    for (const staleId of routed.expired) clearDecision(staleId);
    return Response.json(routed);
  }

  // POST /api/logs — the UI log bridge (EXC-445): the browser ships log events
  // written through the daemon's CaretLogger (leveling/redaction apply
  // downstream). New trust boundary — read the body ONCE to bound its size (the
  // body parser's .catch tolerance can't measure the raw text), then parse in a
  // guarded try so a malformed body is a clean 400, not a 500.
  async function handleLogs(req: Request): Promise<Response> {
    // One warn per rejected batch (a recoverable oddity, not a failure) —
    // factored so the four reject sites can't drift apart.
    const reject = (status: 400 | 413) => {
      log.warn("ui", "ui log batch rejected", { status });
      return new Response(null, { status });
    };
    // Optimistic pre-read cap on the declared length; the post-read byte count
    // below is the authoritative check (headers can lie or be absent).
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reject(413);
    const text = await req.text();
    if (Buffer.byteLength(text, "utf-8") > MAX_BODY_BYTES) return reject(413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return reject(400);
    }
    const result = parseUiLogBatch(parsed);
    if ("status" in result) return reject(result.status);
    // The accept path logs nothing of its own (noise rule) — only the forwarded
    // events. All four CaretLogger methods take (step, string, extra?) here:
    // error's String(err) on an already-sanitized string is identity, so one
    // dispatch covers every level.
    for (const ev of result.events) log[ev.level](ev.step, ev.msg, ev.extra);
    return new Response(null, { status: 204 });
  }

  // GET /api/reviews — the pending list as client-facing shapes.
  function handleListReviews(): Response {
    return Response.json(store.list().map(toClientReview));
  }

  // GET /api/prefs — machine-global UI prefs, read once on UI load (deliberately
  // not part of the 2s /api/reviews poll). Fail-safe: returns "default" if
  // unreadable.
  async function handlePrefs(): Promise<Response> {
    return Response.json({ approveMode: await readApproveMode(prefsPath, log) });
  }

  // GET /api/reviews/:id — one review as its client-facing shape.
  function handleGetReview(id: string): Response {
    const r = store.get(id);
    return r ? Response.json(toClientReview(r)) : notFound();
  }

  // GET /api/reviews/:id/decision — the hook's long-poll for a decision.
  async function handleDecision(id: string): Promise<Response> {
    // A decision may already be recorded: in memory (a deny keeps the review) or
    // on disk (an approve removed it from memory, or the daemon restarted
    // without rehydrating it). Serve it at once so a hook that dropped its
    // long-poll and reconnected still receives the decision.
    const inMem = store.get(id);
    if (inMem?.decision) {
      clearDecision(id);
      return Response.json(inMem.decision);
    }
    if (!inMem) {
      const disk = await store.persisted(id);
      if (disk?.decision) {
        // The reconnect-recovery path — rare and diagnostic gold when a hook
        // dropped its long-poll or the daemon restarted mid-review.
        log.debug("decision", `decision served from disk: ${shortId(id)}`, { reviewId: id });
        clearDecision(id);
        return Response.json(disk.decision);
      }
    }
    // Otherwise wait, but only to the heartbeat window, then 204 so the client
    // re-polls before any socket idle timeout closes the connection.
    const decision = await raceDecision(id, heartbeat);
    if (!decision) return new Response(null, { status: 204 });
    clearDecision(id);
    return Response.json(decision);
  }

  // PUT /api/reviews/:id/draft — autosaves the reviewer's working draft: the
  // version-scoped inline annotations and the review-scoped general-comment
  // draft. Each field is independently optional so a draft-only write never
  // wipes annotations (and vice versa) — an omitted field is left alone.
  async function handleDraft(req: Request, id: string): Promise<Response> {
    const body: DraftBody = await parseBody(req, DraftBodySchema);
    const updated = await store.update(id, (r) => {
      // `!= null` so an absent OR null field is left alone — guarding null keeps
      // the old `?? []` null-safety (a stray null annotations would otherwise
      // persist and crash the client's `.map`).
      if (body.annotations != null) {
        currentVersion(r).annotations = body.annotations;
      }
      if (body.generalCommentDraft != null) {
        r.generalCommentDraft = body.generalCommentDraft;
      }
    });
    // Id only — draft/annotation text is reviewer prose and never logged.
    if (updated) log.debug("draft", `draft saved: ${shortId(id)}`, { reviewId: id });
    return updated ? Response.json({ ok: true }) : notFound();
  }

  // POST /api/reviews/:id/resolve — the browser's approve/deny decision.
  async function handleResolve(req: Request, id: string): Promise<Response> {
    const body: ResolveBody = await parseBody(req, ResolveBodySchema);
    const existing = store.get(id);
    // Only a pending review can be resolved — guards against a double resolve
    // diverging the store from the decision the hook received.
    if (!existing || existing.status !== "pending") return notFound();
    const decision: Decision = {
      behavior: body.behavior === "deny" ? "deny" : "allow",
      feedback: body.feedback,
      acceptMode: body.acceptMode,
      decidedAt: Date.now(),
    };
    // Persist the decision BEFORE unblocking the hook.
    await store.update(id, (r) => {
      r.decision = decision;
      r.status = decision.behavior === "allow" ? "approved" : "rejected";
      // Clear the unsent draft as part of resolving (both paths): a deny keeps
      // the review on disk as rejected and must not retain stale text; an
      // approve removes it (store.remove flushes "" first).
      r.generalCommentDraft = "";
    });
    // Approval is terminal: bump the session epoch (so a later plan is a fresh
    // thread) and drop it from the active set so idle can fire.
    if (decision.behavior === "allow") {
      store.bumpEpoch(existing.sessionId);
      await store.remove(id);
      // Remember the chosen mode for the UI's next load. Fire-and-forget: never
      // awaited, so it can't delay the 200 that unblocks the long-polling hook.
      // A bare allow (no acceptMode) leaves prefs as-is.
      if (isAcceptMode(decision.acceptMode)) {
        void writeApproveMode(decision.acceptMode, prefsPath, log).catch(() => {
          // Recoverable: prefs only seed the UI's next default.
          log.warn("prefs", "approve mode write failed");
        });
      }
    }
    // Defer one tick so THIS 200 flushes before the hook's long-poll resolves
    // (otherwise the browser's POST can appear to race the unblock).
    setTimeout(() => resolveDecision(id, decision), 0);
    log.info("resolve", `review ${shortId(id)} resolved: ${decision.behavior}`, {
      reviewId: id,
      sessionId: existing.sessionId,
      acceptMode: decision.acceptMode,
    });
    return Response.json({ ok: true });
  }

  // POST /api/reviews/:id/expire — the hook is abandoning this review: its
  // timeout fired and it is about to emit the fail-safe deny (EXC-454). No
  // decision is recorded and the session epoch is untouched: the plan was never
  // reviewed.
  async function handleExpire(id: string): Promise<Response> {
    // Drop any unsettled long-poll entry unconditionally — even when the review
    // is already gone, a zombie hook's entry would otherwise pin
    // openDecisionCount and block idle shutdown forever.
    clearDecision(id);
    const existing = store.get(id);
    // Only a pending review can expire; resolved ones are already terminal.
    if (!existing || existing.status !== "pending") return notFound();
    await store.expire(id);
    log.info("review", `review expired: ${shortId(id)}`, {
      reviewId: id,
      sessionId: existing.sessionId,
    });
    return Response.json({ ok: true });
  }

  // Resolve a request to its handler by method + path, returning the Response.
  // The wrapper (handle) owns the cross-origin guard, idle/in-flight bookkeeping,
  // and the catch-all 500; dispatch is pure routing + business logic.
  async function dispatch(req: Request, method: string, path: string): Promise<Response> {
    if (method === "GET" && path === "/api/health") return handleHealth();
    if (method === "POST" && path === "/api/retire") return handleRetire();
    if (method === "GET" && (path === "/" || path === "/index.html")) return handleHtml();
    if (method === "POST" && path === "/api/reviews") return handleCreateReview(req);
    if (method === "POST" && path === "/api/logs") return handleLogs(req);
    if (method === "GET" && path === "/api/reviews") return handleListReviews();
    if (method === "GET" && path === "/api/prefs") return handlePrefs();

    const route = matchIdRoute(path);
    if (route) {
      const { id, sub } = route;
      if (method === "GET" && !sub) return handleGetReview(id);
      if (method === "GET" && sub === "/decision") return handleDecision(id);
      if (method === "PUT" && sub === "/draft") return handleDraft(req, id);
      if (method === "POST" && sub === "/resolve") return handleResolve(req, id);
      if (method === "POST" && sub === "/expire") return handleExpire(id);
    }

    return notFound();
  }

  async function handle(req: Request): Promise<Response> {
    inFlight++;
    cancelIdle(); // any in-flight request defers an idle shutdown
    try {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      if ((method === "POST" || method === "PUT") && isCrossOrigin(req)) {
        return new Response("cross-origin request blocked", { status: 403 });
      }

      return await dispatch(req, method, path);
    } catch (err) {
      // Never let a handler exception drop the connection without a response —
      // and log it first (a genuine failure, so at error level), since a bare
      // 500 alone is undebuggable. The log call is itself wrapped so a broken
      // sink can't escape and suppress the 500.
      // NB: values reaching this sink must not embed plan bodies — today no
      // handler error message interpolates plan content; keep it that way.
      try {
        log.error("request", err);
      } catch {
        // best-effort: the response below is what matters.
      }
      return new Response("internal error", { status: 500 });
    } finally {
      inFlight--;
      // Reconcile idle after every request — even a thrown one — so the timer
      // is never left permanently disarmed.
      refreshIdle();
    }
  }

  // Bind to loopback only: the daemon serves plan content and accepts approve/
  // deny decisions with no auth, so it must never be reachable off-host.
  const server = Bun.serve({
    port: opts.port ?? 0,
    hostname: "127.0.0.1",
    // Well above the heartbeat window so a long-poll never idles out mid-wait.
    idleTimeout: 30,
    fetch: handle,
  });
  log.info("listen", `listening on 127.0.0.1:${server.port}`, {
    build: buildId,
    version: IDENTITY.version,
    commit,
    // instanceId only — stateDir is identifying and never reaches a log (EXC-461).
    instanceId,
  });

  // Write the single-instance lock atomically (temp + rename) so a concurrent
  // reader never sees a partial file. Best-effort: the lock is an optimization
  // for graceful takeover, not required to serve.
  function writeLock() {
    if (!lockPath) return;
    try {
      mkdirSync(dirname(lockPath), { recursive: true });
      // Typed against the reader's DaemonLock so the on-disk shape can't drift.
      const lock: DaemonLock = {
        pid: process.pid,
        port: server.port ?? 0,
        build: buildId,
        version: IDENTITY.version,
        startedAt: Date.now(),
        stateDir,
        instanceId,
      };
      const tmp = `${lockPath}.tmp.${process.pid}`;
      writeFileSync(tmp, JSON.stringify(lock));
      renameSync(tmp, lockPath);
    } catch {
      // ignore — a missing lock only forfeits graceful takeover, never serving.
    }
  }
  function removeLock() {
    if (!lockPath) return;
    try {
      unlinkSync(lockPath);
    } catch {
      // already gone — idempotent across the multiple exit paths.
    }
  }
  writeLock();

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelIdle();
    server.stop();
    removeLock();
  }

  // Startup-if-empty: arm the idle timer when no reviews were rehydrated.
  refreshIdle();

  return { port: server.port ?? 0, stop };
}
