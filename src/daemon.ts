// The caret daemon: a single Bun.serve that holds reviews in memory, serves the
// single-file UI, bridges the hook's long-poll to the browser's decision, and
// idle-auto-shuts-down when no reviews remain.

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createDecisions } from "./decisions.ts";
import { type CaretLogger, noopLogger, shortId } from "./log.ts";
import {
  type DaemonLock,
  heartbeatMs as defaultHeartbeatMs,
  IDENTITY,
  idleMs as defaultIdleMs,
  prefsFile,
} from "./paths.ts";
import { readApproveMode, writeApproveMode } from "./prefs.ts";
import { routeIncomingPlan } from "./reviews.ts";
import type { Store } from "./store.ts";
import {
  currentVersion,
  type Decision,
  isAcceptMode,
  type PlanInput,
  type Review,
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
) => Promise<{ id: string; expired?: string[] }>;

export interface CreateServerOptions {
  store: Store;
  port?: number;
  idleMs?: number;
  /** Decision long-poll heartbeat window (ms); defaults to paths.heartbeatMs(). */
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
  /** Leveled lifecycle logger (see log.ts CaretLogger); defaults to a no-op so
   * tests stay quiet. Lifecycle events log at info, handler failures at error. */
  log?: CaretLogger;
}

export interface CaretServer {
  port: number;
  stop(): void;
}

/** Reject mutating requests that aren't same-origin (loopback). The daemon has
 * no auth, so this is CSRF defense-in-depth: a hook/CLI request carries no
 * Origin (allowed); the same-origin browser UI carries a loopback Origin
 * (allowed); a page on another site carries a foreign Origin (blocked). */
export function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const host = new URL(origin).hostname;
      if (host !== "127.0.0.1" && host !== "localhost") return true;
    } catch {
      return true;
    }
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  return false;
}

// POST /api/logs caps and constraints. This route is a new trust boundary: the
// browser UI ships log events that get written through the daemon's CaretLogger,
// so the batch is structurally validated and its data sanitized before emit.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENTS = 100;
const MAX_MSG_LEN = 256;

export interface UiLogEvent {
  level: "debug" | "info" | "warn" | "error";
  step: string;
  msg: string;
  extra?: Record<string, unknown>;
}

const STEP_RE = /^[a-z][a-z0-9-]{0,31}$/;
// The record's own NDJSON fields: an extra key colliding with one of these would
// shadow the structural field, so they're stripped from client extra.
const RESERVED_KEYS = new Set(["level", "time", "msg", "step", "pid", "err"]);
// C0/C1 control chars except TAB (U+0009). Newline (U+000A) is stripped too:
// pino already JSON-escapes newlines at serialization, so this is defense in
// depth for raw-text consumers of the log (redact round-trips, crash-output
// interleaving, future sinks) — not the only thing preventing a forged record.
// Written with \u escapes (no literal control bytes in source): U+0000–U+0008,
// U+000A–U+001F, U+007F–U+009F.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the intent
const CONTROL_RE = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F]/g;

function sanitizeString(s: string): string {
  return s.replace(CONTROL_RE, "");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate the envelope/events structurally (any violation → whole-batch 400)
 * and sanitize each event's data (always applied, never a rejection). Exported
 * for direct testability. The raw-byte cap (413) stays in the route, which holds
 * the request text; here a >MAX_EVENTS count is the only 413 case. */
export function parseUiLogBatch(raw: unknown): { events: UiLogEvent[] } | { status: 400 | 413 } {
  if (!isPlainObject(raw) || !Array.isArray(raw.events)) return { status: 400 };
  if (raw.events.length > MAX_EVENTS) return { status: 413 };
  const events: UiLogEvent[] = [];
  for (const e of raw.events) {
    if (!isPlainObject(e)) return { status: 400 };
    const { level, step, msg, extra } = e;
    if (level !== "debug" && level !== "info" && level !== "warn" && level !== "error") {
      return { status: 400 };
    }
    if (typeof step !== "string" || !STEP_RE.test(step)) return { status: 400 };
    if (typeof msg !== "string") return { status: 400 };
    if (extra !== undefined && !isPlainObject(extra)) return { status: 400 };

    const safeExtra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (RESERVED_KEYS.has(k)) continue; // drop collisions with record fields
      safeExtra[k] = typeof v === "string" ? sanitizeString(v) : v;
    }
    // Forgery defense: the server is the sole authority on provenance, so force
    // source="ui" over any client-sent value.
    safeExtra.source = "ui";
    events.push({
      level,
      step,
      msg: sanitizeString(msg).slice(0, MAX_MSG_LEN),
      extra: safeExtra,
    });
  }
  return { events };
}

