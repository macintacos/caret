#!/usr/bin/env bun
// caret hook CLI. Subcommands: daemon | prewarm | review | redact | discovery.
//
// Phase-0 spike outcome encoded here: plan approval is gated through a
// PermissionRequest/ExitPlanMode hook. `review` blocks while the browser
// decides, then prints the PermissionRequest decision JSON (see feedback.ts).
//
// FAIL-SAFE = DENY: shipping an unreviewed plan is the one outcome we never
// allow. Every abnormal path (bad stdin, unreachable daemon, timeout, signal,
// daemon death) emits a deny — never an allow.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { release } from "node:os";
import { dirname, normalize } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { createServer, type CaretServer, VANITY_HOST } from "./daemon.ts";
import {
  collectReport,
  type DiscoveryDeps,
  listProcesses,
  listReviewFiles,
  logStats,
  readClaudeInstallState,
  renderReport,
  type Report,
} from "./discovery.ts";
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
  logFile,
  reviewsDir,
  stateDir,
  VERSION,
} from "./paths.ts";
import { hasUntaggedCodeBlock, PLAN_FORMAT_DENY_MESSAGE } from "./plan-format.ts";
import { redactLogFiles, scrubValue } from "./redact.ts";
import {
  getPort,
  heartbeatMs,
  idleMs,
  invalidEnvVars,
  loadSettings,
  reviewTimeoutMs,
  settings,
  type Settings,
  watchSettings,
} from "./settings.ts";
import { createStore } from "./store.ts";
import type { Decision, HealthIdentity, PlanInput } from "./types.ts";

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
  /** Best-effort: tell the daemon the hook is abandoning this review, so it
   * doesn't hold a pending orphan (EXC-454). Failures are swallowed. */
  expire: (baseUrl: string, id: string) => Promise<void>;
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
  // Hoisted so the catch can reach the daemon for the best-effort expire;
  // reconnects re-assign it, so it always holds the last-known daemon URL.
  let baseUrl: string | undefined;
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
    baseUrl = await deps.ensureDaemon();
    step = "postReview";
    const { id } = await deps.postReview(baseUrl, input);
    // From here every record — decision and error alike — carries the reviewId,
    // stitching this stream against the daemon's review/resolve records.
    ctx.reviewId = id;
    logDebug("review", `review created: ${shortId(id)}`, { ...ctx });
    // EXC-426: humans get the vanity origin; internal fetches keep using baseUrl.
    const open = new URL(baseUrl);
    open.hostname = VANITY_HOST;
    const url = `${open.origin}/?review=${id}`;
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
    let decision: Decision | undefined;
    while (!decision) {
      if (Date.now() - start >= deps.timeoutMs) throw new TimeoutError("review timed out");
      try {
        decision =
          (await withTimeout(deps.longPoll(baseUrl, id), deps.timeoutMs, "review timed out")) ??
          undefined;
      } catch (err) {
        if (err instanceof TimeoutError) throw err;
        // Reconnect — label this step so a failed reconnect logs the real
        // failing op, not the poll it was recovering from.
        step = "reconnect";
        baseUrl = await deps.ensureDaemon();
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
    // The hook is abandoning the review (timeout or post-create failure):
    // best-effort expire so the daemon doesn't hold a pending orphan. The
    // supersede-on-resubmit path self-heals if this never lands (EXC-454).
    if (ctx.reviewId && baseUrl) {
      try {
        await deps.expire(baseUrl, ctx.reviewId);
        logDebug("review", `review expire requested: ${shortId(ctx.reviewId)}`, { ...ctx });
      } catch {
        logDebug("review", "review expire failed; resubmit supersedes", { ...ctx });
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    return denyOutput(`caret: ${msg} — denying so no unreviewed plan ships. See ${logFile()}.`);
  }
}

/** Parsed /api/health body — the shared HealthIdentity shape (every field
 * absent on a pre-fix daemon), aliased to keep the review path's name. */
type HealthBody = HealthIdentity;

export interface EnsureDeps {
  baseUrl: string;
  /** This binary's UI build fingerprint and version, for staleness comparison. */
  currentBuild: string;
  currentVersion: string;
  /** The hook's own resolved state dir — its world identity. A daemon whose
   * health reports a different stateDir belongs to another world and is never
   * reused or retired (EXC-461). */
  currentStateDir: string;
  /** Returns the parsed /api/health body, or null if the connection refused. */
  health: (baseUrl: string) => Promise<HealthBody | null>;
  /** Read the daemon lock, or null if absent/unreadable. */
  readLock: () => DaemonLock | null;
  /** Is a PID alive? (false ⇒ an orphan lock can be removed.) */
  isAlive: (pid: number) => boolean;
  /** Ask a stale daemon to step down. Returns true when a graceful shutdown was
   * initiated (POST /api/retire accepted, or SIGTERM sent to a live lock PID —
   * gated on the lock naming OUR world; a foreign lock pid is never signaled,
   * EXC-461), false when nothing could be done (a pre-fix daemon: no route and
   * no lock). */
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

/** Pure-string path comparison for world identity: normalize() flattens
 * cosmetic differences (trailing slash, `//`, `/./`) so a daemon and hook whose
 * XDG_STATE_HOME values differ only cosmetically still match. Deliberately no
 * realpath — no FS access, no throw; symlinked-vs-resolved divergence stays a
 * documented misconfiguration. */
function sameWorldPath(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/** A health body whose stateDir names another world's state dir. A pre-identity
 * daemon (no stateDir field) can't be distinguished and is treated as same-world
 * for back-compat — on the fixed prod port it is by definition this user's own. */
function isForeignWorld(h: HealthBody, currentStateDir: string): boolean {
  return h.stateDir !== undefined && !sameWorldPath(h.stateDir, currentStateDir);
}

/** The foreign-world conflict is a configuration problem (two worlds sharing one
 * port), not a takeover failure — reusing the daemon would cross-attach this
 * world's reviews into the other world's state dir (EXC-461). Mirrors the
 * non-caret-squatter throw below; deliberately exempt from the never-deny
 * fallback. */
const FOREIGN_WORLD_ERROR =
  "port serves a different caret world (state dir mismatch) — set CARET_PORT to a free port";

/** Ensure a caret daemon of THIS build owns the port: reuse a same-build daemon,
 * gracefully retire a stale one and spawn a fresh daemon, and clean orphan locks
 * (EXC-406). Never denies a review because takeover failed — an unretireable
 * stale daemon is reused (serving its old UI) rather than left unreachable. The
 * one exception: a foreign world's daemon (EXC-461) is neither reused nor
 * retired — that's a config conflict, and cross-attaching IS the bug. */
export async function ensureDaemon(deps: EnsureDeps): Promise<string> {
  for (let attempt = 0; attempt < deps.maxAttempts; attempt++) {
    const h = await deps.health(deps.baseUrl);
    if (h && h.service === "caret") {
      // Another world's daemon: refuse before any reuse/retire logic (EXC-461).
      if (isForeignWorld(h, deps.currentStateDir)) {
        throw new Error(FOREIGN_WORLD_ERROR);
      }
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
  // throw when nothing caret is reachable — or when the answering daemon is a
  // foreign world's (reusing it would cross-attach; EXC-461).
  const final = await deps.health(deps.baseUrl);
  if (final && final.service === "caret") {
    if (isForeignWorld(final, deps.currentStateDir)) throw new Error(FOREIGN_WORLD_ERROR);
    return deps.baseUrl;
  }
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
 * initiated; false if nothing could be done (pre-fix daemon: no route, no lock).
 * Exported for the SIGTERM-gating tests; `kill` is injectable for the same
 * reason and defaults to the real signal. */
export async function retireDaemon(
  baseUrl: string,
  lock: DaemonLock | null,
  currentStateDir: string,
  kill: (pid: number, signal: "SIGTERM") => void = (pid, sig) => process.kill(pid, sig),
): Promise<boolean> {
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
  // PID, if we have a live one. Never a foreign world's pid (EXC-461): ensureDaemon
  // only retires same-world daemons, so a foreign lock here means the lock and the
  // port disagree — killing that pid would take down another world's daemon. A
  // legacy lock (no stateDir) predates worlds and is treated as our own.
  const sameWorld = lock?.stateDir === undefined || sameWorldPath(lock.stateDir, currentStateDir);
  if (lock && sameWorld && isPidAlive(lock.pid)) {
    try {
      kill(lock.pid, "SIGTERM");
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

export async function postReview(baseUrl: string, input: PlanInput): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`POST /api/reviews failed: ${res.status}`);
  return (await res.json()) as { id: string };
}

/** Best-effort expire: short-fused so a dying hook never hangs on it. The
 * caller (runReview's catch) swallows any throw. */
export async function expireReview(baseUrl: string, id: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/reviews/${id}/expire`, {
    method: "POST",
    signal: AbortSignal.timeout(1000),
  });
  // 404 = already terminal (resolved or superseded) — nothing left to expire.
  if (!res.ok && res.status !== 404) throw new Error(`POST /expire failed: ${res.status}`);
}

export async function longPoll(baseUrl: string, id: string): Promise<Decision | null> {
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

async function prodEnsureDeps(s: Settings): Promise<EnsureDeps> {
  // The hook's own world (resolved state dir, EXC-461) — both its reuse
  // identity and the retire fallback's SIGTERM gate.
  const world = stateDir();
  return {
    baseUrl: `http://localhost:${getPort(s)}`,
    // The current binary's identity: its build fingerprint + the package version
    // + the world it serves.
    currentBuild: await currentBuildId(),
    currentVersion: VERSION,
    currentStateDir: world,
    health: httpHealth,
    readLock: readDaemonLock,
    isAlive: isPidAlive,
    retire: (baseUrl, lock) => retireDaemon(baseUrl, lock, world),
    removeLock: removeDaemonLock,
    spawn: spawnDaemon,
    backoff,
    maxAttempts: 12,
  };
}

function prodReviewDeps(s: Settings): ReviewDeps {
  return {
    ensureDaemon: async () => ensureDaemon(await prodEnsureDeps(s)),
    postReview,
    longPoll,
    openBrowser,
    timeoutMs: reviewTimeoutMs(s),
    expire: expireReview,
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

export interface CommitDeps {
  /** The commit baked in at compile time, or undefined (dev, or a build that
   * skipped the --define). */
  baked: string | undefined;
  /** The source checkout's git HEAD, or null on any failure. */
  gitHead: () => string | null;
}

/** The commit the server runs from, logged in the listen record (EXC-452).
 * Prod binaries carry it baked via --define; dev resolves it from the source
 * checkout; otherwise "unknown". Never throws — a missing commit must not
 * destabilize boot. */
export function resolveCommit(deps: CommitDeps): string {
  if (deps.baked) return deps.baked;
  // || not ??: both branches treat any falsy value ("" included) as unset.
  return deps.gitHead() || "unknown";
}

let cachedCommit: string | undefined;

/** resolveCommit wired to the baked define and the real git, memoized per
 * process (the commit can't change while this process runs). */
function currentCommit(): string {
  if (cachedCommit !== undefined) return cachedCommit;
  cachedCommit = resolveCommit({
    // Replaced with a string literal by `--define` in the build scripts
    // (.mise/tasks/build-bin, scripts/install.sh), so prod binaries can't be
    // overridden by runtime env. Deliberately NOT a user setting — it's a
    // build-time substitution token, exempt from the settings-rules.md
    // README-documentation requirement.
    baked: process.env.CARET_BUILD_COMMIT,
    gitHead: () => {
      try {
        // -C import.meta.dir (not cwd): the daemon may be spawned anywhere,
        // but in dev this module lives inside the source checkout. Handles
        // worktrees; inside a compiled binary the virtual dir fails fast.
        const r = Bun.spawnSync(["git", "-C", import.meta.dir, "rev-parse", "HEAD"]);
        if (r.exitCode !== 0) return null;
        const out = r.stdout.toString().trim();
        return out.length > 0 ? out : null;
      } catch {
        return null; // git not on PATH — spawnSync throws rather than failing.
      }
    },
  });
  return cachedCommit;
}

async function runDaemon(opts: { ephemeral: boolean }): Promise<void> {
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
  // The boot snapshot: logged below and reused for the startup-captured
  // tunables (port/idle/heartbeat), so the boot record provably matches the
  // values the server binds with — a config edit landing mid-boot can't split
  // them. The record holds the VALIDATED parse only — schema-constrained
  // values — never raw config text, which may hold anything (the settings.ts
  // logValidationFailure invariant). This is also the watcher's baseline read,
  // so boot never fires a spurious change record.
  const boot = svc.current();
  log.info(
    "settings",
    existsSync(cfg) ? `settings: reading ${cfg}` : `settings: no config at ${cfg}; using defaults`,
    { settings: boot },
  );
  // A typo'd CARET_* var silently falls through to the config file, then the
  // default — surface it once at boot so "why is it on the default port?" is
  // answerable from the log.
  for (const name of invalidEnvVars()) log.warn("env", `${name} invalid; using config/default`);
  const store = createStore(reviewsDir(), log);
  await store.rehydrate();
  const html = await loadUiHtml();
  if (!html) log.info("ui", "no embedded ui; serving placeholder");
  // `caret daemon --ephemeral` (EXC-461): bind an OS-assigned port instead of
  // the configured one. A process flag, not a setting — the dev task owns the
  // daemon and discovers the bound port from the lock, so port resolution for
  // hooks (getPort) is untouched.
  const ephemeral = opts.ephemeral;
  let server: CaretServer;
  try {
    server = createServer({
      store,
      port: ephemeral ? 0 : getPort(boot),
      idleMs: idleMs(boot),
      heartbeatMs: heartbeatMs(boot),
      serveHtml: html ? () => html : undefined,
      lockPath: daemonLock(),
      buildId: await currentBuildId(),
      commit: currentCommit(),
      // World + boot identity (EXC-461): stateDir is the world key (never
      // logged — identifying); the per-boot instanceId is the loggable handle.
      stateDir: stateDir(),
      instanceId: randomUUID().slice(0, 8),
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
    await ensureDaemon(await prodEnsureDeps(loadSettings()));
  } catch (e) {
    logDebug("prewarm", `prewarm failed: ${e instanceof Error ? e.message : e}`);
    process.stderr.write(`caret prewarm: ${e}\n`);
  }
  process.exit(0);
}

async function runReviewSubcommand(): Promise<void> {
  // Wire [logging].level and .redact before anything can emit (the signal
  // handlers below and the review itself both log through the shared logger).
  // One synchronous read — the same snapshot feeds the review deps below, so
  // the hook's logging config and tunables can never come from two different
  // reads of the file.
  const loaded = loadSettings();
  setLogLevel(loaded.logging.level);
  setRedact(loaded.logging.redact);
  // Same boot-time surfacing as the daemon's — a typo'd CARET_* var otherwise
  // silently falls through to the config file, then the default.
  for (const name of invalidEnvVars()) logWarn("env", `${name} invalid; using config/default`);
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
  const out = await runReview(stdin, prodReviewDeps(loaded));
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

/** Production probes for the discovery report (EXC-464): the same primitives
 * the review path already uses (httpHealth, readDaemonLock, isPidAlive) plus
 * the bounded read-only readers from discovery.ts. Deliberately no removeLock
 * or retire — discovery observes, never repairs. */
function prodDiscoveryDeps(s: Settings): DiscoveryDeps {
  return {
    now: () => new Date(),
    version: VERSION,
    system: () => ({ platform: process.platform, os: release(), arch: process.arch }),
    install: () => ({
      // The same dev-vs-compiled signal daemonCommand/currentBuildId key off.
      kind: process.argv[1]?.endsWith(".ts") ? "dev" : "prod",
      binaryPath: process.execPath,
      bunVersion: Bun.version,
    }),
    settings: () => s,
    configPath: configFile(),
    configExists: () => existsSync(configFile()),
    effective: () => ({
      port: getPort(s),
      idleMs: idleMs(s),
      reviewTimeoutMs: reviewTimeoutMs(s),
      heartbeatMs: heartbeatMs(s),
    }),
    baseUrl: `http://localhost:${getPort(s)}`,
    health: httpHealth,
    readLock: readDaemonLock,
    isPidAlive,
    listProcesses,
    listReviewFiles,
    readClaudeInstallState,
    logStats,
    logPaths: { caret: logFile(), daemon: daemonLogFile() },
  };
}

async function runDiscoverySubcommand(opts: { json: boolean }): Promise<void> {
  // One-shot diagnostics snapshot (EXC-464). Human-facing output like redact:
  // human-readable by default, --json for the machine document. ALWAYS redacted
  // (a deliberate inversion of the raw-by-default logging posture, EXC-399) —
  // this artifact exists to be pasted into bug reports. Exit 0 whenever a
  // report was produced, however degraded; non-zero only when none could be.
  try {
    const s = loadSettings();
    const report = await collectReport(prodDiscoveryDeps(s));
    // scrubValue preserves the report's shape (strings scrub in place), so the
    // cast back to Report is safe for renderReport.
    const redacted = scrubValue(report, true) as Report;
    const out = opts.json ? JSON.stringify(redacted, null, 2) : renderReport(redacted);
    process.stdout.write(`${out}\n`);
    process.exit(0);
  } catch (e) {
    process.stderr.write(`caret discovery: ${e}\n`);
    process.exit(1);
  }
}

// The CLI command tree (EXC-472). Each subcommand's action threads its parsed
// options into the run functions, replacing the former process.argv reads. The
// daemon self-spawn vector (daemonCommand) and runReviewSubcommand's fail-safe
// are independent of this layer and unchanged.
function buildProgram(): Command {
  const program = new Command()
    .name("caret")
    .description("caret hook CLI: daemon | prewarm | review | redact | discovery")
    .version(VERSION)
    // We never call exitOverride(): a parse error (unknown command/option, bare
    // `caret`) prints usage to stderr and exits non-zero via Commander's default,
    // synchronously during parse. It can never reach the fail-safe catch below,
    // so a parse error never masquerades as a deny (EXC-472).
    .showHelpAfterError();

  program
    .command("daemon")
    .description("run the review daemon")
    .option("--ephemeral", "bind an OS-assigned port instead of the configured one")
    .action((opts) => runDaemon({ ephemeral: opts.ephemeral ?? false }));

  program
    .command("prewarm")
    .description("warm-start the daemon")
    .action(() => runPrewarm());

  program
    .command("review")
    .description("review a plan from stdin (ExitPlanMode hook)")
    .action(() => runReviewSubcommand());

  program
    .command("redact")
    .description("write redacted copies of the logs")
    .action(() => runRedactSubcommand());

  program
    .command("discovery")
    .description("print a diagnostics report")
    .option("--json", "emit the machine-readable JSON document")
    .action((opts) => runDiscoverySubcommand({ json: opts.json ?? false }));

  return program;
}

if (import.meta.main) {
  // KEEP the guard: cli.ts is imported by the test suites for its internal
  // functions; parseAsync must run only when this file is the entrypoint, never
  // on import (it would parse the test runner's argv and exit 1, killing tests).
  // parseAsync (not parse) so an async action's rejection propagates to .catch().
  buildProgram()
    .parseAsync(process.argv)
    .catch((err) => {
      // Last-resort fail-safe for the review path; harmless noise elsewhere.
      logError("fatal", err);
      process.stdout.write(
        `${JSON.stringify(denyOutput(`caret: fatal ${err} — denying to fail safe. See ${logFile()}.`))}\n`,
      );
      process.exit(0);
    });
}
