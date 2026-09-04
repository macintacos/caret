// Unit coverage for the dev task's non-supervisory logic (scripts/tasks/dev/dev-env.ts):
// port-mode resolution, the dev lock reader's guards, and the bounded
// port-discovery loop — the seams the bash task now delegates to.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_PORT } from "@/config/constants.ts";
import {
  DAEMON_DIED,
  discoverPort,
  NO_USABLE_LOCK,
  PRODUCTION_DEFAULT_PORT,
  readDevLockPort,
  resolvePortMode,
} from "@/tasks/dev/dev-env.ts";

// ---- resolvePortMode ----

test("resolvePortMode is ephemeral when CARET_DEV_PORT is unset or blank", () => {
  expect(resolvePortMode(undefined)).toEqual({ kind: "ephemeral" });
  expect(resolvePortMode("")).toEqual({ kind: "ephemeral" });
});

test("resolvePortMode pins a fixed port when set", () => {
  expect(resolvePortMode("5050")).toEqual({ kind: "fixed", port: 5050 });
});

test("resolvePortMode rejects the production default port", () => {
  // A CARET_DEV_PORT of 42718 would squat an installed caret.
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

// ---- CLI consumption of the [dev] settings (EXC-558) ----
// dev-env.ts sources port/state-dir from src/config/settings.ts (CARET_DEV_* >
// [dev] key > default). Drive the real CLI as a subprocess with an isolated
// XDG_CONFIG_HOME so config and env both exercise that resolution.

const repoRoot = join(import.meta.dir, "..", "..");

async function withConfig(
  toml: string | null,
  fn: (env: Record<string, string>) => void | Promise<void>,
): Promise<void> {
  const cfgHome = await mkdtemp(join(tmpdir(), "caret-devenv-cfg-"));
  const stateHome = await mkdtemp(join(tmpdir(), "caret-devenv-state-"));
  if (toml !== null) {
    await mkdir(join(cfgHome, "caret"), { recursive: true });
    await writeFile(join(cfgHome, "caret", "config.toml"), toml);
  }
  // Blank CARET_DEV_* so a host export can't leak in; "" reads as unset.
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: cfgHome,
    XDG_STATE_HOME: stateHome,
    CARET_DEV_PORT: "",
    CARET_DEV_STATE_DIR: "",
    CARET_DEV_NEW_REVIEW_MS: "",
  } as Record<string, string>;
  try {
    await fn(env);
  } finally {
    await rm(cfgHome, { recursive: true, force: true });
    await rm(stateHome, { recursive: true, force: true });
  }
}

function devEnv(env: Record<string, string>, ...args: string[]): string {
  const r = Bun.spawnSync(["bun", "scripts/tasks/dev/dev-env.ts", ...args], { cwd: repoRoot, env });
  if (r.exitCode !== 0) throw new Error(`dev-env ${args.join(" ")} failed: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

test("state-dir prints the CARET_DEV_STATE_DIR override", async () => {
  await withConfig(null, (env) => {
    expect(devEnv({ ...env, CARET_DEV_STATE_DIR: "/tmp/dev-x" }, "state-dir")).toBe("/tmp/dev-x");
  });
});

test("state-dir prints [dev].state_dir from config when no env is set", async () => {
  await withConfig('[dev]\nstate_dir = "/cfg/state"\n', (env) => {
    expect(devEnv(env, "state-dir")).toBe("/cfg/state");
  });
});

test("state-dir prints empty when neither env nor config sets it", async () => {
  await withConfig(null, (env) => {
    expect(devEnv(env, "state-dir")).toBe("");
  });
});

test("port-mode pins [dev].port from config when no env is set", async () => {
  await withConfig("[dev]\nport = 5050\n", (env) => {
    expect(devEnv(env, "port-mode")).toBe("fixed 5050");
  });
});

test("port-mode prefers CARET_DEV_PORT over the config [dev].port", async () => {
  await withConfig("[dev]\nport = 5050\n", (env) => {
    expect(devEnv({ ...env, CARET_DEV_PORT: "6060" }, "port-mode")).toBe("fixed 6060");
  });
});

test("port-mode is ephemeral when neither env nor config sets a port", async () => {
  await withConfig(null, (env) => {
    expect(devEnv(env, "port-mode")).toBe("ephemeral");
  });
});
