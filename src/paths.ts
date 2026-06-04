// State/config directory and identity-signature resolution. (The CARET_*
// tunables and their accessors live in src/settings.ts since EXC-430.)
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

/** Root config dir: $XDG_CONFIG_HOME/caret or ~/.config/caret. Read lazily so
 * tests can override XDG_CONFIG_HOME per-case. Deliberately separate from
 * stateDir(): config survives `mise run dev` wiping XDG_STATE_HOME. */
export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || `${homedir()}/.config`;
  return `${base}/caret`;
}

/** User-editable settings file (see src/settings.ts). Single source of truth
 * for the path. */
export function configFile(): string {
  return `${configDir()}/config.toml`;
}

/** Machine-global UI prefs (last-used approve mode). One shared file under
 * stateDir; last-write-wins. Separate from the per-review JSON in reviewsDir(). */
export function prefsFile(): string {
  return `${stateDir()}/prefs.json`;
}

/** Leveled NDJSON log for the short-lived `caret review` hook process (info
 * default; see log.ts). Single source of truth for the path, shared by the
 * writer and `/caret:debug`. */
export function logFile(): string {
  return `${stateDir()}/caret.log`;
}

/** Log for the detached daemon process (its stdout/stderr — leveled NDJSON
 * plus any raw crash output — is redirected here by spawnDaemon). Resolved
 * here so spawnDaemon and `/caret:debug` agree. */
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
 * `version` are optional so a partial/legacy lock still parses; `stateDir`/
 * `instanceId` (EXC-461) identify which world and which boot wrote the lock,
 * optional for the same reason. stateDir is identifying (contains the
 * username) — never log it; log instanceId instead. */
export interface DaemonLock {
  pid: number;
  port: number;
  build?: string;
  version?: string;
  startedAt?: number;
  stateDir?: string;
  instanceId?: string;
}
