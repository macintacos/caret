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

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { createServer, type CaretServer } from "./daemon.ts";
import { denyOutput, type HookOutput, toHookOutput } from "./feedback.ts";
import {
  createDaemonLogger,
  type ErrorContext,
  logDebug,
  logError,
  logInfo,
  logWarn,
  setLogLevel,
  setRedact,
  shortId,
} from "./log.ts";
import {
  buildHash,
  configFile,
  type DaemonLock,
  daemonLock,
  daemonLogFile,
  getPort,
  invalidEnvVars,
  logFile,
  reviewsDir,
  reviewTimeoutMs,
  stateDir,
  VERSION,
} from "./paths.ts";
import { hasUntaggedCodeBlock, PLAN_FORMAT_DENY_MESSAGE } from "./plan-format.ts";
import { redactLogFiles } from "./redact.ts";
import { loadSettings, settings, watchSettings } from "./settings.ts";
import { createStore } from "./store.ts";
import type { Decision, PlanInput } from "./types.ts";

// ---------------------------------------------------------------------------
// Testable cores (dependency-injected)
// ---------------------------------------------------------------------------

export interface ReviewDeps {
  /** Ensure a daemon is up and return its base URL. */
  ensureDaemon: () => Promise<string>;
  postReview: (baseUrl: string, input: PlanInput) => Promise<{ id: string }>;
  /** One bounded poll: a Decision, or null on a heartbeat (re-poll). Throws on
   * a transient drop so the caller can reconnect. */
  longPoll: (baseUrl: string, id: string) => Promise<Decision | null>;
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
  // Track the current step + context so the catch can log what actually failed.
  let step = "parse";
  const ctx: ErrorContext = {};
  try {
    let hook: HookStdin;
    try {
      hook = JSON.parse(stdin);
    } catch {
      throw new Error("could not parse hook stdin JSON");
    }
    ctx.sessionId = hook.session_id;
    ctx.cwd = hook.cwd;
    // The review's start-of-timeline anchor: even a format-deny or a crashed
    // run leaves a record of the request and its session.
    logInfo("review", "review requested", { ...ctx });
    const input: PlanInput = {
      sessionId: hook.session_id,
      cwd: hook.cwd,
      plan: hook.tool_input?.plan,
    };

    // Reject plans with unhighlightable (untagged) code blocks before any daemon
    // work, so a format-only reject never spins up a daemon or creates a review.
    // The format-deny message is distinct from the fail-safe deny below; the
    // reject is an EXPECTED outcome, logged at info (default-on) so reject
    // loops stay diagnosable without reading as errors.
    step = "validatePlan";
    if (hasUntaggedCodeBlock(input.plan)) {
      logInfo(step, "plan rejected: code block missing language marker", ctx);
      return denyOutput(PLAN_FORMAT_DENY_MESSAGE);
    }

    step = "ensureDaemon";
    const baseUrl = await deps.ensureDaemon();
    step = "postReview";
    const { id } = await deps.postReview(baseUrl, input);
    // From here every record — decision and error alike — carries the reviewId,
    // stitching this stream against the daemon's review/resolve records.
    ctx.reviewId = id;
    logDebug("review", `review created: ${shortId(id)}`, { ...ctx });
    const url = `${baseUrl}/?review=${id}`;
    deps.openBrowser(url);
    // Also print the URL to stderr — clickable in the transcript if the browser
    // fails to open.
    process.stderr.write(`caret: review this plan at ${url}\n`);

    step = "longPoll";
    // Poll until the browser decides: re-poll on each heartbeat (null), and on a
    // transient drop reconnect and keep going (the decision is served on
    // reconnect, so nothing is lost). Bounded by the review timeout — a real
    // timeout, or an unreachable daemon (ensureDaemon throwing), bubbles out to
    // the fail-safe deny below. Each poll is itself timeout-capped so a single
    // hung request can't wedge the loop.
    const start = Date.now();
    let pollUrl = baseUrl;
    let decision: Decision | undefined;
    while (!decision) {
      if (Date.now() - start >= deps.timeoutMs) throw new TimeoutError("review timed out");
      try {
        decision =
          (await withTimeout(deps.longPoll(pollUrl, id), deps.timeoutMs, "review timed out")) ??
          undefined;
      } catch (err) {
        if (err instanceof TimeoutError) throw err;
        // Reconnect — label this step so a failed reconnect logs the real
        // failing op, not the poll it was recovering from.
        step = "reconnect";
        pollUrl = await deps.ensureDaemon();
        step = "longPoll";
      }
    }
    // The reviewer's verdict is normal operation: record it at info. Never the
    // feedback body (EXC-444; reviewer prose is user-generated content like
    // plan bodies) — only its length, so reject loops stay distinguishable
    // from empty-feedback denies.
    if (decision.behavior === "deny") {
      logInfo("decision", "plan rejected", { ...ctx, feedbackChars: decision.feedback?.length });
    } else {
      logInfo("decision", "plan approved", { ...ctx, acceptMode: decision.acceptMode });
    }
    return toHookOutput(decision);
  } catch (err) {
    logError(step, err, ctx);
    const msg = err instanceof Error ? err.message : String(err);
    return denyOutput(`caret: ${msg} — denying so no unreviewed plan ships. See ${logFile()}.`);
  }
}

