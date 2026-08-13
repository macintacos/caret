import { afterEach, expect, test } from "bun:test";
import { closeSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

import { setupTempStateDir } from "@test/support/env.ts";
import { ndjsonRecords } from "@test/support/ndjson.ts";
import { daemonStderrLogFile, ensureLogsDir, logArchiveDir, logFile } from "@/config/paths.ts";
import { DEFAULTS } from "@/config/settings.ts";
import { ensureDaemon, openDaemonStderr, retireDaemon } from "@/daemon/lifecycle.ts";
import { setLogLevel } from "@/lib/log.ts";

// Point the state dir at a throwaway temp dir so the debug-level instrumentation
// tests append to a disposable caret.log instead of the real ~/.local/state/caret.
setupTempStateDir("caret-daemon-lifecycle-");
afterEach(() => setLogLevel("info")); // undo any per-test level change

/** Parse caret.log into NDJSON records ([] when the file doesn't exist). */
function logRecords(): Array<Record<string, unknown>> {
  try {
    return ndjsonRecords(readFileSync(logFile(), "utf-8"));
  } catch {
    return [];
  }
}

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
    readLock: () => null,
    isAlive: () => false,
    retire: async () => true,
    removeLock: () => {},
    spawn: () => {},
    backoff: async () => {},
    maxAttempts: 5,
    ...over,
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
  const recs = logRecords().filter((r) => r.step === "spawn");
  expect(recs.some((r) => r.msg === "daemon spawned")).toBe(true);
});

test("ensureDaemon logs the stale-daemon retire at debug", async () => {
  setLogLevel("debug");
  let retires = 0;
  let spawns = 0;
  await ensureDaemon(
    ensureDeps({
      health: async () => {
        if (retires === 0) return { service: "caret", build: "b0", version: "v1" };
        if (spawns === 0) return null;
        return { service: "caret", build: "b1", version: "v1" };
      },
      retire: async () => {
        retires++;
        return true;
      },
      spawn: () => spawns++,
    }),
  );
  const recs = logRecords().filter((r) => r.step === "retire");
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
  const recs = logRecords().filter((r) => r.step === "spawn");
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
  let retires = 0;
  let spawns = 0;
  const url = await ensureDaemon(
    ensureDeps({
      // Old daemon (b0) answers until retired; the port frees; a fresh daemon (b1) binds.
      health: async () => {
        if (retires === 0) return { service: "caret", build: "b0", version: "v1" };
        if (spawns === 0) return null;
        return { service: "caret", build: "b1", version: "v1" };
      },
      retire: async () => {
        retires++;
        return true;
      },
      spawn: () => spawns++,
    }),
  );
  expect(retires).toBe(1);
  expect(spawns).toBe(1);
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
  let retires = 0;
  let spawns = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => {
        if (retires === 0) {
          return { service: "caret", build: "b0", version: "v1", stateDir: "/my/world" };
        }
        if (spawns === 0) return null;
        return { service: "caret", build: "b1", version: "v1", stateDir: "/my/world" };
      },
      retire: async () => {
        retires++;
        return true;
      },
      spawn: () => spawns++,
    }),
  );
  expect(retires).toBe(1);
  expect(spawns).toBe(1);
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
