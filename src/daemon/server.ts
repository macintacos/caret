// The caret daemon: a single Bun.serve that holds reviews in memory, serves the
// built UI (index document plus its hashed sibling assets), bridges the hook's
// long-poll to the browser's decision, and idle-auto-shuts-down when no reviews
// remain.

import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type DaemonLock, IDENTITY, isCompiledBinary } from "../lib/build-id.ts";
import { deriveIdleTimeoutSec } from "../config/constants.ts";
import { createDecisions } from "../review/decisions.ts";
import { type CaretLogger, noopLogger, shortId } from "../lib/log.ts";
import { ensureStateDir, prefsFile } from "../config/paths.ts";
import { readFileExcerpt, resolveFileInCwd } from "../plan/excerpt.ts";
import { type ApproveModeSet, readApproveMode, writeApproveMode } from "../config/prefs.ts";
import { routeIncomingPlan } from "../review/threading.ts";
import { DEFAULTS } from "../config/settings.ts";
import type { Store } from "../review/store.ts";
import type { UiAssets } from "../ui/assets.ts";
import { MAX_BODY_BYTES, parseUiLogBatch } from "../ui/log-bridge.ts";
import {
  type ApproveVariant,
  currentVersion,
  type Decision,
  type DraftBody,
  type HealthIdentity,
  type PlanInput,
  type ResolveBody,
  type RouteResult,
  toClientReview,
} from "../lib/types.ts";
import { isClientLive, isCrossOrigin, isSafeMethod, LIVE_CLIENT_WINDOW_MS } from "./guards.ts";
import {
  DraftBodySchema,
  FileRefsBodySchema,
  malformedLineAnchor,
  MAX_FILE_REFS,
  parseBody,
  PlanInputSchema,
  ResolveBodySchema,
} from "./schemas.ts";

