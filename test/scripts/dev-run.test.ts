// Unit coverage for the dev task's orchestration (scripts/tasks/dev/run.ts):
// the pure boot decisions (state-dir plan, daemon command, child env) and the
// supervision itself — driven through an injected spawn seam so the teardown
// and DAEMON_DIED paths get real coverage without launching bun/vite or the
// daemon. The pure protocol side lives in dev-driver.test.ts; the port-mode /
// lock guards in dev-env.test.ts.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withEnv } from "@test/support/env.ts";
import { NEVER_IDLE_MS } from "@/config/constants.ts";
import { DEFAULTS } from "@/config/settings.ts";
import { DAEMON_DIED } from "@/tasks/dev/dev-env.ts";
import type { DriverOptions } from "@/tasks/dev/driver.ts";
import {
  captureProcessOutput,
  childEnvFor,
  type DevDeps,
  daemonCommand,
  lineModeKeys,
  makeCleanup,
  planStateDir,
  runDev,
  type SpawnedChild,
  viteUrlFrom,
} from "@/tasks/dev/run.ts";

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
  expect(daemonCommand({ kind: "fixed", port: 5050 })).toEqual([
    "bun",
    "--no-orphans",
    "src/cli.ts",
    "daemon",
  ]);
});

// bun only honours the flag ahead of the script path, so the position is the
// contract, not just the presence (EXC-1219).
test("daemonCommand passes --no-orphans to bun, not to the daemon", () => {
  for (const mode of [{ kind: "ephemeral" }, { kind: "fixed", port: 5050 }] as const) {
    expect(daemonCommand(mode).indexOf("--no-orphans")).toBe(1);
  }
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
  // No fresh CARET_PORT in ephemeral mode — it only carries whatever process.env had.
  expect(eph.CARET_PORT).toBe(process.env.CARET_PORT);
});

test("childEnvFor threads the dev config path, and CARET_FRESH only when fresh", () => {
  // Normal dev: the daemon child reads config.dev.toml, and CARET_FRESH is absent.
  const normal = childEnvFor(
    "/tmp/world",
    { kind: "ephemeral" },
    { configFile: "/cfg/config.dev.toml" },
  );
  expect(normal.CARET_CONFIG_FILE).toBe("/cfg/config.dev.toml");
  expect(normal.CARET_FRESH).toBeUndefined();
  // --fresh: config points at a nonexistent path (→ defaults) and CARET_FRESH=1
  // signals the UI to reset its saved prefs.
  const fresh = childEnvFor(
    "/tmp/world",
    { kind: "ephemeral" },
    { configFile: "/nope.toml", fresh: true },
  );
  expect(fresh.CARET_CONFIG_FILE).toBe("/nope.toml");
  expect(fresh.CARET_FRESH).toBe("1");
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
  const calls: Array<{
    cmd: string[];
    env: Record<string, string> | undefined;
    stderr: unknown;
    stdout: unknown;
  }> = [];
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
    // Snapshot env at spawn time: real Bun.spawn snapshots it, and runDev mutates
    // the shared childEnv (CARET_PORT) afterward for Vite.
    calls.push({
      cmd,
      env: opts.env ? { ...opts.env } : undefined,
      stderr: opts.stderr,
      stdout: opts.stdout,
    });
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
    // No terminal UI and no keyboard, which is what a non-TTY boot resolves to
    // for real — so these cases exercise the inherited-stdio path the tests below
    // assert on. Both are injected rather than read off process: a suite that read
    // the real terminal would pass piped and fail at a developer's prompt.
    startTui: () => null,
    stdinIsTty: () => false,
    // Swallowed by default: runDev's boot line is real output, and eighteen of
    // these tests booting it would print eighteen lines into the unit suite's own
    // stream. The one test that cares collects it instead.
    log: () => {},
    ...over,
  };
}

