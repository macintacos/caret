import { describe, expect, test } from "bun:test";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";

import { setupTempStateDir } from "@test/support/env.ts";
import { ensureLogsDir, logArchiveDir, logFile, logsDir } from "@/config/paths.ts";
import { rotateIfOversized } from "@/lib/log-rotate.ts";

/** Write `bytes` of filler to `path`, creating logs/ first. */
function writeLog(path: string, bytes: number): void {
  ensureLogsDir();
  writeFileSync(path, "x".repeat(bytes), { mode: 0o600 });
}

/** The archive filenames currently on disk, sorted (the stamp is
 * lexicographically chronological, so this is oldest-first). */
function archives(): string[] {
  return existsSync(logArchiveDir()) ? readdirSync(logArchiveDir()).sort() : [];
}

function perms(path: string): number {
  return statSync(path).mode & 0o777;
}

const LOCK = () => `${logsDir()}/.rotate.lock`;

describe("rotateIfOversized", () => {
  setupTempStateDir("caret-rotate-");

  test("leaves a file at or under the threshold untouched", () => {
    writeLog(logFile(), 100);
    rotateIfOversized(logFile(), 100, 10);
    expect(statSync(logFile()).size).toBe(100);
    expect(archives()).toEqual([]);
  });

  test("empties an oversized file and archives it gzipped", () => {
    writeLog(logFile(), 500);
    rotateIfOversized(logFile(), 100, 10);
    expect(statSync(logFile()).size).toBe(0);
    expect(archives().length).toBe(1);
    expect(archives()[0]).toMatch(/^caret-\d{8}T\d{9}Z\.log\.gz$/);
  });

  test("the archive round-trips back to the original bytes", () => {
    const body = "the quick brown fox\n".repeat(50);
    ensureLogsDir();
    writeFileSync(logFile(), body);
    rotateIfOversized(logFile(), 100, 10);
    const gz = readFileSync(`${logArchiveDir()}/${archives()[0]}`);
    expect(Buffer.from(Bun.gunzipSync(gz)).toString("utf-8")).toBe(body);
  });

  test("an absent file is a no-op rather than a throw", () => {
    ensureLogsDir();
    expect(() => rotateIfOversized(logFile(), 100, 10)).not.toThrow();
    expect(archives()).toEqual([]);
  });

  test("the logs dir stays 0700 and the archive is written 0600", () => {
    writeLog(logFile(), 500);
    rotateIfOversized(logFile(), 100, 10);
    expect(perms(logArchiveDir())).toBe(0o700);
    expect(perms(`${logArchiveDir()}/${archives()[0]}`)).toBe(0o600);
  });

  // The invariant the copy-truncate design rests on: both writers open their
  // sinks O_APPEND, which re-seeks to EOF before every write, so an fd held
  // across the truncation resumes at offset 0 of the same inode — no reopen,
  // and no NUL padding out to the pre-truncation offset.
  test("an append-mode fd opened before rotation writes at offset 0 afterwards", () => {
    writeLog(logFile(), 500);
    const fd = openSync(logFile(), "a");
    try {
      rotateIfOversized(logFile(), 100, 10);
      writeSync(fd, "after\n");
    } finally {
      closeSync(fd);
    }
    const after = readFileSync(logFile());
    expect(after.toString("utf-8")).toBe("after\n");
    expect(after.includes(0)).toBe(false);
  });

  test("prunes oldest-first down to keep", () => {
    writeLog(logFile(), 500);
    mkdirSync(logArchiveDir(), { recursive: true });
    for (const stamp of ["20200101T000000000Z", "20210101T000000000Z", "20220101T000000000Z"]) {
      writeFileSync(`${logArchiveDir()}/caret-${stamp}.log.gz`, "old");
    }
    rotateIfOversized(logFile(), 100, 2);
    const kept = archives();
    expect(kept.length).toBe(2);
    // The fresh rotation plus the newest pre-existing archive survive.
    expect(kept[0]).toBe("caret-20220101T000000000Z.log.gz");
    expect(kept[1]).toMatch(/^caret-20[2-9]\d/);
  });

  test("keep = 0 archives nothing at all", () => {
    writeLog(logFile(), 500);
    rotateIfOversized(logFile(), 100, 0);
    expect(statSync(logFile()).size).toBe(0);
    expect(archives()).toEqual([]);
  });

  // The prune glob is anchored on the strict stamp pattern precisely so
  // daemon's sweep cannot reach daemon-stderr's archives — a loose `daemon-*`
  // would treat every daemon-stderr archive as its own and prune it.
  test("pruning daemon's archives never touches daemon-stderr's", () => {
    const daemonLog = `${logsDir()}/daemon.log`;
    writeLog(daemonLog, 500);
    mkdirSync(logArchiveDir(), { recursive: true });
    for (const stamp of ["20200101T000000000Z", "20210101T000000000Z"]) {
      writeFileSync(`${logArchiveDir()}/daemon-stderr-${stamp}.log.gz`, "stderr");
    }
    rotateIfOversized(daemonLog, 100, 1);
    expect(archives().filter((f) => f.startsWith("daemon-stderr-")).length).toBe(2);
    expect(archives().filter((f) => /^daemon-\d/.test(f)).length).toBe(1);
  });

  test("a held lock makes a concurrent rotation a no-op", () => {
    writeLog(logFile(), 500);
    writeFileSync(LOCK(), "");
    rotateIfOversized(logFile(), 100, 10);
    expect(statSync(logFile()).size).toBe(500);
    expect(archives()).toEqual([]);
  });

  test("a stale lock is taken over rather than disabling rotation forever", () => {
    writeLog(logFile(), 500);
    writeFileSync(LOCK(), "");
    const ancient = new Date(Date.now() - 120_000);
    utimesSync(LOCK(), ancient, ancient);
    rotateIfOversized(logFile(), 100, 10);
    expect(statSync(logFile()).size).toBe(0);
    expect(archives().length).toBe(1);
  });

  test("releases the lock so the next rotation can proceed", () => {
    writeLog(logFile(), 500);
    rotateIfOversized(logFile(), 100, 10);
    expect(existsSync(LOCK())).toBe(false);
    writeLog(logFile(), 500);
    rotateIfOversized(logFile(), 100, 10);
    expect(statSync(logFile()).size).toBe(0);
  });

  test("an unusable archive dir degrades without throwing or losing the log", () => {
    writeLog(logFile(), 500);
    // A regular file where the archive dir belongs: mkdir fails, so rotation
    // gives up BEFORE the truncate rather than emptying a log it cannot archive.
    writeFileSync(logArchiveDir(), "not a directory");
    expect(() => rotateIfOversized(logFile(), 100, 10)).not.toThrow();
    expect(statSync(logFile()).size).toBe(500);
    expect(existsSync(LOCK())).toBe(false);
  });
});
