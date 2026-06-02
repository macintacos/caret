#!/usr/bin/env bun
// caret hook CLI. Subcommands: daemon | prewarm | review.
//
// Phase-0 spike outcome encoded here: plan approval is gated through a
// PermissionRequest/ExitPlanMode hook. `review` blocks while the browser
// decides, then prints the PermissionRequest decision JSON (see feedback.ts).
//
// FAIL-SAFE = DENY: shipping an unreviewed plan is the one outcome we never
// allow. Every abnormal path (bad stdin, unreachable daemon, timeout, signal,
// daemon death) emits a deny — never an allow.

import { dirname } from "node:path";
import { createServer } from "./daemon.ts";
import { denyOutput, type HookOutput, toHookOutput } from "./feedback.ts";
import { getPort, reviewsDir, reviewTimeoutMs } from "./paths.ts";
import { createStore } from "./store.ts";
import type { Decision, PlanInput } from "./types.ts";

// ---------------------------------------------------------------------------
// Testable cores (dependency-injected)
// ---------------------------------------------------------------------------

export interface ReviewDeps {
  /** Ensure a daemon is up and return its base URL. */
  ensureDaemon: () => Promise<string>;
  postReview: (baseUrl: string, input: PlanInput) => Promise<{ id: string }>;
  longPoll: (baseUrl: string, id: string) => Promise<Decision>;
  openBrowser: (url: string) => void;
  timeoutMs: number;
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

interface HookStdin {
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  tool_input?: { plan?: string };
}

/** Run a review end-to-end, returning the hook output. Never throws — any
 * failure becomes a deny so an unreviewed plan can never ship. */
export async function runReview(stdin: string, deps: ReviewDeps): Promise<HookOutput> {
  try {
    let hook: HookStdin;
    try {
      hook = JSON.parse(stdin);
    } catch {
      throw new Error("could not parse hook stdin JSON");
    }
    const input: PlanInput = {
      sessionId: hook.session_id,
      cwd: hook.cwd,
      plan: hook.tool_input?.plan,
    };

    const baseUrl = await deps.ensureDaemon();
    const { id } = await deps.postReview(baseUrl, input);
    const url = `${baseUrl}/?review=${id}`;
    deps.openBrowser(url);
    // Also print the URL to stderr — clickable in the transcript if the browser
    // fails to open.
    process.stderr.write(`caret: review this plan at ${url}\n`);

    let decision: Decision;
    try {
      decision = await withTimeout(deps.longPoll(baseUrl, id), deps.timeoutMs, "review timed out");
    } catch (err) {
      if (err instanceof TimeoutError) throw err;
      // Daemon may have died mid-review — reconnect once before giving up.
      const reUrl = await deps.ensureDaemon();
      decision = await withTimeout(deps.longPoll(reUrl, id), deps.timeoutMs, "review timed out");
    }
    return toHookOutput(decision);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return denyOutput(`caret: ${msg} — denying so no unreviewed plan ships.`);
  }
}

export interface EnsureDeps {
  baseUrl: string;
  /** Returns the parsed /api/health body, or null if the connection refused. */
  health: (baseUrl: string) => Promise<{ service?: string } | null>;
  /** Spawn a detached daemon. May throw EADDRINUSE if it loses a race. */
  spawn: () => void;
  backoff: (attempt: number) => Promise<void>;
  maxAttempts: number;
}

function isAddrInUse(e: unknown): boolean {
  if (e && typeof e === "object" && "code" in e) {
    return (e as { code?: string }).code === "EADDRINUSE";
  }
  return e instanceof Error && /EADDRINUSE/.test(e.message);
}

/** Ensure a caret daemon owns the port, spawning one if needed. */
export async function ensureDaemon(deps: EnsureDeps): Promise<string> {
  for (let attempt = 0; attempt < deps.maxAttempts; attempt++) {
    const h = await deps.health(deps.baseUrl);
    if (h && h.service === "caret") return deps.baseUrl;
    if (h && h.service !== "caret") {
      throw new Error(`port is held by a non-caret process — set CARET_PORT to a free port`);
    }
    // Connection refused → try to start the daemon. A lost spawn race is fine:
    // swallow EADDRINUSE and re-poll, connecting to whichever instance won.
    try {
      deps.spawn();
    } catch (e) {
      if (!isAddrInUse(e)) throw e;
    }
    await deps.backoff(attempt);
  }
  throw new Error("caret daemon did not become healthy in time");
}

// ---------------------------------------------------------------------------
// Production dependency implementations
// ---------------------------------------------------------------------------

export async function httpHealth(baseUrl: string): Promise<{ service?: string } | null> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return null;
    return (await res.json()) as { service?: string };
  } catch {
    return null;
  }
}

