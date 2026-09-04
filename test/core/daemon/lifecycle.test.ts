import { afterEach, expect, test } from "bun:test";
import {
  closeSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { ensureDaemonNoOps } from "@test/support/ensure-daemon-deps.ts";
import { setupTempStateDir } from "@test/support/env.ts";
import { caretLogRecords } from "@test/support/ndjson.ts";
import { daemonLock, daemonStderrLogFile, ensureLogsDir, logArchiveDir } from "@/config/paths.ts";
import { DEFAULTS } from "@/config/settings.ts";
import {
  DAEMON_CWD,
  ensureDaemon,
  openDaemonStderr,
  removeOwnDaemonLock,
  retireDaemon,
  spawnDaemon,
} from "@/daemon/lifecycle.ts";
import { setLogLevel } from "@/lib/log.ts";

// Point the state dir at a throwaway temp dir so the debug-level instrumentation
// tests append to a disposable caret.log instead of the real ~/.local/state/caret.
setupTempStateDir("caret-daemon-lifecycle-");
afterEach(() => setLogLevel("info")); // undo any per-test level change

// ---- ensureDaemon ----

function ensureDeps(over: Partial<Parameters<typeof ensureDaemon>[0]> = {}) {
  return {
    baseUrl: "http://localhost:42718",
    currentBuild: "b1",
    currentVersion: "v1",
    currentStateDir: "/my/world",
    health: async () =>
      ({ service: "caret", build: "b1", version: "v1", stateDir: "/my/world" }) as {
        service?: string;
        build?: string;
        version?: string;
        stateDir?: string;
      } | null,
    ...ensureDaemonNoOps(),
    ...over,
  };
}

/**
 * A health/retire/spawn trio simulating a stale build (b0) that answers until
 * retired, then a fresh build (b1) that binds once the port frees. `stateDir`,
 * when given, rides both health responses — the world-identity-safe variant of
 * the same scenario.
 */
function staleThenFreshDaemon(stateDir?: string): {
  counts: { retires: number; spawns: number };
  deps: Pick<Parameters<typeof ensureDaemon>[0], "health" | "retire" | "spawn">;
} {
  const counts = { retires: 0, spawns: 0 };
  const health = (build: string) =>
    stateDir === undefined
      ? { service: "caret", build, version: "v1" }
      : { service: "caret", build, version: "v1", stateDir };
  return {
    counts,
    deps: {
      health: async () => {
        if (counts.retires === 0) return health("b0");
        if (counts.spawns === 0) return null;
        return health("b1");
      },
      retire: async () => {
        counts.retires++;
        return true;
      },
      spawn: () => counts.spawns++,
    },
  };
}

test("ensureDaemon returns immediately when the daemon is already healthy", async () => {
  let spawns = 0;
  const url = await ensureDaemon(ensureDeps({ spawn: () => spawns++ }));
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(0);
});

test("ensureDaemon spawns when the port is refused, then connects", async () => {
  let spawns = 0;
  let checks = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
      spawn: () => spawns++,
    }),
  );
  expect(spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

test("ensureDaemon throws a clear error when a non-caret process holds the port", async () => {
  await expect(
    ensureDaemon(ensureDeps({ health: async () => ({ service: "other" }) })),
  ).rejects.toThrow(/CARET_PORT/);
});

test("ensureDaemon swallows an EADDRINUSE spawn race and connects to the winner", async () => {
  let checks = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
      spawn: () => {
        const e = new Error("listen EADDRINUSE") as Error & { code?: string };
        e.code = "EADDRINUSE";
        throw e;
      },
    }),
  );
  expect(url).toBe("http://localhost:42718");
});

test("ensureDaemon gives up after maxAttempts", async () => {
  await expect(
    ensureDaemon(ensureDeps({ health: async () => null, maxAttempts: 3 })),
  ).rejects.toThrow();
});

test("ensureDaemon logs the spawn attempt at debug", async () => {
  setLogLevel("debug");
  let checks = 0;
  await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
    }),
  );
  const recs = caretLogRecords().filter((r) => r.step === "spawn");
  expect(recs.some((r) => r.msg === "daemon spawned")).toBe(true);
});

