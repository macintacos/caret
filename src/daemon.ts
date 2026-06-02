// The caret daemon: a single Bun.serve that holds reviews in memory, serves the
// single-file UI, bridges the hook's long-poll to the browser's decision, and
// idle-auto-shuts-down when no reviews remain.

import { createDecisions } from "./decisions.ts";
import {
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

/** Decides whether an incoming plan starts a new review or appends a version. */
export type RoutePlan = (input: PlanInput, store: Store) => Promise<{ id: string }>;

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
  /** Lifecycle logger; defaults to a no-op so tests stay quiet. */
  log?: (msg: string) => void;
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

export function createServer(opts: CreateServerOptions): CaretServer {
  const { store } = opts;
  const idle = opts.idleMs ?? defaultIdleMs();
  const heartbeat = opts.heartbeatMs ?? defaultHeartbeatMs();
  const serveHtml = opts.serveHtml ?? (() => PLACEHOLDER_HTML);
  const onShutdown = opts.onShutdown ?? (() => process.exit(0));
  const routePlan = opts.routePlan ?? routeIncomingPlan;
  const prefsPath = opts.prefsPath ?? prefsFile();
  const log = opts.log ?? (() => {});
  const { awaitDecision, resolveDecision, clearDecision, openDecisionCount } = createDecisions();

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
      log("idle shutdown");
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
        return Response.json(IDENTITY);
      }

      if (method === "GET" && (path === "/" || path === "/index.html")) {
        return new Response(await serveHtml(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (method === "POST" && path === "/api/reviews") {
        const body = (await req.json().catch(() => ({}))) as PlanInput;
        const routed = await routePlan(body, store);
        log(`review created: ${routed.id}`);
        return Response.json(routed);
      }

      if (method === "GET" && path === "/api/reviews") {
        return Response.json(store.list().map(toClientReview));
      }

      // Machine-global UI prefs, read once on UI load (deliberately not part of
      // the 2s /api/reviews poll). Fail-safe: returns "default" if unreadable.
      if (method === "GET" && path === "/api/prefs") {
        return Response.json({ approveMode: await readApproveMode(prefsPath) });
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
        // (and vice versa) — a single field present-but-undefined is left alone.
        if (method === "PUT" && sub === "/draft") {
          const body = (await req.json().catch(() => ({}))) as {
            annotations?: Review["versions"][number]["annotations"];
            generalCommentDraft?: string;
          };
          const updated = await store.update(id, (r) => {
            if (body.annotations !== undefined) {
              currentVersion(r).annotations = body.annotations;
            }
            if (body.generalCommentDraft !== undefined) {
              r.generalCommentDraft = body.generalCommentDraft;
            }
          });
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
              void writeApproveMode(decision.acceptMode, prefsPath).catch(() => {});
            }
          }
          // Defer one tick so THIS 200 flushes before the hook's long-poll
          // resolves (otherwise the browser's POST can appear to race the unblock).
          setTimeout(() => resolveDecision(id, decision), 0);
          log(`review ${id} resolved: ${decision.behavior}`);
          return Response.json({ ok: true });
        }
      }

      return notFound();
    } catch (err) {
      // Never let a handler exception drop the connection without a response —
      // and log it first, since a bare 500 alone is undebuggable. The log call
      // is itself wrapped so a broken sink can't escape and suppress the 500.
      // NB: values reaching this sink must not embed plan bodies — today no
      // handler error message interpolates plan content; keep it that way.
      try {
        log(`request error: ${err}`);
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
  log(`listening on 127.0.0.1:${server.port}`);

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelIdle();
    server.stop();
  }

  // Startup-if-empty: arm the idle timer when no reviews were rehydrated.
  refreshIdle();

  return { port: server.port ?? 0, stop };
}