function daemonCommand(): string[] {
  // Compiled binary: process.execPath IS the caret binary. Dev (`bun run
  // src/cli.ts`): re-invoke bun with the script path.
  const script = process.argv[1];
  if (script?.endsWith(".ts")) return [process.execPath, script, "daemon"];
  return [process.execPath, "daemon"];
}

function spawnDaemon(): void {
  Bun.spawn(daemonCommand(), {
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
    env: process.env,
  }).unref();
}

async function backoff(attempt: number): Promise<void> {
  const ms = Math.min(150 * 2 ** attempt, 1500) + Math.floor(Math.random() * 150);
  await Bun.sleep(ms);
}

async function postReview(baseUrl: string, input: PlanInput): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`POST /api/reviews failed: ${res.status}`);
  return (await res.json()) as { id: string };
}

async function longPoll(baseUrl: string, id: string): Promise<Decision> {
  const res = await fetch(`${baseUrl}/api/reviews/${id}/decision`);
  if (!res.ok) throw new Error(`decision long-poll failed: ${res.status}`);
  return (await res.json()) as Decision;
}

function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : ["xdg-open", url];
    Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] }).unref();
  } catch {
    // Best-effort: the stderr URL is the fallback.
  }
}

function prodEnsureDeps(): EnsureDeps {
  return {
    baseUrl: `http://localhost:${getPort()}`,
    health: httpHealth,
    spawn: spawnDaemon,
    backoff,
    maxAttempts: 12,
  };
}

function prodReviewDeps(): ReviewDeps {
  return {
    ensureDaemon: () => ensureDaemon(prodEnsureDeps()),
    postReview,
    longPoll,
    openBrowser,
    timeoutMs: reviewTimeoutMs(),
  };
}

// ---------------------------------------------------------------------------
// Subcommand entrypoints
// ---------------------------------------------------------------------------

/** Resolve the UI HTML: embedded asset → file beside the binary → undefined
 * (daemon then serves its built-in placeholder). */
async function loadUiHtml(): Promise<string | undefined> {
  try {
    const mod = await import("./ui-asset.ts");
    if (typeof mod.default === "string" && mod.default.length > 0) {
      return mod.default;
    }
  } catch {
    // UI not built / not embedded — fall through.
  }
  try {
    const beside = `${dirname(process.execPath)}/index.html`;
    const file = Bun.file(beside);
    if (await file.exists()) return await file.text();
  } catch {
    // ignore
  }
  return undefined;
}

async function runDaemon(): Promise<void> {
  const store = createStore(reviewsDir());
  await store.rehydrate();
  const html = await loadUiHtml();
  try {
    createServer({
      store,
      port: getPort(),
      serveHtml: html ? () => html : undefined,
    });
  } catch (e) {
    if (isAddrInUse(e)) {
      process.stderr.write("caret: another daemon won the port; exiting.\n");
      process.exit(0);
    }
    throw e;
  }
  // Bun.serve keeps the process alive; the daemon idle-auto-shuts-down.
}

async function runPrewarm(): Promise<void> {
  // Best-effort warm start; never blocks or denies (it's a PostToolUse hook).
  try {
    await ensureDaemon(prodEnsureDeps());
  } catch (e) {
    process.stderr.write(`caret prewarm: ${e}\n`);
  }
  process.exit(0);
}

async function runReviewSubcommand(): Promise<void> {
  const denyAndExit = (reason: string) => {
    process.stdout.write(`${JSON.stringify(denyOutput(reason))}\n`);
    process.exit(0);
  };
  process.once("SIGINT", () => denyAndExit("caret: interrupted (SIGINT) — denying to fail safe."));
  process.once("SIGTERM", () => denyAndExit("caret: terminated (SIGTERM) — denying to fail safe."));

  const stdin = await Bun.stdin.text();
  const out = await runReview(stdin, prodReviewDeps());
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(0);
}

async function main(): Promise<void> {
  const sub = process.argv[2];
  switch (sub) {
    case "daemon":
      return runDaemon();
    case "prewarm":
      return runPrewarm();
    case "review":
      return runReviewSubcommand();
    default:
      process.stderr.write(
        `caret: unknown subcommand "${sub ?? ""}". Use: daemon | prewarm | review\n`,
      );
      process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    // Last-resort fail-safe for the review path; harmless noise elsewhere.
    process.stdout.write(
      `${JSON.stringify(denyOutput(`caret: fatal ${err} — denying to fail safe.`))}\n`,
    );
    process.exit(0);
  });
}