test("ensureDaemon logs the stale-daemon retire at debug", async () => {
  setLogLevel("debug");
  const { deps } = staleThenFreshDaemon();
  await ensureDaemon(ensureDeps(deps));
  const recs = caretLogRecords().filter((r) => r.step === "retire");
  expect(recs.some((r) => r.msg === "stale daemon retiring")).toBe(true);
});

test("ensureDaemon logs orphan-lock removal at debug", async () => {
  setLogLevel("debug");
  let checks = 0;
  await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
      readLock: () => ({ pid: 4_000_000, port: 42718 }),
      isAlive: () => false,
    }),
  );
  const recs = caretLogRecords().filter((r) => r.step === "spawn");
  expect(recs.some((r) => r.msg === "orphan daemon lock removed")).toBe(true);
});

// ---- ensureDaemon: single-instance discovery + graceful takeover (EXC-406) ----

test("ensureDaemon reuses a same-build daemon (no spawn, no retire)", async () => {
  let spawns = 0;
  let retires = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => ({ service: "caret", build: "b1", version: "v1" }),
      spawn: () => spawns++,
      retire: async () => {
        retires++;
        return true;
      },
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(0);
  expect(retires).toBe(0);
});

// `takeover: false` is what a mid-review reconnect passes. The daemon answering may
// be a NEWER build that took the port during an upgrade; retiring it would put this
// (older) client's build back in charge, and since a reconnect repeats on every
// dropped poll it would keep undoing the upgrade. Falsifiable: with the flag ignored,
// the daemon is retired on every attempt until maxAttempts, so `retires` climbs off 0.
test("ensureDaemon with takeover:false attaches to a different-build daemon", async () => {
  let retires = 0;
  let spawns = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => ({ service: "caret", build: "b2", version: "v2", stateDir: "/my/world" }),
      retire: async () => {
        retires++;
        return true;
      },
      spawn: () => spawns++,
    }),
    { takeover: false },
  );
  expect(url).toBe("http://localhost:42718");
  expect(retires).toBe(0);
  expect(spawns).toBe(0);
});

