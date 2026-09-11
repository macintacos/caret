// Daemon takeover + lifecycle: discover whether a caret daemon of THIS build
// already owns the port, gracefully retire a stale one, spawn a fresh one, and
// clean orphan locks (EXC-406) — never denying a review because takeover failed.
// This module also owns the world-identity guards (EXC-461) and the lock
// read/write/liveness primitives the takeover loop and the discovery command
// share.

import { chmodSync, existsSync, openSync, unlinkSync } from "node:fs";
import { normalize } from "node:path";

import {
  daemonLock,
  daemonStderrLogFile,
  ensureLogsDir,
  launcherServiceFile,
  stateDir,
} from "@/config/paths.ts";
import { getPort, logKeep, logMaxSize, type Settings } from "@/config/settings.ts";
import { type HealthBody, httpHealth } from "@/daemon/client.ts";
import { buildKind, currentBuildId, type DaemonLock, VERSION } from "@/lib/build-id.ts";
import { readJsonFileSync } from "@/lib/json-file.ts";
import { logDebug, logInfo, logWarn } from "@/lib/log.ts";
import { rotateIfOversized } from "@/lib/log-rotate.ts";
import { isNewer } from "@/lib/semver.ts";
import { errorMessage } from "@/lib/types.ts";
import type { ServiceManager } from "@/service/manager.ts";

/** What a hook may do to its world's supervisor: cycle the service and read its status,
 * never install or remove it. */
type Supervisor = Pick<ServiceManager, "restart" | "status">;

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
  /** This world's supervisor, absent when the world installed none. */
  service?: Supervisor;
  backoff: (attempt: number) => Promise<void>;
  maxAttempts: number;
  /** Monotonic milliseconds, read for the call's deadline. */
  now: () => number;
  /** How long from the call's start the supervisor has to put a daemon on the port. */
  windowMs: number;
}