const PLACEHOLDER_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>caret</title></head><body><div id="app">caret daemon — UI not built yet</div></body></html>`;

// The index document is served with no-cache so a redeploy never references stale
// hashed assets; hashed siblings under /assets/* are content-addressed, so they
// get a long immutable cache. (Vite's documented hashing guidance.)
const INDEX_CACHE_CONTROL = "no-cache";
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const INDEX_PATH = "/index.html";

/** Decides whether an incoming plan starts a new review or appends a version.
 * The router owns the review record (created vs appended), so it receives the
 * daemon's logger. */
export type RoutePlan = (input: PlanInput, store: Store, log?: CaretLogger) => Promise<RouteResult>;

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
  /** The resolved UI asset set (ui-assets.ts loadUiAssets): its URL paths form the
   * exact-match allowlist the daemon serves, and each path reads through Bun.file
   * (carrying its MIME). Omitted (default) means no UI — `GET /` serves the
   * built-in placeholder and every other UI path 404s, the posture existing tests
   * pin. */
  assets?: UiAssets;
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
  /** The active adapter's declared approve variants, published in /api/health so
   * the UI renders its approve split-button from the adapter capability. Omitted
   * (default) means the field is absent from the health body and the UI uses its
   * built-in fallback set. */
  approveVariants?: readonly ApproveVariant[];
  /** Leveled lifecycle logger (see log.ts CaretLogger); defaults to a no-op so
   * tests stay quiet. Lifecycle events log at info, handler failures at error. */
  log?: CaretLogger;
  /** Schedule the idle-shutdown timer; injectable so tests fire it deterministically
   * instead of racing a real delay. Defaults to setTimeout. (The idle timer is the
   * only one armed at boot with no request in flight, so it's the one a test must be
   * able to control — the long-poll heartbeat timer is always awaited inside a
   * request and never races test setup.) */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Cancel a scheduled idle-shutdown timer. Defaults to clearTimeout. */
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface CaretServer {
  port: number;
  stop(): void;
}

/** The createServer options resolved against their defaults once, so the route
 * handlers and lifecycle close over a single config object instead of a dozen
 * destructured locals. */
interface ResolvedOptions {
  store: Store;
  idle: number;
  heartbeat: number;
  assets: UiAssets | undefined;
  onShutdown: () => void;
  routePlan: RoutePlan;
  prefsPath: string;
  lockPath: string | undefined;
  buildId: string | undefined;
  commit: string | undefined;
  stateDir: string | undefined;
  instanceId: string | undefined;
  approveVariants: readonly ApproveVariant[] | undefined;
  log: CaretLogger;
}

function resolveOptions(opts: CreateServerOptions): ResolvedOptions {
  return {
    store: opts.store,
    idle: opts.idleMs ?? DEFAULTS.daemon.idle_ms,
    heartbeat: opts.heartbeatMs ?? DEFAULTS.daemon.heartbeat_ms,
    assets: opts.assets,
    onShutdown: opts.onShutdown ?? (() => process.exit(0)),
    routePlan: opts.routePlan ?? routeIncomingPlan,
    prefsPath: opts.prefsPath ?? prefsFile(),
    lockPath: opts.lockPath,
    buildId: opts.buildId,
    commit: opts.commit,
    stateDir: opts.stateDir,
    instanceId: opts.instanceId,
    approveVariants: opts.approveVariants,
    log: opts.log ?? noopLogger,
  };
}

// A request matched to one of the :id sub-routes, with the review id decoded and
// the optional sub-path (/decision, /resolve, /draft, /expire, /file-refs, /file)
// split out. /file-refs precedes /file in the alternation so the longer literal
// wins rather than /file matching its prefix.
interface IdRoute {
  id: string;
  sub: string | undefined;
}

const ID_ROUTE_RE =
  /^\/api\/reviews\/([^/]+)(\/decision|\/resolve|\/draft|\/expire|\/file-refs|\/file)?$/;

/** Match an /api/reviews/:id[/sub] path, decoding the id; null for any other path. */
function matchIdRoute(path: string): IdRoute | null {
  const m = path.match(ID_ROUTE_RE);
  if (!m) return null;
  return { id: decodeURIComponent(m[1] as string), sub: m[2] };
}

export function createServer(opts: CreateServerOptions): CaretServer {
  const cfg = resolveOptions(opts);
  const { store, idle, heartbeat, assets, onShutdown, routePlan, prefsPath, log } = cfg;
  const { buildId, commit, stateDir, instanceId, approveVariants, lockPath } = cfg;
  const { awaitDecision, resolveDecision, clearDecision, openDecisionCount } = createDecisions(log);

  // The set of approve-variant ids the resolve route and prefs persistence gate
  // on, derived from the active adapter's declared variants — the daemon stays
  // tool-agnostic, recognizing whatever the adapter declares rather than a baked
  // enum. The fallback is the first declared id (for the Claude adapter that is
  // "default"); a daemon with no declared variants recognizes only "default", so
  // a fresh /api/prefs still reads "default".
  const approveModeSet: ApproveModeSet =
    approveVariants && approveVariants.length > 0
      ? { valid: approveVariants.map((v) => v.id), fallback: approveVariants[0]?.id ?? "default" }
      : { valid: ["default"], fallback: "default" };

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

  // Idle-timer scheduling is injectable (default: real timers) so tests drive it
  // deterministically — see CreateServerOptions.setTimer. Read from opts directly,
  // like opts.port below, rather than threading through resolveOptions.
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = 0;
  let stopped = false;
  // Last time a UI client polled GET /api/reviews — the live-client signal the
  // hook reads to skip foregrounding the browser (EXC-559). 0 = never polled
  // (or retracted by a tab-close beacon, see handleUiGone).
  let lastReviewsPollAt = 0;
  // A UI tab counts as present while its last poll is within the live-client
  // window. Gates idle shutdown (EXC-562): a throttled-but-open tab must not get
  // the daemon shut from under it, since a respawn forgets the tab and the next
  // plan would open a redundant browser tab.
  const uiPresent = () => isClientLive(lastReviewsPollAt, Date.now(), LIVE_CLIENT_WINDOW_MS);

  function cancelIdle() {
    if (idleTimer) {
      clearTimer(idleTimer);
      idleTimer = null;
    }
  }
  function armIdle() {
    if (idleTimer || stopped || store.pendingCount() !== 0) return;
    idleTimer = setTimer(maybeShutdown, idle);
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
    // review is pending, a hook is mid-long-poll, a request is in flight, or a
    // UI tab is still present (EXC-562) — an open tab is the daemon's reason to
    // stay up. When only a UI holds it open the else-branch re-arms, so the
    // daemon shuts down once the tab goes away (its close beacon, or a poll that
    // ages past the live-client window).
    if (store.pendingCount() === 0 && openDecisionCount() === 0 && inFlight === 0 && !uiPresent()) {
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
    // that let a hook and the UI tell daemons apart. `approveVariants` is the
    // active adapter's declared approve set, which the UI renders its split-
    // button from (an absent field means the UI uses its built-in fallback).
    // `isDev` (EXC-556) drives the UI's "local build" badge — always a boolean
    // (a process-constant), so it's emitted unconditionally rather than dropped.
    const body: HealthIdentity = {
      ...IDENTITY,
      build: buildId,
      commit,
      stateDir,
      instanceId,
      isDev: !isCompiledBinary(),
      ...(approveVariants ? { approveVariants: [...approveVariants] } : {}),
    };
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

  // GET / or /index.html — the UI's index document, served with no-cache so a
  // redeploy never references stale hashed asset names. Falls back to the
  // built-in placeholder when no UI asset set was injected (dev / fresh checkout).
  function handleIndex(): Response {
    const file = assets?.file(INDEX_PATH);
    const body: BodyInit = file ?? PLACEHOLDER_HTML;
    return new Response(body, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": INDEX_CACHE_CONTROL,
      },
    });
  }

  // GET <path> for a non-index manifest key — a hashed sibling asset (JS/CSS/
  // fonts). The path must be an exact manifest key (the allowlist), never
  // resolved against the filesystem, so traversal is impossible by construction.
  // Bun.file carries the asset's MIME. Only content-addressed /assets/* names
  // earn the long immutable cache; any other served file (e.g. a public/-copied
  // favicon, not content-hashed) gets no-cache so a redeploy is re-fetched.
  // Returns null for an unknown path so dispatch falls through to its uniform 404.
  function handleAsset(path: string): Response | null {
    if (!assets) return null;
    const file = assets.file(path);
    if (!file) return null;
    const cache = path.startsWith("/assets/") ? ASSET_CACHE_CONTROL : INDEX_CACHE_CONTROL;
    return new Response(file, {
      headers: { "Cache-Control": cache },
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
    // A revision append re-pends a settled review; drop any orphaned registry
    // entry so the revision's long-poll awaits a fresh decision instead of
    // re-serving the prior one (EXC-590). routeIncomingPlan already cleared the
    // store decision (r.decision = undefined); this is its in-memory analog.
    if (routed.action === "append") clearDecision(routed.id);
    // Tell the hook whether a UI tab is already listening (polled recently): if
    // so it skips foregrounding the browser, so an open backgrounded tab's
    // away-gated desktop notification isn't pre-empted (EXC-559).
    const hasLiveClient = isClientLive(lastReviewsPollAt, Date.now(), LIVE_CLIENT_WINDOW_MS);
    return Response.json({ ...routed, hasLiveClient });
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

  // GET /api/reviews — the pending list as client-facing shapes. Doubles as the
  // live-client heartbeat: a UI polls this every ~2s, so stamping the time here
  // lets handleCreateReview tell the hook whether a tab is already listening
  // (EXC-559).
  function handleListReviews(): Response {
    lastReviewsPollAt = Date.now();
    return Response.json(store.list().map(toClientReview));
  }

  // POST /api/ui/gone — a UI tab announces it is closing (sent via
  // navigator.sendBeacon on pagehide). Retract its presence immediately so the
  // next plan foregrounds a fresh tab instead of assuming the closed one will
  // surface it (EXC-562). Clearing to 0 makes isClientLive read not-live at
  // once, which is what lets LIVE_CLIENT_WINDOW_MS stay long enough to outlast a
  // throttled background poll without a just-closed tab lingering as "live".
  // Presence is one shared timestamp, not per-tab: closing one of several open
  // tabs retracts the shared signal until a surviving tab's next poll re-stamps
  // it (≤2s foregrounded). Accepted for a single-user laptop — per-tab presence
  // tracking isn't worth its complexity for the rare two-tabs-open case.
  function handleUiGone(): Response {
    lastReviewsPollAt = 0;
    log.debug("ui", "ui presence retracted");
    return new Response(null, { status: 204 });
  }

  // GET /api/prefs — machine-global UI prefs, read once on UI load (deliberately
  // not part of the 2s /api/reviews poll). Fail-safe: returns "default" if
  // unreadable.
  async function handlePrefs(): Promise<Response> {
    return Response.json({ approveMode: await readApproveMode(prefsPath, log, approveModeSet) });
  }

  // GET /api/reviews/:id — one review as its client-facing shape.
  function handleGetReview(id: string): Response {
    const r = store.get(id);
    return r ? Response.json(toClientReview(r)) : notFound();
  }

  // POST /api/reviews/:id/file-refs — of the candidate filename strings the UI
  // parsed from this review's plan, which resolve to a real file inside the
  // review's cwd. Existence only (no reads): it drives the plan view's filename
  // icon, which must appear only for real files. Deduped and capped.
  async function handleFileRefs(req: Request, id: string): Promise<Response> {
    const r = store.get(id);
    if (!r) return notFound();
    const { paths } = await parseBody(req, FileRefsBodySchema);
    const seen = new Set<string>();
    const resolved: string[] = [];
    for (const p of paths.slice(0, MAX_FILE_REFS)) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (resolveFileInCwd(r.cwd, p) !== null) resolved.push(p);
    }
    log.debug("request", `file-refs resolved: ${resolved.length}/${seen.size}`, { reviewId: id });
    return Response.json({ resolved });
  }

  // GET /api/reviews/:id/file?path=&line= — a bounded, line-aware excerpt of a
  // plan-referenced file for the hover preview. Resolution is confined to the
  // review's cwd; a path that doesn't resolve (missing, or escaping cwd) is a
  // 404. File contents are never logged.
  function handleFileExcerpt(req: Request, id: string): Response {
    const r = store.get(id);
    if (!r) return notFound();
    const params = new URL(req.url).searchParams;
    const path = params.get("path") ?? "";
    const lineRaw = params.get("line");
    const line = lineRaw !== null && /^\d+$/.test(lineRaw) ? Number(lineRaw) : undefined;
    const excerpt = readFileExcerpt(r.cwd, path, line);
    return excerpt ? Response.json(excerpt) : notFound();
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
    const raw: unknown = await req.json().catch(() => ({}));
    const invalid = malformedLineAnchor(raw);
    if (invalid) return Response.json({ error: invalid }, { status: 400 });
    const body: DraftBody = DraftBodySchema.parse(raw);
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
      // Persist the current version's unsent composer scratches, version-scoped
      // alongside its annotations so a new plan version starts with neither; the
      // source view rehydrates them from the served ClientReview on load. Drop a
      // stale write: a scratch save whose debounce fired after a new version
      // arrived carries the version it was composed against, and its old line
      // anchors must not land on the current version (an omitted version writes,
      // for back-compat).
      const cur = currentVersion(r);
      if (
        body.composerScratches != null &&
        (body.version == null || body.version === cur.version)
      ) {
        cur.composerScratches = body.composerScratches;
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
    if (existing?.status !== "pending") return notFound();
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
      // Same invariant for the persisted composer scratches (version-scoped).
      currentVersion(r).composerScratches = [];
    });
    // Approval is terminal: bump the session epoch (so a later plan is a fresh
    // thread) and drop it from the active set so idle can fire.
    if (decision.behavior === "allow") {
      store.bumpEpoch(existing.sessionId);
      await store.remove(id);
      // Remember the chosen variant for the UI's next load. Fire-and-forget:
      // never awaited, so it can't delay the 200 that unblocks the long-polling
      // hook. A bare allow (no acceptMode) leaves prefs as-is; an id outside the
      // adapter-declared set is ignored by writeApproveMode.
      if (decision.acceptMode !== undefined && approveModeSet.valid.includes(decision.acceptMode)) {
        void writeApproveMode(decision.acceptMode, prefsPath, log, approveModeSet).catch(() => {
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
    if (existing?.status !== "pending") return notFound();
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
    if (method === "GET" && (path === "/" || path === INDEX_PATH)) return handleIndex();
    if (method === "POST" && path === "/api/reviews") return handleCreateReview(req);
    if (method === "POST" && path === "/api/logs") return handleLogs(req);
    if (method === "POST" && path === "/api/ui/gone") return handleUiGone();
    if (method === "GET" && path === "/api/reviews") return handleListReviews();
    if (method === "GET" && path === "/api/prefs") return handlePrefs();

    const route = matchIdRoute(path);
    if (route) {
      const { id, sub } = route;
      if (method === "GET" && !sub) return handleGetReview(id);
      if (method === "GET" && sub === "/file") return handleFileExcerpt(req, id);
      if (method === "POST" && sub === "/file-refs") return handleFileRefs(req, id);
      if (method === "GET" && sub === "/decision") return handleDecision(id);
      if (method === "PUT" && sub === "/draft") return handleDraft(req, id);
      if (method === "POST" && sub === "/resolve") return handleResolve(req, id);
      if (method === "POST" && sub === "/expire") return handleExpire(id);
    }

    // A hashed sibling asset (exact manifest-key match) — checked after the API
    // routes so a UI build can never shadow one. Unknown paths fall through to
    // the uniform 404.
    if (method === "GET") {
      const asset = handleAsset(path);
      if (asset) return asset;
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

      // Gate every non-safe (state-changing) method, not a fixed POST/PUT list,
      // so a future mutating verb is CSRF-protected by default. Safe methods
      // (GET/HEAD) fall through — the browser's same-origin policy already
      // blocks a foreign page from reading the response (see the guard's
      // threat-model note above).
      if (!isSafeMethod(method) && isCrossOrigin(req)) {
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
    // Derived from the heartbeat to sit strictly above it (and ≤ Bun's 255s
    // cap), so a long-poll's 204 heartbeat always ships before the socket can
    // idle out mid-wait — the invariant deriveIdleTimeoutSec holds by
    // construction (EXC-533).
    idleTimeout: deriveIdleTimeoutSec(heartbeat),
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
      ensureStateDir(dirname(lockPath));
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