export function createServer(opts: CreateServerOptions): CaretServer {
  const { store } = opts;
  const idle = opts.idleMs ?? defaultIdleMs();
  const heartbeat = opts.heartbeatMs ?? defaultHeartbeatMs();
  const serveHtml = opts.serveHtml ?? (() => PLACEHOLDER_HTML);
  const onShutdown = opts.onShutdown ?? (() => process.exit(0));
  const routePlan = opts.routePlan ?? routeIncomingPlan;
  const prefsPath = opts.prefsPath ?? prefsFile();
  const lockPath = opts.lockPath;
  const buildId = opts.buildId;
  const log = opts.log ?? noopLogger;
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

  const idRoute = /^\/api\/reviews\/([^/]+)(\/decision|\/resolve|\/draft)?$/;

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

      if (method === "GET" && path === "/api/health") {
        // `build` is dropped from the JSON when buildId is undefined, so a
        // daemon with no build fingerprint reports the bare {service, version}.
        return Response.json({ ...IDENTITY, build: buildId });
      }

      // Graceful single-instance retire (EXC-406): a newer caret asks this
      // daemon to step down so it can take over the port. Loopback-guarded by
      // the cross-origin check above. Pending reviews are already write-through
      // to disk (store), so they rehydrate on the next daemon's start.
      if (method === "POST" && path === "/api/retire") {
        log.info("retire", "retire requested");
        // Defer one tick so this 200 flushes before stop()/onShutdown (which may
        // process.exit) — same pattern as the /resolve unblock below.
        setTimeout(() => {
          stop();
          onShutdown();
        }, 0);
        return new Response(null, { status: 200 });
      }

      if (method === "GET" && (path === "/" || path === "/index.html")) {
        return new Response(await serveHtml(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (method === "POST" && path === "/api/reviews") {
        const body = (await req.json().catch(() => ({}))) as PlanInput;
        // The router logs the review record (created vs appended) itself.
        const routed = await routePlan(body, store, log);
        // Drop superseded reviews' unsettled long-poll entries — their hooks
        // are gone, so nothing would ever settle them and they would pin
        // openDecisionCount, blocking idle shutdown forever (EXC-454).
        for (const staleId of routed.expired ?? []) clearDecision(staleId);
        return Response.json(routed);
      }

      // UI log bridge (EXC-445): the browser ships log events written through the
      // daemon's CaretLogger (leveling/redaction apply downstream). New trust
      // boundary — read the body ONCE to bound its size (diverges from the
      // .catch(() => ({})) style above, which can't measure the raw text), then
      // parse in a guarded try so a malformed body is a clean 400, not a 500.
      if (method === "POST" && path === "/api/logs") {
        // One warn per rejected batch (a recoverable oddity, not a failure) —
        // factored so the four reject sites can't drift apart.
        const reject = (status: 400 | 413) => {
          log.warn("ui", "ui log batch rejected", { status });
          return new Response(null, { status });
        };
        // Optimistic pre-read cap on the declared length; the post-read byte
        // count below is the authoritative check (headers can lie or be absent).
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
        // The accept path logs nothing of its own (noise rule) — only the
        // forwarded events. All four CaretLogger methods take (step, string,
        // extra?) here: error's String(err) on an already-sanitized string is
        // identity, so one dispatch covers every level.
        for (const ev of result.events) log[ev.level](ev.step, ev.msg, ev.extra);
        return new Response(null, { status: 204 });
      }

      if (method === "GET" && path === "/api/reviews") {
        return Response.json(store.list().map(toClientReview));
      }

      // Machine-global UI prefs, read once on UI load (deliberately not part of
      // the 2s /api/reviews poll). Fail-safe: returns "default" if unreadable.
      if (method === "GET" && path === "/api/prefs") {
        return Response.json({ approveMode: await readApproveMode(prefsPath, log) });
      }

      const m = path.match(idRoute);
      if (m) {
        const id = decodeURIComponent(m[1] as string);
        const sub = m[2];

        if (method === "GET" && !sub) {
          const r = store.get(id);
          return r ? Response.json(toClientReview(r)) : notFound();
        }

        if (method === "GET" && sub === "/decision") {
          // A decision may already be recorded: in memory (a deny keeps the
          // review) or on disk (an approve removed it from memory, or the daemon
          // restarted without rehydrating it). Serve it at once so a hook that
          // dropped its long-poll and reconnected still receives the decision.
          const inMem = store.get(id);
          if (inMem?.decision) {
            clearDecision(id);
            return Response.json(inMem.decision);
          }
          if (!inMem) {
            const disk = await store.persisted(id);
            if (disk?.decision) {
              // The reconnect-recovery path — rare and diagnostic gold when a
              // hook dropped its long-poll or the daemon restarted mid-review.
              log.debug("decision", `decision served from disk: ${shortId(id)}`, { reviewId: id });
              clearDecision(id);
              return Response.json(disk.decision);
            }
          }
          // Otherwise wait, but only to the heartbeat window, then 204 so the
          // client re-polls before any socket idle timeout closes the connection.
          const decision = await raceDecision(id, heartbeat);
          if (!decision) return new Response(null, { status: 204 });
          clearDecision(id);
          return Response.json(decision);
        }

        // Autosaves the reviewer's working draft: the version-scoped inline
        // annotations and the review-scoped general-comment draft. Each field is
        // independently optional so a draft-only write never wipes annotations
        // (and vice versa) — an omitted field is left alone.
        if (method === "PUT" && sub === "/draft") {
          const body = (await req.json().catch(() => ({}))) as {
            annotations?: Review["versions"][number]["annotations"];
            generalCommentDraft?: string;
          };
          const updated = await store.update(id, (r) => {
            // `!= null` so an absent OR null field is left alone — guarding null
            // keeps the old `?? []` null-safety (a stray null annotations would
            // otherwise persist and crash the client's `.map`).
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

        if (method === "POST" && sub === "/resolve") {
          const body = (await req.json().catch(() => ({}))) as {
            behavior?: "allow" | "deny";
            feedback?: string;
            acceptMode?: Decision["acceptMode"];
          };
          const existing = store.get(id);
          // Only a pending review can be resolved — guards against a double
          // resolve diverging the store from the decision the hook received.
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
            // Clear the unsent draft as part of resolving (both paths): a deny
            // keeps the review on disk as rejected and must not retain stale
            // text; an approve removes it (store.remove flushes "" first).
            r.generalCommentDraft = "";
          });
          // Approval is terminal: bump the session epoch (so a later plan is a
          // fresh thread) and drop it from the active set so idle can fire.
          if (decision.behavior === "allow") {
            store.bumpEpoch(existing.sessionId);
            await store.remove(id);
            // Remember the chosen mode for the UI's next load. Fire-and-forget:
            // never awaited, so it can't delay the 200 that unblocks the
            // long-polling hook. A bare allow (no acceptMode) leaves prefs as-is.
            if (isAcceptMode(decision.acceptMode)) {
              void writeApproveMode(decision.acceptMode, prefsPath, log).catch(() => {
                // Recoverable: prefs only seed the UI's next default.
                log.warn("prefs", "approve mode write failed");
              });
            }
          }
          // Defer one tick so THIS 200 flushes before the hook's long-poll
          // resolves (otherwise the browser's POST can appear to race the unblock).
          setTimeout(() => resolveDecision(id, decision), 0);
          log.info("resolve", `review ${shortId(id)} resolved: ${decision.behavior}`, {
            reviewId: id,
            sessionId: existing.sessionId,
            acceptMode: decision.acceptMode,
          });
          return Response.json({ ok: true });
        }
      }

      return notFound();
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