export function isAddrInUse(e: unknown): boolean {
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

/** How long past the supervisor window a call goes on spawning into an empty port, so a
 * window that ran out still leaves the fallback its turn. Keep `SUPERVISOR_WINDOW_MS`,
 * this, and one overrunning iteration under the prewarm hook's `timeout` in
 * `hooks/hooks.json` (coupling test: test/adapters/claude/hooks-timeout). */
export const SPAWN_RESERVE_MS = 5_000;

/** How a caller wants the port resolved. */
export interface EnsureOptions {
  /** Whether to retire a different-build daemon and spawn this binary's own.
   * Defaults to true — starting a review, or prewarming, is when a build claims
   * the port. Pass false to ATTACH instead: return whichever same-world daemon is
   * answering, whatever its build, and spawn only when nothing is.
   *
   * A mid-review reconnect passes false. The reconnecting client may be an OLD
   * build whose review has outlived an upgrade; letting it take over would install
   * that old build as the port's owner, and since it reconnects on every drop it
   * would keep winning against the current one indefinitely. Recovery must not
   * double as installation. Attaching costs nothing: reviews are persisted per
   * world, so any same-world daemon can serve the decision. */
  takeover?: boolean;
  /** The daemon on the port just refused work while stepping down: wait past it to its
   * successor. That wait is the call's one supervisor window; a port already empty is a
   * cold start. */
  draining?: boolean;
}

/** Ensure a caret daemon owns the port and return its base URL: reuse a same-build
 * daemon, gracefully retire a stale one and spawn a fresh daemon, and clean orphan
 * locks (EXC-406). Under this world's supervisor a stale resident daemon is cycled
 * through the service instead — unless it is newer than this hook — and an empty port
 * is left to the supervisor before this hook spawns into it (EXC-1166). The supervisor
 * gets the call's first `windowMs` and the fallback spawn `SPAWN_RESERVE_MS` past that,
 * and no attempt starts past that deadline. `takeover: false` and `draining` —
 * see EnsureOptions. Never denies a review because takeover failed — an unretireable
 * stale daemon, or one whose service will not restart, is reused (serving its old UI)
 * rather than left unreachable. The one exception: a foreign world's daemon (EXC-461) is
 * neither reused nor retired — that's a config conflict, and cross-attaching IS the bug. */
export async function ensureDaemon(deps: EnsureDeps, opts: EnsureOptions = {}): Promise<string> {
  const takeover = opts.takeover ?? true;
  const windowEnd = deps.now() + deps.windowMs;
  const deadline = windowEnd + SPAWN_RESERVE_MS;
  // Past the supervisor window, attach to whatever answers and spawn into an empty port,
  // so a launcher resolving another build than this hook's is never cycled twice.
  let windowSpent = opts.draining ? await awaitDrained(deps, windowEnd) : false;
  let supervised: boolean | undefined;
  for (let attempt = 0; attempt < deps.maxAttempts && deps.now() < deadline; attempt++) {
    windowSpent ||= deps.now() >= windowEnd;
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
      // Attaching caller: this daemon is not ours, but it is this world's and it
      // is answering, which is all a resumed poll needs.
      if (!takeover || windowSpent) return deps.baseUrl;
      // Retiring a supervised daemon only races the supervisor's restart. Cycle the
      // service instead: the launcher resolves caret at exec time, so the restart is
      // the upgrade. Only a peer reporting `resident: true` is the supervised one;
      // anything else on the port — a build that predates residency, a hook's
      // idle-exiting fallback — is retired below, since a cycle cannot free it.
      if (deps.service && h.resident === true) {
        // The launcher execs the highest installed caret, so cycling a newer daemon
        // only brings that same build back.
        if (isNewer(h.version ?? "", deps.currentVersion)) return deps.baseUrl;
        windowSpent = true;
        // A failed restart may already have stopped the daemon: probe again rather
        // than hand back a port nothing answers on.
        if (await restartService(deps.service, h)) {
          await awaitSuccessor(deps, { prev: h, step: "service", until: windowEnd });
        }
        continue;
      }
      const retired = await deps.retire(deps.baseUrl, deps.readLock());
      // A pre-fix daemon (no /api/retire, no lock) can't be retired: reuse it
      // (stale UI) rather than deny the review or spin retrying. A retireable
      // daemon is now exiting → re-poll.
      if (!retired) return deps.baseUrl;
      logDebug("retire", "stale daemon retiring");
      await deps.backoff(attempt);
      continue;
    }
    if (h && h.service !== "caret") {
      throw new Error(`port is held by a non-caret process — set CARET_PORT to a free port`);
    }
    // An empty port under a supervisor is its restart window: a daemon spawned into it
    // is unsupervised, and takes the port from the one that should hold it.
    if (!windowSpent && deps.service) {
      supervised ??= await supervisorExpected(deps.service);
      if (supervised) {
        windowSpent = true;
        if (await awaitSuccessor(deps, { prev: null, step: "service", until: windowEnd })) {
          continue;
        }
      }
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
  // Exhausted: never deny a review on takeover failure — reuse even a stale
  // daemon we couldn't retire. The foreign world stays the one exception
  // (reusing it would cross-attach; EXC-461).
  const final = await deps.health(deps.baseUrl);
  if (final && final.service === "caret") {
    if (isForeignWorld(final, deps.currentStateDir)) throw new Error(FOREIGN_WORLD_ERROR);
    return deps.baseUrl;
  }
  throw new Error("caret daemon did not become healthy in time");
}

/** Wait past the daemon that just refused work while stepping down. True when one was
 * answering, since that wait spends the call's supervisor window; false on a port
 * already empty, which is a cold start. */
async function awaitDrained(deps: EnsureDeps, until: number): Promise<boolean> {
  const h = await deps.health(deps.baseUrl);
  if (h?.service !== "caret") return false;
  await awaitSuccessor(deps, { prev: h, step: "drain", until });
  return true;
}

/** Wait, until the supervisor window closes at `until`, for the port to change hands from
 * `prev` (null: nothing was answering). True once another instance answers — never the
 * outgoing one, which keeps answering while it drains. An empty port is the cycle's gap
 * under a supervisor, but with none it is the answer: the caller spawns into it. */
async function awaitSuccessor(
  deps: EnsureDeps,
  { prev, step, until }: { prev: HealthBody | null; step: "service" | "drain"; until: number },
): Promise<boolean> {
  for (let attempt = 0; attempt < deps.maxAttempts && deps.now() < until; attempt++) {
    await deps.backoff(attempt);
    const h = await deps.health(deps.baseUrl);
    if (h?.service === "caret") {
      if (prev === null || h.instanceId !== prev.instanceId) return true;
    } else if (!deps.service) {
      return true;
    }
  }
  logWarn(step, "no daemon took the port in time", { instanceId: prev?.instanceId });
  return false;
}

/** Cycle the service for the `stale` daemon. False when the supervisor refused. */
async function restartService(service: Supervisor, stale: HealthBody): Promise<boolean> {
  const ctx = { instanceId: stale.instanceId, build: stale.build };
  logInfo("service", "restarting service: stale daemon build", ctx);
  try {
    // ponytail: the call's deadline cannot cut short a restart already running. It returns
    // once the outgoing daemon stops, which DRAIN_DEADLINE_MS (src/daemon/server.ts)
    // bounds; race it against the deadline if that ever matters.
    await service.restart();
    return true;
  } catch (e) {
    logWarn("service", "service restart failed", { ...ctx, reason: errorMessage(e) });
    return false;
  }
}

/** Whether the supervisor will start a daemon on its own: its unit is loaded, the user
 * has not turned it off, and systemd has not parked it. A status that cannot be read
 * counts as no. */
async function supervisorExpected(service: Supervisor): Promise<boolean> {
  const status = await service.status().catch(() => null);
  return status?.installed === true && !status.disabled && !status.failed;
}

/** Read + validate the daemon lock; null if missing or unparseable. */
export function readDaemonLock(): DaemonLock | null {
  const lock = readJsonFileSync(daemonLock()) as DaemonLock | null;
  if (lock && typeof lock.pid === "number" && typeof lock.port === "number") return lock;
  return null;
}

/** Liveness probe via signal 0 (kills nothing). ESRCH ⇒ dead; EPERM ⇒ alive but
 * owned by another user (treated as alive — we must not assume it's an orphan). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM";
  }
}

export function removeDaemonLock(): void {
  try {
    unlinkSync(daemonLock());
  } catch {
    // already gone — nothing to do.
  }
}

/** Remove the daemon lock, but only when it names THIS process. `removeDaemonLock`
 * is for a caller that has already established the lock is stale; this is for a
 * daemon tearing itself down, where the file on disk may belong to whichever
 * daemon won the port — and unlinking that one would strand a live daemon nothing
 * can find. Carrying the ownership check here is what lets a daemon wire its
 * cleanup BEFORE it binds (see runDaemon). */
export function removeOwnDaemonLock(): void {
  if (readDaemonLock()?.pid === process.pid) removeDaemonLock();
}

/** Ask a stale daemon to step down. Returns true if a graceful shutdown was
 * initiated; false if nothing could be done (pre-fix daemon: no route, no lock). */
export async function retireDaemon(
  baseUrl: string,
  lock: DaemonLock | null,
  currentStateDir: string,
  kill: (pid: number, signal: "SIGTERM") => void = (pid, sig) => process.kill(pid, sig),
): Promise<boolean> {
  // Preferred: the daemon's own loopback retire endpoint (drains, then exits).
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
  // src/cli.ts`) AND the npm bundle (`bun dist/cli.js`) run under bun and must
  // re-pass the script path — otherwise the spawned child is `[bun, "daemon"]`,
  // which has no script to run and never starts the daemon (EXC-643).
  if (buildKind() === "binary") return [process.execPath, "daemon"];
  return [process.execPath, process.argv[1] as string, "daemon"];
}

/** Open the append-mode fd the detached daemon's stdout/stderr is redirected
 * to, rotating it first if it is already oversized — the spawn-path rotation check. A
 * supervised daemon never passes through here and rotates on its own upkeep tick instead
 * (rotateDaemonStderr below). The explicit chmod covers an upgraded install, whose existing
 * file predates the mode argument (which only applies on create). "ignore"
 * means the log is unopenable and the output is discarded; the daemon still
 * spawns. */
export function openDaemonStderr(s: Settings): number | "ignore" {
  const path = daemonStderrLogFile();
  try {
    ensureLogsDir();
    rotateIfOversized(path, logMaxSize(s), logKeep(s));
    const fd = openSync(path, "a", 0o600);
    chmodSync(path, 0o600);
    return fd;
  } catch {
    // Best-effort warn (the same unwritable state dir usually silences
    // caret.log too).
    logWarn("spawn", "daemon stderr log unopenable; discarding output");
    return "ignore";
  }
}

/** Rotate daemon-stderr.log if it has grown past the threshold. The supervised daemon's
 * own rotation site: a supervisor starts it directly, so it never passes through
 * spawnDaemon, where the other check lives (EXC-1164). Copy-truncate, so the supervisor's
 * open descriptor keeps appending across it. */
export function rotateDaemonStderr(s: Settings): void {
  rotateIfOversized(daemonStderrLogFile(), logMaxSize(s), logKeep(s));
}

/** The working directory the detached daemon is pinned to. The daemon is a
 * machine-wide singleton that outlives whatever project directory happened to
 * start it, and an inherited cwd is a directory it has no business holding: an
 * exec worktree torn down after its PR merged left daemons unable to
 * `Bun.spawn` anything at all — absolute paths included — because posix_spawn
 * needs a live cwd (EXC-1155). Root is chosen because it cannot be unlinked and
 * needs no `ensureStateDir` first, and nothing resolves against it: every caret
 * path is absolute from `stateDir()`, and the one path arriving from outside —
 * the agent's `planFilePath` — is absolute by contract. */
export const DAEMON_CWD = "/";

/** Spawn the detached daemon, pinned to `DAEMON_CWD` and with stdout/stderr
 * redirected to daemon-stderr.log. */
export function spawnDaemon(s: Settings, spawn: typeof Bun.spawn = Bun.spawn): void {
  const out = openDaemonStderr(s);
  spawn(daemonCommand(), {
    cwd: DAEMON_CWD,
    stdio: ["ignore", out, out],
    detached: true,
    env: process.env,
  }).unref();
}

/** `backoff`'s sleep for `attempt`, before its jitter. */
function backoffFloorMs(attempt: number): number {
  return Math.min(150 * 2 ** attempt, 1500);
}

export async function backoff(attempt: number): Promise<void> {
  await Bun.sleep(backoffFloorMs(attempt) + Math.floor(Math.random() * 150));
}

const PROD_MAX_ATTEMPTS = 12;

/** Production's `windowMs`: what `PROD_MAX_ATTEMPTS` backoffs take at the least. */
export const SUPERVISOR_WINDOW_MS = Array.from({ length: PROD_MAX_ATTEMPTS }, (_, attempt) =>
  backoffFloorMs(attempt),
).reduce((sum, ms) => sum + ms, 0);

/** The production EnsureDeps. `service` builds this world's supervisor, and is called
 * only when this world's install recorded one. */
export async function prodEnsureDeps(s: Settings, service: () => Supervisor): Promise<EnsureDeps> {
  // The hook's own world (resolved state dir, EXC-461) — both its reuse
  // identity and the retire fallback's SIGTERM gate.
  const world = stateDir();
  return {
    // The supervisor is machine-wide, so only the world that installed it may cycle it.
    // Not `[daemon].resident`: that defaults on in every world, dev ones included.
    service: existsSync(launcherServiceFile()) ? service() : undefined,
    baseUrl: `http://localhost:${getPort(s)}`,
    currentBuild: await currentBuildId(),
    currentVersion: VERSION,
    currentStateDir: world,
    health: httpHealth,
    readLock: readDaemonLock,
    isAlive: isPidAlive,
    retire: (baseUrl, lock) => retireDaemon(baseUrl, lock, world),
    removeLock: removeDaemonLock,
    spawn: () => spawnDaemon(s),
    backoff,
    maxAttempts: PROD_MAX_ATTEMPTS,
    now: () => performance.now(),
    windowMs: SUPERVISOR_WINDOW_MS,
  };
}
