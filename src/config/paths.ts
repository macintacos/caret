// State/config directory and file-path resolution. Every path under caret's two
// XDG roots is resolved here, lazily, so tests can override XDG_STATE_HOME /
// XDG_CONFIG_HOME per-case. (The CARET_* tunables and their accessors live in
// src/config/settings.ts since EXC-430; daemon identity/build fingerprinting lives in
// src/lib/build-id.ts.)

import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
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

/** Directory holding the downloaded rumdl binary + its formatting config
 * (EXC-828). caret owns this dir (off PATH) and installs rumdl into it on first
 * plan format; ensureStateDir() keeps it at 0700 like the rest of stateDir. */
export function rumdlDir(): string {
  return `${stateDir()}/rumdl`;
}

/** Absolute path to the downloaded rumdl binary. */
export function rumdlBin(): string {
  return `${rumdlDir()}/rumdl`;
}

/** Absolute path to rumdl's formatting-only config, written beside the binary. */
export function rumdlConfig(): string {
  return `${rumdlDir()}/rumdl.toml`;
}

/** Root config dir: $XDG_CONFIG_HOME/caret or ~/.config/caret. Read lazily so
 * tests can override XDG_CONFIG_HOME per-case. Separate from stateDir(), which
 * `mise run dev` isolates and wipes; which file inside this dir is read is
 * configFile()'s call — dev points CARET_CONFIG_FILE at config.dev.toml. */
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

/** Directory holding the three live logs. Separate from stateDir's root so a
 * rotation sweep can list one directory without stepping over reviews, prefs,
 * or the lock file (EXC-1068). */
export function logsDir(): string {
  return `${stateDir()}/logs`;
}

/** Directory holding the gzipped rotations of the live logs, each named
 * `<log>-<stamp>.log.gz`. Created lazily by the first rotation. */
export function logArchiveDir(): string {
  return `${logsDir()}/archive`;
}

/** Leveled NDJSON log for the short-lived `caret review` hook process (info
 * default; see log.ts). Single source of truth for the path, shared by the
 * writer and `/caret:debug`. */
export function logFile(): string {
  return `${logsDir()}/caret.log`;
}

/** The daemon's leveled NDJSON log — the path createDaemonLogger opens and
 * rotates. Pure NDJSON: raw crash output goes to daemonStderrLogFile(). */
export function daemonLogFile(): string {
  return `${logsDir()}/daemon.log`;
}

/** The detached daemon's raw stderr, which spawnDaemon redirects here. Holds
 * whatever the process writes outside the logger — stack traces from a crash
 * before or around the NDJSON sink — so daemon.log stays parseable. */
export function daemonStderrLogFile(): string {
  return `${logsDir()}/daemon-stderr.log`;
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

/** Create logsDir() at 0700 and migrate an install that predates it, moving a
 * top-level caret.log/daemon.log into logs/ and tightening it to 0600 (both
 * were umask-derived before EXC-1068). Every log writer calls this before
 * opening its destination, so the move happens once, on whichever process
 * starts first.
 *
 * Concurrency-safe without a lock: an existing destination means the migration
 * already ran, and renameSync is atomic, so two processes racing on the same
 * legacy file cannot lose data — the loser finds its source gone and swallows
 * the ENOENT. May throw like ensureStateDir; callers keep their own handling. */
export function ensureLogsDir(): void {
  ensureStateDir(logsDir());
  for (const name of ["caret.log", "daemon.log"]) {
    const from = `${stateDir()}/${name}`;
    const to = `${logsDir()}/${name}`;
    if (!existsSync(from) || existsSync(to)) continue;
    try {
      renameSync(from, to);
      chmodSync(to, 0o600);
    } catch {
      // Lost the race, or the legacy file is unreadable: either way the live
      // path is what matters and the writer opens it next.
    }
  }
}
