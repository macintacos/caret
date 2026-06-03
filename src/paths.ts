// Port, state directory, and identity-signature resolution.
//
// Phase-0 spike outcome (the contract the rest of the code relies on): plan
// approval is gated via a `PermissionRequest` hook matching `ExitPlanMode` — NOT
// `PreToolUse` (which only permits the tool to run, so the native dialog still
// shows). See src/feedback.ts for the decision JSON this produces.

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import pkg from "../package.json" with { type: "json" };

/** The shipped version, read from package.json (one of the release-synced
 * manifests) at build time so it stays honest across releases. Hardcoding it was
 * a root cause of EXC-406: the daemon reported a stale "0.0.1" that could never
 * signal an upgrade. */
export const VERSION = pkg.version;
export const DEFAULT_PORT = 42718;

/** Identity signature returned by GET /api/health, used to detect a foreign
 * process squatting on the port. */
export const IDENTITY = { service: "caret", version: VERSION } as const;

/** Short content fingerprint of the served UI HTML — the daemon's staleness
 * signal. It changes whenever the embedded UI changes, so an upgraded binary's
 * build differs from a still-running older daemon's. Returns "no-ui" when no UI
 * is embedded (dev / fresh checkout), which compares equal across binaries in
 * that same UI-less state. */
export function buildHash(html: string | undefined): string {
  if (!html) return "no-ui";
  return createHash("sha256").update(html).digest("hex").slice(0, 12);
}

/** Resolve the daemon port: CARET_PORT (positive integer) or the default. */
export function getPort(): number {
  const raw = process.env.CARET_PORT;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return DEFAULT_PORT;
}

/** Root state dir: $XDG_STATE_HOME/caret or ~/.local/state/caret. Read lazily
 * so tests can override XDG_STATE_HOME per-case. */
export function stateDir(): string {
  const base = process.env.XDG_STATE_HOME || `${homedir()}/.local/state`;
  return `${base}/caret`;
}

/** Directory holding one <id>.json per persisted review. */
export function reviewsDir(): string {
  return `${stateDir()}/reviews`;
}

/** Machine-global UI prefs (last-used approve mode). One shared file under
 * stateDir; last-write-wins. Separate from the per-review JSON in reviewsDir(). */
export function prefsFile(): string {
  return `${stateDir()}/prefs.json`;
}

/** Errors-only log for the short-lived `caret review` hook process. Single
 * source of truth for the path, shared by the writer and `/caret:debug`. */
export function logFile(): string {
  return `${stateDir()}/caret.log`;
}

/** Log for the detached daemon process (its stdout/stderr is redirected here
 * by spawnDaemon). Resolved here so spawnDaemon and `/caret:debug` agree. */
export function daemonLogFile(): string {
  return `${stateDir()}/daemon.log`;
}

/** Single-instance lock file: written atomically on daemon bind and removed on
 * every exit path. Holds { pid, port, build, version, startedAt } so a newer
 * caret can discover and gracefully retire an older one (EXC-406). */
export function daemonLock(): string {
  return `${stateDir()}/daemon.lock`;
}

/** Contents of the daemon lock file. Written by the daemon on bind; read by a
 * starting caret to discover and gracefully retire an older one. `build`/
 * `version` are optional so a partial/legacy lock still parses. */
export interface DaemonLock {
  pid: number;
  port: number;
  build?: string;
  version?: string;
  startedAt?: number;
}

/** Idle auto-shutdown delay (ms). Overridable via CARET_IDLE_MS for tests. */
export function idleMs(): number {
  const raw = process.env.CARET_IDLE_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return 60_000;
}

/** Review timeout (ms): CARET_TIMEOUT seconds, default 3600s / 1h (< the 3900s
 * hook budget in hooks.json). After this, the hook fail-safe denies. */
export function reviewTimeoutMs(): number {
  const raw = process.env.CARET_TIMEOUT;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1000);
  }
  return 3_600_000;
}

/** Decision long-poll heartbeat (ms): the daemon returns a 204 "still pending"
 * after this window so the client re-polls before any socket idle timeout can
 * close the connection. CARET_HEARTBEAT_MS overrides; default 8s, comfortably
 * under the daemon's 30s Bun.serve idleTimeout. */
export function heartbeatMs(): number {
  const raw = process.env.CARET_HEARTBEAT_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return 8_000;
}
