// Size-triggered rotation for the live logs (EXC-1068). One entry point, called
// by all three sinks: the hook logger and the daemon logger check before each
// record they actually write, and spawnDaemon checks daemon-stderr.log once at
// spawn.
//
// Rotation is COPY-TRUNCATE, not rename-and-recreate. Every writer opens its
// sink in append mode (pino.destination defaults SonicBoom to append; spawnDaemon
// uses openSync(path, "a")), and POSIX O_APPEND re-seeks to EOF before every
// write — so after a truncation each outstanding fd resumes at offset 0 of the
// same inode, with no NUL padding. That is what lets the daemon's inherited fd
// and the several concurrent `caret review` hook writers survive a rotation with
// no reopen, no inode comparison per emit, and no archived inode for a stale fd
// to write into.
//
// The residual trade is the standard logrotate copy-truncate posture: the
// truncate is one syscall after the read, so the window in which a concurrent
// writer's record can be discarded unarchived is microseconds. Everything that
// can fail earlier — claiming the lock, creating the archive dir — happens
// BEFORE the read, so the common failures are clean no-ops rather than a log
// emptied into nothing.
//
// Like the logging module it serves, this never throws.

import {
  closeSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename } from "node:path";

import { ensureStateDir, logArchiveDir, logsDir } from "@/config/paths.ts";

/** A lock older than this is treated as abandoned. Without the takeover a
 * single SIGKILL mid-rotation would disable rotation permanently, handing back
 * exactly the unbounded growth this module exists to prevent. */
const STALE_LOCK_MS = 60_000;

/** UTC stamp for an archive name: filename-safe and lexicographically
 * chronological, so a plain sort orders archives by age
 * ("20260813T014233123Z"). */
function stamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "");
}

/** Size of `path`, or -1 when it can't be stat'd (absent, unreadable). */
function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

/** Claim the rotation lock: an atomic exclusive create, so of two hook
 * processes crossing the threshold at once exactly one proceeds. Returns false
 * when another rotation holds it — unless that lock is stale, in which case it
 * is removed and the claim retried once. */
function claimLock(lock: string): boolean {
  try {
    closeSync(openSync(lock, "wx", 0o600));
    return true;
  } catch {
    if (Date.now() - statSync(lock).mtimeMs < STALE_LOCK_MS) return false;
    unlinkSync(lock);
    closeSync(openSync(lock, "wx", 0o600));
    return true;
  }
}

/** Delete all but the newest `keep` archives of `name`. Matching is anchored on
 * the exact stamp shape rather than a `<name>-*` glob, so daemon's sweep cannot
 * reach daemon-stderr's archives. */
function prune(name: string, keep: number): void {
  const pattern = new RegExp(`^${name}-\\d{8}T\\d{9}Z\\.log\\.gz$`);
  const found = readdirSync(logArchiveDir())
    .filter((f) => pattern.test(f))
    .sort();
  for (const old of found.slice(0, Math.max(0, found.length - keep))) {
    try {
      unlinkSync(`${logArchiveDir()}/${old}`);
    } catch {
      // Another rotation got there first, or the file is unremovable.
    }
  }
}

/**
 * Archive `path` and empty it in place when it exceeds `maxSize` bytes,
 * retaining the newest `keep` gzipped archives of that log. A file at or under
 * the threshold costs one statSync and nothing else.
 *
 * Best-effort throughout: an absent file, a lock held by a concurrent
 * rotation, and an unusable archive dir all return quietly, and no failure
 * propagates to the caller — a logging failure must never destabilize the
 * process it is logging for.
 */
export function rotateIfOversized(path: string, maxSize: number, keep: number): void {
  try {
    if (sizeOf(path) <= maxSize) return;
    const lock = `${logsDir()}/.rotate.lock`;
    if (!claimLock(lock)) return;
    try {
      // Re-check under the lock: a rotation that completed while we waited
      // leaves the file small, and archiving it again would duplicate.
      if (sizeOf(path) <= maxSize) return;
      // Before the read, so a broken archive dir is a clean no-op rather than
      // a log emptied with nowhere to put its contents.
      ensureStateDir(logArchiveDir());
      const name = basename(path, ".log");
      const raw = readFileSync(path);
      truncateSync(path, 0); // one syscall after the read: the whole loss window
      if (keep > 0) {
        writeFileSync(`${logArchiveDir()}/${name}-${stamp()}.log.gz`, Bun.gzipSync(raw), {
          mode: 0o600,
        });
      }
      prune(name, keep);
    } finally {
      try {
        unlinkSync(lock);
      } catch {
        // Already gone: a stale-lock takeover reclaimed it.
      }
    }
  } catch {
    // Rotation is as non-essential as the logging it serves.
  }
}