/** Parsed /api/health body. `build`/`version` are absent on a pre-fix daemon. */
type HealthBody = { service?: string; build?: string; version?: string };

export interface EnsureDeps {
  baseUrl: string;
  /** This binary's UI build fingerprint and version, for staleness comparison. */
  currentBuild: string;
  currentVersion: string;
  /** Returns the parsed /api/health body, or null if the connection refused. */
  health: (baseUrl: string) => Promise<HealthBody | null>;
  /** Read the daemon lock, or null if absent/unreadable. */
  readLock: () => DaemonLock | null;
  /** Is a PID alive? (false ⇒ an orphan lock can be removed.) */
  isAlive: (pid: number) => boolean;
  /** Ask a stale daemon to step down. Returns true when a graceful shutdown was
   * initiated (POST /api/retire accepted, or SIGTERM sent to a live lock PID),
   * false when nothing could be done (a pre-fix daemon: no route and no lock). */
  retire: (baseUrl: string, lock: DaemonLock | null) => Promise<boolean>;
  /** Remove an orphan lock file. */
  removeLock: () => void;
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

/** Ensure a caret daemon of THIS build owns the port: reuse a same-build daemon,
 * gracefully retire a stale one and spawn a fresh daemon, and clean orphan locks
 * (EXC-406). Never denies a review because takeover failed — an unretireable
 * stale daemon is reused (serving its old UI) rather than left unreachable. */
export async function ensureDaemon(deps: EnsureDeps): Promise<string> {
  for (let attempt = 0; attempt < deps.maxAttempts; attempt++) {
    const h = await deps.health(deps.baseUrl);
    if (h && h.service === "caret") {
      // Reuse only a same-build, same-version daemon; otherwise it's serving a
      // stale UI/code and must step down so this binary's daemon can take over.
      if (h.build === deps.currentBuild && h.version === deps.currentVersion) {
        return deps.baseUrl;
      }
      const retired = await deps.retire(deps.baseUrl, deps.readLock());
      // A pre-fix daemon (no /api/retire, no lock) can't be retired: reuse it
      // (stale UI) rather than deny the review or spin retrying — strictly no
      // worse than before the fix. A retireable daemon is now exiting → re-poll.
      if (!retired) return deps.baseUrl;
      logDebug("retire", "stale daemon retiring");
      await deps.backoff(attempt);
      continue;
    }
    if (h && h.service !== "caret") {
      throw new Error(`port is held by a non-caret process — set CARET_PORT to a free port`);
    }
    // Connection refused → drop an orphan lock (dead PID) if present, then spawn.
    // A lost spawn race is fine: swallow EADDRINUSE and re-poll, connecting to
    // whichever instance won.
    const lock = deps.readLock();
    if (lock && !deps.isAlive(lock.pid)) {
      deps.removeLock();
      logDebug("spawn", "orphan daemon lock removed");
    }
    try {
      deps.spawn();
      logDebug("spawn", "daemon spawned");
    } catch (e) {
      if (!isAddrInUse(e)) throw e;
    }
    await deps.backoff(attempt);
  }
  // Exhausted: never deny a review on takeover failure. If a live caret daemon
  // is still answering (even a stale one we couldn't retire), reuse it; only
  // throw when nothing caret is reachable.
  const final = await deps.health(deps.baseUrl);
  if (final && final.service === "caret") return deps.baseUrl;
  throw new Error("caret daemon did not become healthy in time");
}

// ---------------------------------------------------------------------------
// Production dependency implementations
// ---------------------------------------------------------------------------

export async function httpHealth(baseUrl: string): Promise<HealthBody | null> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return null;
    return (await res.json()) as HealthBody;
  } catch {
    return null;
  }
}

