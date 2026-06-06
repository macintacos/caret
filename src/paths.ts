// State/config directory and file-path resolution. Every path under caret's two
// XDG roots is resolved here, lazily, so tests can override XDG_STATE_HOME /
// XDG_CONFIG_HOME per-case. (The CARET_* tunables and their accessors live in
// src/settings.ts since EXC-430; daemon identity/build fingerprinting lives in
// src/build-id.ts.)

import { homedir } from "node:os";

/** Resolve a caret directory under one of the two XDG roots: `$<envVar>/caret`
 * or `<homedir()>/<fallback>/caret`. The shared template behind stateDir() and
 * configDir(); read lazily so tests can override the env var per-case. */
function xdgDir(envVar: string, fallback: string): string {
  const base = process.env[envVar] || `${homedir()}/${fallback}`;
  return `${base}/caret`;
}

/** Root state dir: $XDG_STATE_HOME/caret or ~/.local/state/caret. Read lazily
 * so tests can override XDG_STATE_HOME per-case. */
export function stateDir(): string {
  return xdgDir("XDG_STATE_HOME", ".local/state");
}

/** Directory holding one <id>.json per persisted review. */
export function reviewsDir(): string {
  return `${stateDir()}/reviews`;
}

/** Root config dir: $XDG_CONFIG_HOME/caret or ~/.config/caret. Read lazily so
 * tests can override XDG_CONFIG_HOME per-case. Deliberately separate from
 * stateDir(): config survives `mise run dev` wiping XDG_STATE_HOME. */
export function configDir(): string {
  return xdgDir("XDG_CONFIG_HOME", ".config");
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
