// State/config directory and file-path resolution. Every path under caret's two
// XDG roots is resolved here, lazily, so tests can override XDG_STATE_HOME /
// XDG_CONFIG_HOME per-case. (The CARET_* tunables and their accessors live in
// src/config/settings.ts since EXC-430; daemon identity/build fingerprinting lives in
// src/lib/build-id.ts.)

import { chmodSync, mkdirSync } from "node:fs";
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

/** User-editable settings file (see src/config/settings.ts). Single source of truth
 * for the path. CARET_CONFIG_FILE overrides it outright — the dev task points that
 * at config.dev.toml (and, under --fresh, at a nonexistent path so loadSettings
 * falls back to defaults), keeping `mise run dev` fully isolated from the
 * production config. A blank value counts as unset. */
export function configFile(): string {
  return process.env.CARET_CONFIG_FILE || `${configDir()}/config.toml`;
}

/** Dev-only settings file: $XDG_CONFIG_HOME/caret/config.dev.toml. The dev task
 * points CARET_CONFIG_FILE here so `mise run dev` reads its own config, never the
 * user's production config.toml (EXC-781). */
export function devConfigFile(): string {
  return `${configDir()}/config.dev.toml`;
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

/** Create `target` (the state dir, or a child like reviewsDir()) at 0700, the
 * single mode-enforcing path every mkdir-of-stateDir site routes through so the
 * dir holding plan bodies is never world-readable (EXC-539). Sync so both the
 * sync (log/lock/spawn) and async (store/prefs) callers share one helper.
 *
 * Recursive mkdir does NOT chmod an already-existing directory, so the root
 * mode is otherwise a create-order race — a no-mode caller (prefs, lock, spawn)
 * reaching it first leaves stateDir at the umask-derived 0755. We close that by
 * chmodding `target`, and when `target` lives under stateDir (e.g. reviewsDir),
 * tightening the root too. The helper may throw; callers keep their own failure
 * handling. */
export function ensureStateDir(target = stateDir()): void {
  mkdirSync(target, { recursive: true, mode: 0o700 });
  chmodSync(target, 0o700);
  const root = stateDir();
  if (target !== root && target.startsWith(`${root}/`)) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
  }
}