/** Clear the dev env overrides so runDev resolves to the ephemeral default, and
 * undo whatever it mutates on XDG_STATE_HOME for the in-process driver — the
 * state env every case here needs isolated. */
function withCleanDevEnv(fn: () => Promise<void>): Promise<void> {
  return withEnv(
    {
      CARET_DEV_STATE_DIR: undefined,
      CARET_DEV_PORT: undefined,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    },
    fn,
  );
}

describe("runDev supervision", () => {
  test("boots daemon+pretty+vite, runs the driver in-process, tears down on vite exit", async () => {
    await withCleanDevEnv(async () => {
      const { spawn, calls, children } = capturingSpawn(0);
      const driverCalls: DriverOptions[] = [];
      const reported: string[] = [];
      let xdgAtDriver: string | undefined;
      let exitCode: number | undefined;
      const deps = baseDeps({
        spawn,
        log: (line) => reported.push(line),
        runDriver: (o) => {
          // Capture the state dir the in-process driver sees at call time.
          xdgAtDriver = process.env.XDG_STATE_HOME;
          driverCalls.push(o);
        },
        exit: ((code: number): never => {
          exitCode = code;
          throw new ExitSignal(String(code));
        }) as (code: number) => never,
      });

      await expect(
        runDev({ numVersions: 4, notify: true, persist: false }, deps),
      ).rejects.toBeInstanceOf(ExitSignal);

      expect(calls[0]?.cmd).toEqual(["bun", "--no-orphans", "src/cli.ts", "daemon", "--ephemeral"]);
      expect(calls[1]?.cmd[0]).toBe("tail");
      expect(calls[2]?.cmd[0]).toBe("bunx");
      expect(calls[2]?.cmd).toContain("pino-pretty");
      expect(calls[3]?.cmd).toEqual(["bunx", "vite"]);

      // The daemon owns logs/daemon.log (EXC-1068), so pino-pretty is fed by
      // tailing that file — not by the daemon's stderr, which carries only raw
      // crash output and, with no terminal UI, inherits the terminal.
      expect(calls[1]?.cmd.at(-1)).toBe(
        join(calls[0]?.env?.XDG_STATE_HOME as string, "caret", "logs", "daemon.log"),
      );
      expect(calls[0]?.stderr).toBe("inherit");

      // The boot line goes through the injected sink, not console.log: it is the
      // one thing runDev prints, and a suite that let it reach the terminal would
      // scribble three of these across `mise run test`'s own output.
      expect(reported).toHaveLength(1);
      expect(reported[0]).toMatch(
        /^caret dev: port=40123 state=\S+ config=\S+ fresh=0 persistent=0$/,
      );

      // The driver ran in-process with the discovered base and the parsed opts —
      // no argv round-trip, no re-parse.
      expect(driverCalls).toEqual([
        { base: "http://127.0.0.1:40123", numVersions: 4, notify: true, settings: DEFAULTS },
      ]);

      // The in-process driver sees the isolated dev state dir — its hook logging
      // (runReview → caret.log) would otherwise escape to ~/.local/state/caret.
      expect(xdgAtDriver).toBe(calls[0]?.env?.XDG_STATE_HOME);

      // The daemon child reads the dev config (config.dev.toml), not the
      // production config.toml, and — not being a --fresh run — carries no
      // CARET_FRESH (EXC-781).
      expect(calls[0]?.env?.CARET_CONFIG_FILE).toMatch(/\/caret\/config\.dev\.toml$/);
      expect(calls[0]?.env?.CARET_FRESH).toBeUndefined();

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

      await expect(runDev({ numVersions: 3, notify: false, persist: false }, deps)).rejects.toThrow(
        DAEMON_DIED,
      );

      // Only daemon + tail + pretty were spawned (vite never reached), and all
      // were killed by the mid-boot cleanup rather than leaked.
      expect(children.length).toBe(3);
      expect(children.every((c) => c.killed >= 1)).toBe(true);
    });
  });

  test("--state-dir names a kept dir and --port pins a fixed daemon port", async () => {
    await withCleanDevEnv(async () => {
      const stateDir = mkdtempSync(join(tmpdir(), "caret-dev-named."));
      const { spawn, calls } = capturingSpawn(0);
      const deps = baseDeps({ spawn });

      await expect(
        runDev({ numVersions: 3, notify: false, port: 45000, stateDir, persist: false }, deps),
      ).rejects.toBeInstanceOf(ExitSignal);

      // --port takes precedence: fixed mode, so no --ephemeral and the daemon
      // gets the pinned port through its env.
      expect(calls[0]?.cmd).toEqual(["bun", "--no-orphans", "src/cli.ts", "daemon"]);
      expect(calls[0]?.env?.CARET_PORT).toBe("45000");
      // --state-dir takes precedence: the named dir is used and kept, not wiped.
      expect(calls[0]?.env?.XDG_STATE_HOME).toBe(stateDir);
      expect(existsSync(stateDir)).toBe(true);

      rmSync(stateDir, { recursive: true, force: true });
    });
  });

  test("--persist keeps the ephemeral state dir on exit", async () => {
    await withCleanDevEnv(async () => {
      const { spawn, calls } = capturingSpawn(0);
      const deps = baseDeps({ spawn });

      await expect(
        runDev({ numVersions: 3, notify: false, persist: true }, deps),
      ).rejects.toBeInstanceOf(ExitSignal);

      // Ephemeral dir (no --state-dir), but --persist keeps it for inspection.
      const stateDir = calls[0]?.env?.XDG_STATE_HOME as string;
      expect(stateDir).toBeDefined();
      expect(existsSync(stateDir)).toBe(true);

      rmSync(stateDir, { recursive: true, force: true });
    });
  });

  test("with the terminal UI up, every child is piped into it instead of the terminal", async () => {
    await withCleanDevEnv(async () => {
      const { spawn, calls } = capturingSpawn(0);
      const written: string[] = [];
      let stopped = 0;
      const tui = {
        write: (s: string) => written.push(s),
        setStatus: () => {},
        lineCount: () => written.length,
        stop: () => stopped++,
      };
      const deps = baseDeps({ spawn, startTui: () => tui });

      await expect(
        runDev({ numVersions: 4, notify: false, persist: false }, deps),
      ).rejects.toBeInstanceOf(ExitSignal);

      // Nothing may inherit the terminal: the UI owns the screen, so an inherited
      // writer would paint straight over the frame.
      for (const call of calls) {
        expect(call.stdout).not.toBe("inherit");
        expect(call.stderr).not.toBe("inherit");
      }
      // Vite loses its TTY when piped and drops colour unless asked.
      expect(calls.at(-1)?.env?.FORCE_COLOR).toBe("1");
      // Teardown restores the terminal, not just the children.
      expect(stopped).toBeGreaterThan(0);

      rmSync(calls[0]?.env?.XDG_STATE_HOME as string, { recursive: true, force: true });
    });
  });

  test("reads the UI url out of Vite's banner, colours and all", () => {
    // The real banner, as Vite prints it: an arrow, padding, and SGR colour
    // around the URL. This is the only place the dev task can learn the UI port
    // — Vite chooses it, and auto-increments when 5173 is taken.
    expect(
      viteUrlFrom("  \x1b[32m➜\x1b[0m  \x1b[1mLocal\x1b[0m:   http://caret.localhost:5173/"),
    ).toBe("http://caret.localhost:5173");
    expect(viteUrlFrom("  ➜  Local:   http://caret.localhost:5174/")).toBe(
      "http://caret.localhost:5174",
    );
  });

  test("ignores lines that are not the Vite banner", () => {
    // A reformatted banner must leave the console showing what it already has,
    // never a wrong or half-parsed url.
    expect(viteUrlFrom("  ➜  Network: use --host to expose")).toBeNull();
    expect(viteUrlFrom("[caret dev driver] bootstrapped fake-plan.md")).toBeNull();
    expect(
      viteUrlFrom("caret: review this plan at http://caret.localhost:52241/?review=x"),
    ).toBeNull();
    expect(viteUrlFrom("")).toBeNull();
  });

  test("capturing process output leaves an already-bound terminal writer alone", () => {
    // The console paints through a writer bound before this call. If capturing
    // reached that binding too, every frame would be redirected into the log
    // buffer it had just rendered and the screen would freeze on the first paint.
    const terminal: string[] = [];
    const captured: string[] = [];
    const realWrite = process.stdout.write;
    const realLog = console.log;
    process.stdout.write = ((c: unknown) => {
      terminal.push(String(c));
      return true;
    }) as typeof process.stdout.write;
    const boundBefore = process.stdout.write.bind(process.stdout);
    try {
      captureProcessOutput({
        write: (s) => captured.push(s),
        setStatus: () => {},
        lineCount: () => 0,
        stop: () => {},
      });
      boundBefore("a painted frame");
      console.log("a log line");
    } finally {
      process.stdout.write = realWrite;
      console.log = realLog;
    }
    expect(terminal).toContain("a painted frame");
    // Bun's console writes straight to the fd, so patching the stream alone
    // misses it — the capture has to take console.* as well.
    expect(captured.join("")).toContain("a log line");
  });

  test("--plain skips the console entirely, keeping stdio inherited", async () => {
    await withCleanDevEnv(async () => {
      const { spawn, calls } = capturingSpawn(0);
      let started = 0;
      const deps = baseDeps({
        spawn,
        startTui: () => {
          started++;
          return null;
        },
      });

      await expect(
        runDev({ numVersions: 4, notify: false, persist: false, plain: true }, deps),
      ).rejects.toBeInstanceOf(ExitSignal);

      // Not merely ignored — never started, so the screen is never taken.
      expect(started).toBe(0);
      expect(calls[0]?.stderr).toBe("inherit");
      expect(calls.at(-1)?.stdout).toBe("inherit");

      rmSync(calls[0]?.env?.XDG_STATE_HOME as string, { recursive: true, force: true });
    });
  });

  test("the driver gets no key subscription when nothing owns a keyboard", async () => {
    await withCleanDevEnv(async () => {
      const { spawn, calls } = capturingSpawn(0);
      const driverCalls: DriverOptions[] = [];
      const deps = baseDeps({ spawn, runDriver: (o) => driverCalls.push(o) });

      await expect(
        runDev({ numVersions: 4, notify: false, persist: false }, deps),
      ).rejects.toBeInstanceOf(ExitSignal);

      // startTui returned null and stdin is not a terminal, so there is no
      // keyboard to read at all — not merely no console to forward from.
      expect(driverCalls[0]?.onKey).toBeUndefined();

      rmSync(calls[0]?.env?.XDG_STATE_HOME as string, { recursive: true, force: true });
    });
  });

  test("the driver reads keys line-mode when a terminal has no console on it", async () => {
    await withCleanDevEnv(async () => {
      const { spawn, calls } = capturingSpawn(0);
      const driverCalls: DriverOptions[] = [];
      const deps = baseDeps({
        spawn,
        runDriver: (o) => driverCalls.push(o),
        stdinIsTty: () => true,
      });

      await expect(
        runDev({ numVersions: 4, notify: false, persist: false }, deps),
      ).rejects.toBeInstanceOf(ExitSignal);

      // A terminal with no console on it still has a keyboard, read a line at a
      // time so Ctrl-C keeps reaching the signal handlers.
      expect(driverCalls[0]?.onKey).toBe(lineModeKeys);

      rmSync(calls[0]?.env?.XDG_STATE_HOME as string, { recursive: true, force: true });
    });
  });
});