// Attaching is not "never spawn": a daemon that died with nothing replacing it leaves
// the review unservable, and this client is then the only candidate.
test("ensureDaemon with takeover:false still spawns when nothing holds the port", async () => {
  let spawns = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => (spawns === 0 ? null : { service: "caret", build: "b1", version: "v1" }),
      spawn: () => spawns++,
    }),
    { takeover: false },
  );
  expect(spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

// The foreign-world refusal outranks attaching: cross-attaching another world's
// daemon writes this world's reviews into its state dir (EXC-461).
test("ensureDaemon with takeover:false still refuses a foreign world", async () => {
  await expect(
    ensureDaemon(
      ensureDeps({
        health: async () => ({
          service: "caret",
          build: "b2",
          version: "v2",
          stateDir: "/other/world",
        }),
      }),
      { takeover: false },
    ),
  ).rejects.toThrow(/different caret world/);
});

test("ensureDaemon retires a stale-build daemon, then reuses the fresh respawn", async () => {
  const { counts, deps } = staleThenFreshDaemon();
  const url = await ensureDaemon(ensureDeps(deps));
  expect(counts.retires).toBe(1);
  expect(counts.spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

test("ensureDaemon treats a version mismatch as stale even when the build matches", async () => {
  let retires = 0;
  await ensureDaemon(
    ensureDeps({
      health: async () => ({ service: "caret", build: "b1", version: "v0" }),
      retire: async () => {
        retires++;
        return true;
      },
      maxAttempts: 1,
    }),
  );
  expect(retires).toBe(1);
});

test("ensureDaemon removes an orphan lock (dead PID) before spawning", async () => {
  let removed = 0;
  let spawns = 0;
  let checks = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
      readLock: () => ({ pid: 999999, port: 42718 }),
      isAlive: () => false,
      removeLock: () => removed++,
      spawn: () => spawns++,
    }),
  );
  expect(removed).toBe(1);
  expect(spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

test("a stale daemon that cannot be retired is reused, never denied", async () => {
  let retires = 0;
  // A pre-fix daemon: no /api/retire and no lock, so retire can do nothing (false).
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => ({ service: "caret", build: "b0", version: "v0" }),
      retire: async () => {
        retires++;
        return false;
      },
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect(retires).toBe(1);
});

// ---- ensureDaemon: world identity — no cross-world attach (EXC-461) ----

test("ensureDaemon throws on a foreign-world daemon, never retires or spawns", async () => {
  let retires = 0;
  let spawns = 0;
  await expect(
    ensureDaemon(
      ensureDeps({
        health: async () => ({
          service: "caret",
          build: "b1",
          version: "v1",
          stateDir: "/other/world",
        }),
        retire: async () => {
          retires++;
          return true;
        },
        spawn: () => spawns++,
      }),
    ),
  ).rejects.toThrow(/different caret world/);
  expect(retires).toBe(0);
  expect(spawns).toBe(0);
});

test("ensureDaemon reuses a same-world same-build daemon", async () => {
  let spawns = 0;
  const url = await ensureDaemon(ensureDeps({ spawn: () => spawns++ }));
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(0);
});

test("ensureDaemon retires a same-world stale daemon (EXC-406 preserved)", async () => {
  const { counts, deps } = staleThenFreshDaemon("/my/world");
  const url = await ensureDaemon(ensureDeps(deps));
  expect(counts.retires).toBe(1);
  expect(counts.spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

test("the never-deny fallback refuses a foreign-world daemon", async () => {
  let calls = 0;
  await expect(
    ensureDaemon(
      ensureDeps({
        maxAttempts: 2,
        // Refused throughout the loop; a foreign daemon answers only at the
        // exhausted-fallback health check.
        health: async () =>
          ++calls <= 2
            ? null
            : { service: "caret", build: "b1", version: "v1", stateDir: "/other/world" },
      }),
    ),
  ).rejects.toThrow(/different caret world/);
});

test("the never-deny fallback still reuses a same-world stale daemon", async () => {
  let calls = 0;
  const url = await ensureDaemon(
    ensureDeps({
      maxAttempts: 2,
      health: async () =>
        ++calls <= 2
          ? null
          : { service: "caret", build: "b9", version: "v9", stateDir: "/my/world" },
    }),
  );
  expect(url).toBe("http://localhost:42718");
});

// ---- retireDaemon: SIGTERM fallback is gated on the lock's world (EXC-461) ----

// http://127.0.0.1:1 — nothing listens there, so the /api/retire attempt fails
// fast and the SIGTERM fallback is what's under test. The injected kill spy
// keeps the test from signaling anything real; pid is our own (always alive).

test("retireDaemon does not SIGTERM a foreign world's lock pid", async () => {
  let kills = 0;
  const ok = await retireDaemon(
    "http://127.0.0.1:1",
    { pid: process.pid, port: 1, stateDir: "/other/world" },
    "/my/world",
    () => kills++,
  );
  expect(ok).toBe(false);
  expect(kills).toBe(0);
});

test("retireDaemon SIGTERMs a same-world lock pid", async () => {
  let kills = 0;
  const ok = await retireDaemon(
    "http://127.0.0.1:1",
    { pid: process.pid, port: 1, stateDir: "/my/world" },
    "/my/world",
    () => kills++,
  );
  expect(ok).toBe(true);
  expect(kills).toBe(1);
});

test("retireDaemon treats a legacy lock (no stateDir) as same-world", async () => {
  let kills = 0;
  const ok = await retireDaemon(
    "http://127.0.0.1:1",
    { pid: process.pid, port: 1 },
    "/my/world",
    () => kills++,
  );
  expect(ok).toBe(true);
  expect(kills).toBe(1);
});

// ---- openDaemonStderr (EXC-1068) ----

test("openDaemonStderr creates daemon-stderr.log at 0600 inside logs/", () => {
  const fd = openDaemonStderr(DEFAULTS);
  expect(fd).not.toBe("ignore");
  closeSync(fd as number);
  expect(statSync(daemonStderrLogFile()).mode & 0o777).toBe(0o600);
});

test("openDaemonStderr tightens an upgraded install's world-readable stderr log", () => {
  ensureLogsDir();
  writeFileSync(daemonStderrLogFile(), "old crash output\n", { mode: 0o644 });
  // openSync's mode argument only applies on create, so an existing file needs
  // the explicit chmod — without it an upgrade keeps the umask-derived mode.
  closeSync(openDaemonStderr(DEFAULTS) as number);
  expect(statSync(daemonStderrLogFile()).mode & 0o777).toBe(0o600);
});

test("openDaemonStderr rotates an oversized stderr log before reopening it", () => {
  ensureLogsDir();
  writeFileSync(daemonStderrLogFile(), "x".repeat(200_000));
  const s = { ...DEFAULTS, logging: { ...DEFAULTS.logging, max_size: 65_536 } };
  closeSync(openDaemonStderr(s) as number);
  expect(statSync(daemonStderrLogFile()).size).toBe(0);
  expect(readdirSync(logArchiveDir())).toEqual([
    expect.stringMatching(/^daemon-stderr-.*\.log\.gz$/),
  ]);
});

// ---- daemon cwd (EXC-1155) ----

// A Bun process whose cwd has been unlinked cannot posix_spawn anything at all,
// absolute paths included — the failure that stranded daemons started inside an
// exec worktree later torn down with its PR. Run in a subprocess because it
// chdir()s into a directory it then deletes. Only the positive direction is
// asserted: that the *unset*-cwd spawn fails is a Bun behaviour unconfirmed off
// macOS, while an explicit live cwd surviving is the contract DAEMON_CWD buys.
const DEAD_CWD_PROBE = `
const { existsSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const dir = mkdtempSync(join(tmpdir(), "caret-dead-cwd-"));
process.chdir(dir);
rmSync(dir, { recursive: true, force: true });
// Fail loudly rather than passing vacuously if the cwd outlived the unlink.
if (existsSync(dir)) process.exit(3);
const proc = Bun.spawn([process.execPath, "--version"], { cwd: process.argv[1], stdout: "ignore" });
process.exit(await proc.exited);
`;

test("a spawn from DAEMON_CWD survives the spawning process losing its own cwd", async () => {
  const probe = Bun.spawn([process.execPath, "-e", DEAD_CWD_PROBE, DAEMON_CWD], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  expect(await probe.exited).toBe(0);
});

test("spawnDaemon pins the daemon's cwd to DAEMON_CWD", () => {
  const calls: Array<{ cwd?: string; stdio?: unknown[] }> = [];
  const spawn = ((_argv: string[], opts: { cwd?: string; stdio?: unknown[] }) => {
    calls.push(opts);
    return { unref: () => {} };
  }) as unknown as typeof Bun.spawn;

  spawnDaemon(DEFAULTS, spawn);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.cwd).toBe(DAEMON_CWD);
  // The pin only buys anything if that directory outlives every project dir.
  expect(existsSync(DAEMON_CWD)).toBe(true);
  // openDaemonStderr handed the fake a real fd, as the sibling tests above do.
  const out = calls[0]?.stdio?.[1];
  if (typeof out === "number") closeSync(out);
});

// ---- removeOwnDaemonLock ----

// A daemon tearing ITSELF down must remove its own lock and nothing else: the
// path may hold the lock of whichever daemon won the port race, and unlinking
// that one strands a live daemon nothing can find. The ownership check is what
// lets the cleanup be wired BEFORE the bind, closing the signal window in
// runDaemon.
test("removeOwnDaemonLock removes a lock naming this process", () => {
  mkdirSync(dirname(daemonLock()), { recursive: true });
  writeFileSync(daemonLock(), JSON.stringify({ pid: process.pid, port: 42718 }));
  removeOwnDaemonLock();
  expect(existsSync(daemonLock())).toBe(false);
});

test("removeOwnDaemonLock keeps a lock naming another process", () => {
  mkdirSync(dirname(daemonLock()), { recursive: true });
  writeFileSync(daemonLock(), JSON.stringify({ pid: process.pid + 1, port: 42718 }));
  removeOwnDaemonLock();
  expect(existsSync(daemonLock())).toBe(true);
  unlinkSync(daemonLock());
});

test("removeOwnDaemonLock tolerates a missing or unreadable lock", () => {
  mkdirSync(dirname(daemonLock()), { recursive: true });
  expect(() => removeOwnDaemonLock()).not.toThrow();
  writeFileSync(daemonLock(), "{ not json");
  expect(() => removeOwnDaemonLock()).not.toThrow();
  expect(existsSync(daemonLock())).toBe(true);
  unlinkSync(daemonLock());
});
