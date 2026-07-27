// Daemon takeover + lifecycle: discover whether a caret daemon of THIS build
// already owns the port, gracefully retire a stale one, spawn a fresh one, and
// clean orphan locks (EXC-406) — never denying a review because takeover failed.
// This module also owns the world-identity guards (EXC-461) and the lock
// read/write/liveness primitives the takeover loop and the discovery command
// share.

import { openSync, unlinkSync } from "node:fs";
import { normalize } from "node:path";

import { daemonLock, daemonLogFile, ensureStateDir, stateDir } from "@/config/paths.ts";
import { getPort, type Settings } from "@/config/settings.ts";
import { type HealthBody, httpHealth } from "@/daemon/client.ts";
import { buildKind, currentBuildId, type DaemonLock, VERSION } from "@/lib/build-id.ts";
import { readJsonFileSync } from "@/lib/json-file.ts";
import { logDebug, logWarn } from "@/lib/log.ts";

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

/** How a caller wants the port resolved when a daemon of another build holds it. */
export interface EnsureOptions {
  /** Whether to retire a different-build daemon and spawn this binary's own.
   * Defaults to true — starting a review, or prewarming, is when a build claims
   * the port. Pass false to ATTACH instead: return whichever same-world daemon is
   * answering, whatever its build, and spawn only when nothing is.
   *
   * A mid-review reconnect passes false, and the distinction is load-bearing. The
   * reconnecting client may be an OLD build whose review has outlived an upgrade;
   * letting it take over would install that old build as the port's owner, and
   * because it reconnects on every drop it would keep winning against the current
   * one indefinitely. Recovery must not double as installation. Attaching costs
   * nothing: reviews are persisted per world, so any same-world daemon can serve
   * the decision. */
  takeover?: boolean;
}

/** Ensure a caret daemon owns the port and return its base URL: reuse a same-build
 * daemon, gracefully retire a stale one and spawn a fresh daemon, and clean orphan
 * locks (EXC-406). `takeover: false` skips the retire-and-replace half — see
 * EnsureOptions. Never denies a review because takeover failed — an unretireable
 * stale daemon is reused (serving its old UI) rather than left unreachable. The
 * one exception: a foreign world's daemon (EXC-461) is neither reused nor
 * retired — that's a config conflict, and cross-attaching IS the bug. */
export async function ensureDaemon(deps: EnsureDeps, opts: EnsureOptions = {}): Promise<string> {
  const takeover = opts.takeover ?? true;
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
      // Attaching caller: this daemon is not ours, but it is this world's and it
      // is answering, which is all a resumed poll needs.
      if (!takeover) return deps.baseUrl;
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
  // src/cli.ts`) AND the npm bundle (`bun dist/cli.js`) run under bun and must
  // re-pass the script path — otherwise the spawned child is `[bun, "daemon"]`,
  // which has no script to run and never starts the daemon (EXC-643).
  if (buildKind() === "binary") return [process.execPath, "daemon"];
  return [process.execPath, process.argv[1] as string, "daemon"];
}

export function spawnDaemon(): void {
  // Route the detached daemon's stdout/stderr to a log file so failures are
  // diagnosable after the fact. Best-effort: fall back to discarding output.
  let out: number | "ignore" = "ignore";
  try {
    ensureStateDir();
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

export async function backoff(attempt: number): Promise<void> {
  const ms = Math.min(150 * 2 ** attempt, 1500) + Math.floor(Math.random() * 150);
  await Bun.sleep(ms);
}

export async function prodEnsureDeps(s: Settings): Promise<EnsureDeps> {
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
