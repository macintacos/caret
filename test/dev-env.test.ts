// Unit coverage for the dev task's non-supervisory logic (scripts/dev/dev-env.ts):
// port-mode resolution, the dev lock reader's guards, and the bounded
// port-discovery loop — the seams the bash task now delegates to.
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PORT } from "../src/constants.ts";
import {
  DAEMON_DIED,
  discoverPort,
  NO_USABLE_LOCK,
  PRODUCTION_DEFAULT_PORT,
  readDevLockPort,
  resolvePortMode,
} from "../scripts/dev/dev-env.ts";

// ---- resolvePortMode ----

test("resolvePortMode is ephemeral when CARET_DEV_PORT is unset or blank", () => {
  expect(resolvePortMode(undefined)).toEqual({ kind: "ephemeral" });
  expect(resolvePortMode("")).toEqual({ kind: "ephemeral" });
});

test("resolvePortMode pins a fixed port when set", () => {
  expect(resolvePortMode("5050")).toEqual({ kind: "fixed", port: 5050 });
});

test("resolvePortMode rejects the production default port", () => {
  // A CARET_DEV_PORT of 42718 would squat an installed caret (AC5).
  expect(() => resolvePortMode(String(DEFAULT_PORT))).toThrow(/production default/);
});

// ---- readDevLockPort ----

async function withLock(
  contents: string | object,
  fn: (lockPath: string, world: string) => void | Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "caret-devlock-"));
  const lockPath = join(dir, "daemon.lock");
  const world = join(dir, "caret");
  await writeFile(lockPath, typeof contents === "string" ? contents : JSON.stringify(contents));
  try {
    await fn(lockPath, world);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readDevLockPort returns the port for an own-world lock", async () => {
  await withLock({ pid: 123, port: 5051, stateDir: "WORLD" }, async (lockPath, _world) => {
    // The lock's stateDir must equal expectedStateDir; inject a matching one.
    expect(readDevLockPort(lockPath, "WORLD")).toBe(5051);
  });
});

test("readDevLockPort rejects a foreign-world lock", async () => {
  await withLock({ pid: 1, port: 5052, stateDir: "/some/other/world" }, async (lockPath, world) => {
    // A different stateDir means another session's daemon — never attach to it.
    expect(readDevLockPort(lockPath, world)).toBeNull();
  });
});

test("readDevLockPort rejects a lock with no stateDir (can't prove own world)", async () => {
  await withLock({ pid: 1, port: 5053 }, async (lockPath, world) => {
    expect(readDevLockPort(lockPath, world)).toBeNull();
  });
});

test("readDevLockPort rejects a non-positive or non-integer port", async () => {
  await withLock({ pid: 1, port: 0, stateDir: "W" }, async (lockPath) => {
    expect(readDevLockPort(lockPath, "W")).toBeNull();
  });
  await withLock({ pid: 1, port: -3, stateDir: "W" }, async (lockPath) => {
    expect(readDevLockPort(lockPath, "W")).toBeNull();
  });
  await withLock({ pid: 1, port: 1.5, stateDir: "W" }, async (lockPath) => {
    expect(readDevLockPort(lockPath, "W")).toBeNull();
  });
});

test("readDevLockPort returns null for a missing or unreadable lock", () => {
  expect(readDevLockPort("/nonexistent/daemon.lock", "W")).toBeNull();
});

test("readDevLockPort returns null for malformed JSON", async () => {
  await withLock("{ not json", async (lockPath, world) => {
    expect(readDevLockPort(lockPath, world)).toBeNull();
  });
});

// ---- discoverPort ----

const noSleep = async () => {};

test("discoverPort returns the port once the lock appears", async () => {
  // Null for the first two reads (lock not yet written), then the port.
  const reads = [null, null, 5060];
  let i = 0;
  const port = await discoverPort({
    readPort: () => reads[i++] ?? null,
    daemonAlive: () => true,
    sleep: noSleep,
  });
  expect(port).toBe(5060);
});

test("discoverPort aborts immediately when the daemon died before writing its lock", async () => {
  await expect(
    discoverPort({ readPort: () => null, daemonAlive: () => false, sleep: noSleep }),
  ).rejects.toThrow(DAEMON_DIED);
});

test("discoverPort refuses an OS-assigned production-default port", async () => {
  await expect(
    discoverPort({ readPort: () => DEFAULT_PORT, daemonAlive: () => true, sleep: noSleep }),
  ).rejects.toThrow(PRODUCTION_DEFAULT_PORT);
});

test("discoverPort throws after exhausting the attempt budget", async () => {
  let calls = 0;
  await expect(
    discoverPort({
      readPort: () => {
        calls++;
        return null;
      },
      daemonAlive: () => true,
      sleep: noSleep,
      attempts: 4,
    }),
  ).rejects.toThrow(NO_USABLE_LOCK);
  expect(calls).toBe(4);
});
