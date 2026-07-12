// Unit coverage for the dev task's orchestration (scripts/tasks/dev/run.ts):
// the pure boot decisions (state-dir plan, daemon command, child env) and the
// supervision itself — driven through an injected spawn seam so the teardown
// and DAEMON_DIED paths get real coverage without launching bun/vite or the
// daemon. The pure protocol side lives in dev-driver.test.ts; the port-mode /
// lock guards in dev-env.test.ts.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { NEVER_IDLE_MS } from "../../src/constants.ts";
import { DEFAULTS } from "../../src/settings.ts";
import type { DriverOptions } from "../../scripts/tasks/dev/driver.ts";
import { DAEMON_DIED } from "../../scripts/tasks/dev/dev-env.ts";
import {
  childEnvFor,
  daemonCommand,
  type DevDeps,
  makeCleanup,
  planStateDir,
  runDev,
  type SpawnedChild,
} from "../../scripts/tasks/dev/run.ts";

// ---- planStateDir ----

test("planStateDir uses a named dir when one is configured, ignoring --persist", () => {
  expect(planStateDir("/cfg/state", false)).toEqual({ kind: "named", dir: "/cfg/state" });
  expect(planStateDir("/cfg/state", true)).toEqual({ kind: "named", dir: "/cfg/state" });
});

test("planStateDir is ephemeral when no dir is configured; --persist keeps it", () => {
  expect(planStateDir(undefined, false)).toEqual({ kind: "ephemeral", keep: false });
  expect(planStateDir("", false)).toEqual({ kind: "ephemeral", keep: false });
  expect(planStateDir(undefined, true)).toEqual({ kind: "ephemeral", keep: true });
});

// ---- daemonCommand ----

test("daemonCommand adds --ephemeral only in ephemeral mode", () => {
  expect(daemonCommand({ kind: "ephemeral" })).toContain("--ephemeral");
  expect(daemonCommand({ kind: "fixed", port: 5050 })).not.toContain("--ephemeral");
  expect(daemonCommand({ kind: "fixed", port: 5050 })).toEqual(["bun", "src/cli.ts", "daemon"]);
});

// ---- childEnvFor ----

test("childEnvFor isolates state and never idles; pins CARET_PORT only when fixed", () => {
  const fixed = childEnvFor("/tmp/world", { kind: "fixed", port: 6060 });
  expect(fixed.XDG_STATE_HOME).toBe("/tmp/world");
  expect(fixed.CARET_IDLE_MS).toBe(String(NEVER_IDLE_MS));
  expect(fixed.CARET_PORT).toBe("6060");
  // Ephemeral mode leaves CARET_PORT to be filled after port discovery.
  const eph = childEnvFor("/tmp/world", { kind: "ephemeral" });
  expect(eph.XDG_STATE_HOME).toBe("/tmp/world");
  expect("CARET_PORT" in eph && eph.CARET_PORT !== process.env.CARET_PORT).toBe(false);
});

// ---- makeCleanup ----

function fakeKillable() {
  return {
    killed: 0,
    kill() {
      this.killed++;
    },
  };
}

test("makeCleanup kills every child and wipes an ephemeral dir once", () => {
  const children = [fakeKillable(), fakeKillable()];
  const wiped: string[] = [];
  const cleanup = makeCleanup(children, {
    stateDirPath: "/tmp/eph",
    wipeOnExit: true,
    rm: (dir) => wiped.push(dir),
  });
  cleanup();
  cleanup(); // idempotent: a signal handler runs it, then 'exit' runs it again
  expect(children.map((c) => c.killed)).toEqual([1, 1]);
  expect(wiped).toEqual(["/tmp/eph"]);
});

test("makeCleanup keeps a persistent dir (never calls rm)", () => {
  const children = [fakeKillable()];
  const wiped: string[] = [];
  const cleanup = makeCleanup(children, {
    stateDirPath: "/cfg/state",
    wipeOnExit: false,
    rm: (dir) => wiped.push(dir),
  });
  cleanup();
  expect(children[0]?.killed).toBe(1);
  expect(wiped).toEqual([]);
});

// ---- runDev supervision (injected spawn seam) ----

class ExitSignal extends Error {}

interface FakeChild extends SpawnedChild {
  killed: number;
}

/** A spawn stand-in recording every call; the child whose command contains
 * `vite` resolves `exited` (so runDev proceeds to teardown), the rest stay
 * pending like real long-running processes. */
