// The caret daemon: a single Bun.serve that holds reviews in memory, serves the
// single-file UI, bridges the hook's long-poll to the browser's decision, and
// idle-auto-shuts-down when no reviews remain.

import { randomUUID } from "node:crypto";
import { createDecisions } from "./decisions.ts";
import { IDENTITY, idleMs as defaultIdleMs } from "./paths.ts";
import type { Store } from "./store.ts";
import { currentVersion, type Decision, type Review, toClientReview } from "./types.ts";

const PLACEHOLDER_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>caret</title></head><body><div id="app">caret daemon — UI not built yet</div></body></html>`;

/** Input accepted by POST /api/reviews. */
export interface PlanInput {
  sessionId?: string;
  cwd?: string;
  title?: string;
  plan?: string;
}

/** Decides whether an incoming plan starts a new review or appends a version.
 * Phase 5 ships the "always new thread" default; Phase 6 injects threading. */
export type RoutePlan = (input: PlanInput, store: Store) => Promise<{ id: string }>;

export interface CreateServerOptions {
  store: Store;
  port?: number;
  idleMs?: number;
  serveHtml?: () => string | Promise<string>;
  onShutdown?: () => void;
  routePlan?: RoutePlan;
}

export interface CaretServer {
  port: number;
  stop(): void;
}

/** Derive a human title from the plan's first heading / non-empty line. */
export function deriveTitle(plan: string): string {
  for (const line of plan.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed.replace(/^#+\s*/, "").slice(0, 120) || "Untitled plan";
  }
  return "Untitled plan";
}

/** Default routing: every incoming plan starts a new review thread. */
export const newThreadRoutePlan: RoutePlan = async (input, store) => {
  const id = randomUUID();
  const now = Date.now();
  const plan = input.plan ?? "";
  const review: Review = {
    id,
    sessionId: input.sessionId ?? `anon-${now}`,
    cwd: input.cwd ?? "",
    title: input.title?.trim() || deriveTitle(plan),
    status: "pending",
    planEpoch: 0,
    versions: [{ version: 1, plan, annotations: [], createdAt: now }],
    createdAt: now,
    updatedAt: now,
  };
  await store.create(review);
  return { id };
};

export function createServer(opts: CreateServerOptions): CaretServer {
  const { store } = opts;
  const idle = opts.idleMs ?? defaultIdleMs();
  const serveHtml = opts.serveHtml ?? (() => PLACEHOLDER_HTML);
  const onShutdown = opts.onShutdown ?? (() => process.exit(0));
  const routePlan = opts.routePlan ?? newThreadRoutePlan;
  const { awaitDecision, resolveDecision, clearDecision, openDecisionCount } = createDecisions();

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
    if (idleTimer || stopped || store.size() !== 0) return;
    idleTimer = setTimeout(maybeShutdown, idle);
  }
  // Arm on every 1→0 transition; cancel whenever a review exists.
  function refreshIdle() {
    if (store.size() === 0) armIdle();
    else cancelIdle();
  }
  function maybeShutdown() {
    idleTimer = null;
    // Re-check liveness atomically (single-threaded loop): never exit while a
    // review exists, a hook is mid-long-poll, or a request is in flight.
    if (store.size() === 0 && openDecisionCount() === 0 && inFlight === 0) {
      stop();
      onShutdown();
    } else if (store.size() === 0) {
      armIdle();
    }
  }

  function notFound() {
    return new Response("not found", { status: 404 });
  }

  const idRoute = /^\/api\/reviews\/([^/]+)(\/decision|\/resolve|\/annotations)?$/;

  async function handle(req: Request): Promise<Response> {
    inFlight++;
    try {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      if (method === "GET" && path === "/api/health") {
        return Response.json(IDENTITY);
      }

      if (method === "GET" && (path === "/" || path === "/index.html")) {
        return new Response(await serveHtml(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (method === "POST" && path === "/api/reviews") {
        cancelIdle();
        const body = (await req.json().catch(() => ({}))) as PlanInput;
        const result = await routePlan(body, store);
        refreshIdle();
        return Response.json(result);
      }

      if (method === "GET" && path === "/api/reviews") {
        return Response.json(store.list().map(toClientReview));
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
          cancelIdle();
          const decision = await awaitDecision(id);
          clearDecision(id);
          return Response.json(decision);
        }

        if (method === "PUT" && sub === "/annotations") {
          cancelIdle();
          const body = (await req.json().catch(() => ({}))) as {
            annotations?: Review["versions"][number]["annotations"];
          };
          const updated = await store.update(id, (r) => {
            currentVersion(r).annotations = body.annotations ?? [];
          });
          refreshIdle();
          return updated ? Response.json({ ok: true }) : notFound();
        }

        if (method === "POST" && sub === "/resolve") {
          cancelIdle();
          const body = (await req.json().catch(() => ({}))) as {
            behavior?: "allow" | "deny";
            feedback?: string;
            acceptMode?: Decision["acceptMode"];
          };
          if (!store.get(id)) return notFound();
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
          });
          // Approval is terminal — drop it from the active set so idle can fire.
          if (decision.behavior === "allow") await store.remove(id);
          refreshIdle();
          // Defer one tick so THIS 200 flushes before the hook's long-poll
          // resolves (otherwise the browser's POST can appear to race the unblock).
          setTimeout(() => resolveDecision(id, decision), 0);
          return Response.json({ ok: true });
        }
      }

      return notFound();
    } finally {
      inFlight--;
    }
  }

  const server = Bun.serve({ port: opts.port ?? 0, fetch: handle });

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelIdle();
    server.stop();
  }

  // Startup-if-empty: arm the idle timer when no reviews were rehydrated.
  refreshIdle();

  return { port: server.port, stop };
}