/** Read + validate the daemon lock; null if missing or unparseable. */
function readDaemonLock(): DaemonLock | null {
  try {
    const lock = JSON.parse(readFileSync(daemonLock(), "utf-8")) as DaemonLock;
    if (typeof lock.pid === "number" && typeof lock.port === "number") return lock;
    return null;
  } catch {
    return null;
  }
}

/** Liveness probe via signal 0 (kills nothing). ESRCH ⇒ dead; EPERM ⇒ alive but
 * owned by another user (treated as alive — we must not assume it's an orphan). */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM";
  }
}

function removeDaemonLock(): void {
  try {
    unlinkSync(daemonLock());
  } catch {
    // already gone — nothing to do.
  }
}

/** Ask a stale daemon to step down. Returns true if a graceful shutdown was
 * initiated; false if nothing could be done (pre-fix daemon: no route, no lock). */
async function retireDaemon(baseUrl: string, lock: DaemonLock | null): Promise<boolean> {
  // Preferred: the daemon's own loopback retire endpoint (persists, then exits).
  try {
    const res = await fetch(`${baseUrl}/api/retire`, {
      method: "POST",
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) return true;
  } catch {
    // network error / timeout → fall through to the SIGTERM fallback.
  }
  // Fallback: a daemon without /api/retire (a pre-fix build) — SIGTERM the lock's
  // PID, if we have a live one.
  if (lock && isPidAlive(lock.pid)) {
    try {
      process.kill(lock.pid, "SIGTERM");
      return true;
    } catch {
      // race: it already exited, or it isn't ours — nothing more we can do.
    }
  }
  return false;
}

function daemonCommand(): string[] {
  // Compiled binary: process.execPath IS the caret binary. Dev (`bun run
  // src/cli.ts`): re-invoke bun with the script path.
  const script = process.argv[1];
  if (script?.endsWith(".ts")) return [process.execPath, script, "daemon"];
  return [process.execPath, "daemon"];
}

function spawnDaemon(): void {
  // Route the detached daemon's stdout/stderr to a log file so failures are
  // diagnosable after the fact. Best-effort: fall back to discarding output.
  let out: number | "ignore" = "ignore";
  try {
    mkdirSync(stateDir(), { recursive: true });
    out = openSync(daemonLogFile(), "a");
  } catch {
    // The daemon still spawns; only its crash output is lost. Best-effort warn
    // (the same unwritable state dir usually silences caret.log too).
    logWarn("spawn", "daemon log unopenable; discarding daemon output");
  }
  Bun.spawn(daemonCommand(), {
    stdio: ["ignore", out, out],
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

async function longPoll(baseUrl: string, id: string): Promise<Decision | null> {
  const res = await fetch(`${baseUrl}/api/reviews/${id}/decision`);
  if (res.status === 204) return null; // heartbeat: still pending — re-poll
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

async function prodEnsureDeps(): Promise<EnsureDeps> {
  return {
    baseUrl: `http://localhost:${getPort()}`,
    // The current binary's identity: its build fingerprint + the package version.
    currentBuild: await currentBuildId(),
    currentVersion: VERSION,
    health: httpHealth,
    readLock: readDaemonLock,
    isAlive: isPidAlive,
    retire: retireDaemon,
    removeLock: removeDaemonLock,
    spawn: spawnDaemon,
    backoff,
    maxAttempts: 12,
  };
}

function prodReviewDeps(): ReviewDeps {
  return {
    ensureDaemon: async () => ensureDaemon(await prodEnsureDeps()),
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

export interface BuildIdDeps {
  /** True when running as a compiled binary (process.execPath IS caret), false
   * under `bun run` dev. */
  isCompiled: boolean;
  /** Hash of the compiled binary's content, or null if it can't be read. */
  hashBinary: () => Promise<string | null>;
  /** Hash of the served UI HTML (the dev / fallback fingerprint). */
  uiHash: () => Promise<string>;
}

/** The build fingerprint used to decide daemon staleness. For a compiled binary
 * it's a hash of the binary itself, so ANY rebuild — UI or server code — yields a
 * new fingerprint and supersedes an older running daemon (a freshly built or
 * installed caret always wins); re-invoking the same binary still matches and
 * reuses. Dev (`bun run`, which is port-isolated and never uses takeover) falls
 * back to the UI hash. */
export async function computeBuildId(deps: BuildIdDeps): Promise<string> {
  if (deps.isCompiled) {
    const h = await deps.hashBinary();
    if (h) return h;
  }
  return deps.uiHash();
}

let cachedBuildId: string | undefined;

/** computeBuildId wired to the real binary/UI and memoized per process (the
 * build can't change while this process runs). */
async function currentBuildId(): Promise<string> {
  if (cachedBuildId !== undefined) return cachedBuildId;
  const script = process.argv[1];
  cachedBuildId = await computeBuildId({
    isCompiled: !script?.endsWith(".ts"),
    hashBinary: async () => {
      try {
        const bytes = await Bun.file(process.execPath).bytes();
        return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
      } catch {
        return null; // unreadable binary — fall back to the UI hash.
      }
    },
    uiHash: async () => buildHash(await loadUiHtml()),
  });
  return cachedBuildId;
}

async function runDaemon(): Promise<void> {
  // Leveled NDJSON to stderr (spawnDaemon redirects it into daemon.log). The
  // level and redact thunks re-read svc.current() per emit, so config.toml
  // edits hot-reload without a restart — and the boot line below doubles as
  // the EXC-429 settings warm: an invalid config is detected and logged here,
  // not on first use. The watcher records which keys changed when a reload is
  // detected (i.e. on the first emit after the edit — detection is as lazy as
  // the reload itself). NB: a change record is an info emit, so raising
  // [logging].level above info suppresses it like any other info record.
  // The change record's msg already carries old → new per key; the full
  // settings object rides only on the boot record.
  const svc = watchSettings(settings(), (changes) =>
    log.info("settings", `settings changed: ${changes.join("; ")}`),
  );
  const log = createDaemonLogger(
    () => svc.current().logging.level,
    undefined,
    () => svc.current().logging.redact,
  );
  const cfg = configFile();
  // The boot line records the effective settings: the VALIDATED parse only —
  // schema-constrained enums/booleans — never raw config text, which may hold
  // anything (the settings.ts logValidationFailure invariant). It is also the
  // watcher's baseline read, so boot never fires a spurious change record.
  log.info(
    "settings",
    existsSync(cfg) ? `settings: reading ${cfg}` : `settings: no config at ${cfg}; using defaults`,
    { settings: svc.current() },
  );
  // A typo'd CARET_* var silently falls back to its default — surface it once
  // at boot so "why is it on the default port?" is answerable from the log.
  for (const name of invalidEnvVars()) log.warn("env", `${name} invalid; using default`);
  const store = createStore(reviewsDir(), log);
  await store.rehydrate();
  const html = await loadUiHtml();
  if (!html) log.info("ui", "no embedded ui; serving placeholder");
  let server: CaretServer;
  try {
    server = createServer({
      store,
      port: getPort(),
      serveHtml: html ? () => html : undefined,
      lockPath: daemonLock(),
      buildId: await currentBuildId(),
      log,
    });
  } catch (e) {
    if (isAddrInUse(e)) {
      process.stderr.write("caret: another daemon won the port; exiting.\n");
      process.exit(0);
    }
    throw e;
  }
  // Cleanup is wired ONLY after a successful bind + lock write: a daemon that
  // lost the EADDRINUSE race exits via the catch above without a lock, so it
  // must never reach here and unlink the winner's lock. stop() removes the lock;
  // pending reviews are already write-through to disk and rehydrate on restart.
  const shutdown = (code: number) => {
    server.stop();
    process.exit(code);
  };
  // Signal deaths leave a record (the synchronous write is durable before the
  // exit); fatal errors log through the daemon's own sink, not caret.log.
  process.once("SIGTERM", () => {
    log.info("signal", "sigterm: shutting down");
    shutdown(0);
  });
  process.once("SIGINT", () => {
    log.info("signal", "sigint: shutting down");
    shutdown(0);
  });
  const onFatal = (label: string) => (err: unknown) => {
    log.error(label, err);
    shutdown(1);
  };
  process.once("uncaughtException", onFatal("uncaughtException"));
  process.once("unhandledRejection", onFatal("unhandledRejection"));
  // Last-resort synchronous unlink in case an exit path bypassed stop().
  process.once("exit", () => {
    try {
      unlinkSync(daemonLock());
    } catch {
      // already removed by stop(), or never written — both fine.
    }
  });
  // Bun.serve keeps the process alive; the daemon idle-auto-shuts-down.
}

async function runPrewarm(): Promise<void> {
  // Best-effort warm start; never blocks or denies (it's a PostToolUse hook).
  try {
    await ensureDaemon(await prodEnsureDeps());
  } catch (e) {
    logDebug("prewarm", `prewarm failed: ${e instanceof Error ? e.message : e}`);
    process.stderr.write(`caret prewarm: ${e}\n`);
  }
  process.exit(0);
}

async function runReviewSubcommand(): Promise<void> {
  // Wire [logging].level and .redact before anything can emit (the signal
  // handlers below and the review itself both log through the shared logger).
  // One synchronous read; error records pass at every level, so a broken
  // config still logs.
  const { logging } = loadSettings();
  setLogLevel(logging.level);
  setRedact(logging.redact);
  // Same boot-time surfacing as the daemon's — a typo'd CARET_* var otherwise
  // silently falls back to its default.
  for (const name of invalidEnvVars()) logWarn("env", `${name} invalid; using default`);
  // Emit exactly one decision line. A signal arriving after the normal decision
  // was written must not append a second (deny) line.
  let responded = false;
  const respond = (output: unknown) => {
    if (responded) return;
    responded = true;
    process.stdout.write(`${JSON.stringify(output)}\n`);
  };
  const denyAndExit = (reason: string) => {
    // Only log when this signal is what actually denies the review (a signal
    // arriving after a normal decision is already a no-op below).
    if (!responded) logError("signal", new Error(reason));
    respond(denyOutput(`${reason} See ${logFile()}.`));
    process.exit(0);
  };
  process.once("SIGINT", () => denyAndExit("caret: interrupted (SIGINT) — denying to fail safe."));
  process.once("SIGTERM", () => denyAndExit("caret: terminated (SIGTERM) — denying to fail safe."));

  const stdin = await Bun.stdin.text();
  const out = await runReview(stdin, prodReviewDeps());
  respond(out);
  process.exit(0);
}

function runRedactSubcommand(): void {
  // Scrub the state-dir logs into shareable *.redacted.log siblings (EXC-399).
  // Human-facing output, not hook JSON: print each written path, or say nothing
  // was found. Failures report to stderr with a non-zero exit — never the
  // review path's deny JSON.
  try {
    const written = redactLogFiles();
    if (written.length === 0) {
      process.stdout.write("caret redact: no logs found to redact.\n");
    } else {
      for (const path of written) process.stdout.write(`${path}\n`);
    }
    process.exit(0);
  } catch (e) {
    process.stderr.write(`caret redact: ${e}\n`);
    process.exit(1);
  }
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
    case "redact":
      return runRedactSubcommand();
    default:
      process.stderr.write(
        `caret: unknown subcommand "${sub ?? ""}". Use: daemon | prewarm | review | redact\n`,
      );
      process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    // Last-resort fail-safe for the review path; harmless noise elsewhere.
    logError("fatal", err);
    process.stdout.write(
      `${JSON.stringify(denyOutput(`caret: fatal ${err} — denying to fail safe. See ${logFile()}.`))}\n`,
    );
    process.exit(0);
  });
}