function capturingSpawn(viteCode = 0) {
  const calls: Array<{ cmd: string[]; env: Record<string, string> | undefined }> = [];
  const children: FakeChild[] = [];
  const spawn: DevDeps["spawn"] = (cmd, opts) => {
    const child: FakeChild = {
      pid: 1000 + calls.length,
      stderr: undefined,
      exited: cmd.includes("vite") ? Promise.resolve(viteCode) : new Promise<number>(() => {}),
      killed: 0,
      kill() {
        this.killed++;
      },
    };
    calls.push({ cmd, env: opts.env });
    children.push(child);
    return child;
  };
  return { spawn, calls, children };
}

/** Base deps with the real settings default (ephemeral: no named dir/port) and
 * no-op cleanup registration; individual tests override spawn/discoverPort/exit. */
function baseDeps(over: Partial<DevDeps>): DevDeps {
  return {
    loadSettings: () => DEFAULTS,
    spawn: capturingSpawn().spawn,
    discoverPort: async () => 40123,
    runDriver: () => {},
    installCleanupHandlers: () => {},
    exit: ((code: number): never => {
      throw new ExitSignal(String(code));
    }) as (code: number) => never,
    ...over,
  };
}

/** Clear the dev env overrides so runDev resolves to the ephemeral default,
 * restoring them afterward. withEnv can't span awaits, so save/restore inline. */
async function withCleanDevEnv(fn: () => Promise<void>): Promise<void> {
  const saved = {
    CARET_DEV_STATE_DIR: process.env.CARET_DEV_STATE_DIR,
    CARET_DEV_PORT: process.env.CARET_DEV_PORT,
  };
  delete process.env.CARET_DEV_STATE_DIR;
  delete process.env.CARET_DEV_PORT;
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("runDev supervision", () => {
  test("boots daemon+pretty+vite, runs the driver in-process, tears down on vite exit", async () => {
    await withCleanDevEnv(async () => {
      const { spawn, calls, children } = capturingSpawn(0);
      const driverCalls: DriverOptions[] = [];
      let exitCode: number | undefined;
      const deps = baseDeps({
        spawn,
        runDriver: (o) => driverCalls.push(o),
        exit: ((code: number): never => {
          exitCode = code;
          throw new ExitSignal(String(code));
        }) as (code: number) => never,
      });

      await expect(runDev({ numVersions: 4, notify: true }, deps)).rejects.toBeInstanceOf(
        ExitSignal,
      );

      // daemon (ephemeral), pino-pretty, then vite.
      expect(calls[0]?.cmd).toEqual(["bun", "src/cli.ts", "daemon", "--ephemeral"]);
      expect(calls[1]?.cmd[0]).toBe("bunx");
      expect(calls[1]?.cmd).toContain("pino-pretty");
      expect(calls[2]?.cmd).toEqual(["bunx", "vite"]);

      // The driver ran in-process with the discovered base and the parsed opts —
      // no argv round-trip, no re-parse (candidate 1).
      expect(driverCalls).toEqual([
        { base: "http://127.0.0.1:40123", numVersions: 4, notify: true, settings: DEFAULTS },
      ]);

      // Teardown killed every child and exited with vite's code.
      expect(children.every((c) => c.killed >= 1)).toBe(true);
      expect(exitCode).toBe(0);

      // Ephemeral state dir (recovered from the daemon's XDG_STATE_HOME) was wiped.
      const stateDir = calls[0]?.env?.XDG_STATE_HOME;
      expect(stateDir).toBeDefined();
      expect(existsSync(stateDir as string)).toBe(false);
    });
  });

  test("a daemon that dies before the port appears tears down and rethrows", async () => {
    await withCleanDevEnv(async () => {
      const { spawn, children } = capturingSpawn();
      const deps = baseDeps({
        spawn,
        discoverPort: async () => {
          throw new Error(DAEMON_DIED);
        },
      });

      await expect(runDev({ numVersions: 3, notify: false }, deps)).rejects.toThrow(DAEMON_DIED);

      // Only daemon + pretty were spawned (vite never reached), and both were
      // killed by the mid-boot cleanup rather than leaked.
      expect(children.length).toBe(2);
      expect(children.every((c) => c.killed >= 1)).toBe(true);
    });
  });
});
