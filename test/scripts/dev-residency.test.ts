// `mise run dev` beside a resident daemon: the dev task's daemon keeps its own port and
// state dir, and neither world's hook reaches the other world's daemon or the machine's
// supervisor. Real daemons, because the property is what two live processes leave each
// other — the dev task's own childEnvFor and daemonCommand drive the dev side.
import { afterEach, expect, mock, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  runCaretCli,
  spawnCaretDaemon,
  spawnEphemeralDaemon,
  untilLockWritten,
} from "@test/support/cli-process.ts";
import { withEnv } from "@test/support/env.ts";
import { freePort } from "@test/support/net.ts";
import { until } from "@test/support/poll.ts";
import { fakeServiceManager } from "@test/support/service-manager.ts";
import { launcherServiceFile } from "@/config/paths.ts";
import { loadSettings } from "@/config/settings.ts";
import { ensureDaemon, prodEnsureDeps, readDaemonLock } from "@/daemon/lifecycle.ts";
import * as buildId from "@/lib/build-id.ts";
import { childEnvFor, daemonCommand } from "@/tasks/dev/run.ts";

// As if a concurrent UI build rewrote ui/dist after both daemons booted.
mock.module("@/lib/build-id.ts", () => ({ ...buildId, currentBuildId: async () => "churned-ui" }));

// Real daemon boots stretch to seconds under preflight's concurrent load; see
// test/core/daemon/integration.test.ts for why the waits are patient-while-alive instead.
setDefaultTimeout(90_000);

interface Health {
  stateDir?: string;
  resident?: boolean;
  instanceId?: string;
}

const procs: Array<ReturnType<typeof Bun.spawn>> = [];
const tempDirs: string[] = [];
/** State homes whose daemon was spawned detached, so only its lock names it. */
const detachedHomes: string[] = [];

afterEach(async () => {
  for (const home of detachedHomes) {
    // A failed spawn can still leave a daemon that writes its lock a moment later.
    await until(() => lockIn(home) !== null, 3000);
    const pid = lockIn(home)?.pid;
    try {
      if (pid !== undefined) process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  for (const p of procs) p.kill("SIGKILL");
  await Promise.all(procs.map((p) => p.exited));
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  procs.length = 0;
  tempDirs.length = 0;
  detachedHomes.length = 0;
});

async function tempHome(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function lockIn(stateHome: string) {
  return withEnv({ XDG_STATE_HOME: stateHome }, readDaemonLock);
}

async function health(port: number): Promise<Health> {
  return (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as Health;
}

/** A path loadSettings finds absent, so a dev child boots from defaults rather than the
 * developer's own config.dev.toml. */
function noConfig(dir: string): string {
  return join(dir, "absent-config.toml");
}

/** Boot world A the way a supervisor runs caret, and record the launcher `service` record
 * its install would have written — which makes A the world that owns the supervisor. */
async function bootResident(stateHome: string) {
  // Pinned so the developer's own config.toml stays out of this daemon.
  const configFile = join(stateHome, "config.toml");
  writeFileSync(configFile, "");
  const { proc, lock } = await spawnEphemeralDaemon(stateHome, {
    CARET_SUPERVISED: "1",
    CARET_CONFIG_FILE: configFile,
  });
  const serviceRecord = withEnv({ XDG_STATE_HOME: stateHome }, launcherServiceFile);
  mkdirSync(dirname(serviceRecord), { recursive: true });
  writeFileSync(serviceRecord, "caret.service\n");
  return { proc, stateHome, configFile, port: lock.port };
}

/** Run a review hook's ensure in-process, as the world these env vars name. */
async function runHook(world: { stateHome: string; port: number; configFile: string }) {
  const service = fakeServiceManager();
  let built = 0;
  const vars = {
    XDG_STATE_HOME: world.stateHome,
    CARET_PORT: String(world.port),
    CARET_CONFIG_FILE: world.configFile,
  };
  const url = await withEnv(vars, async () => {
    const deps = await prodEnsureDeps(
      loadSettings(),
      () => {
        built++;
        return service.manager;
      },
      0,
    );
    // The daemon hashed ui/dist at its boot; a UI build since then must not read as staleness.
    return ensureDaemon({ ...deps, currentBuild: lockIn(world.stateHome)!.build! });
  });
  return { url, built, calls: service.calls };
}

test("the dev task's daemon keeps its own port and world beside a resident daemon, and neither world's hook reaches the other", async () => {
  const resident = await bootResident(await tempHome("caret-resident-"));
  procs.push(resident.proc);
  const devHome = await tempHome("caret-dev-world-");
  const dev = Bun.spawn(daemonCommand({ kind: "ephemeral" }), {
    env: childEnvFor(devHome, { kind: "ephemeral" }, { configFile: noConfig(devHome) }),
    stdio: ["ignore", "ignore", "ignore"],
  });
  procs.push(dev);
  await untilLockWritten(dev, join(devHome, "caret", "daemon.lock"));

  const portA = resident.port;
  const portB = lockIn(devHome)!.port;
  const before = { a: await health(portA), b: await health(portB) };
  expect(portB).not.toBe(portA);
  expect(before.a).toMatchObject({ stateDir: join(resident.stateHome, "caret"), resident: true });
  expect(before.b.stateDir).toBe(join(devHome, "caret"));

  const devHook = await runHook({
    stateHome: devHome,
    port: portB,
    configFile: noConfig(devHome),
  });
  expect(devHook).toMatchObject({ url: `http://localhost:${portB}`, built: 0 });

  const residentHook = await runHook(resident);
  expect(residentHook).toMatchObject({ url: `http://localhost:${portA}`, built: 1, calls: [] });

  expect((await health(portA)).instanceId).toBe(before.a.instanceId);
  expect((await health(portB)).instanceId).toBe(before.b.instanceId);
});

test("a dev-world hook with no dev daemon spawns its own rather than attaching to the resident one", async () => {
  const resident = await bootResident(await tempHome("caret-resident-"));
  procs.push(resident.proc);
  const residentBefore = await health(resident.port);

  // World B has no launcher `service` record, so prewarm never builds the real
  // supervisor — launchd and systemd stay untouched on a developer's machine.
  const devHome = await tempHome("caret-dev-world-");
  detachedHomes.push(devHome);
  const portB = freePort();
  const prewarm = await runCaretCli(["prewarm"], {
    env: childEnvFor(devHome, { kind: "fixed", port: portB }, { configFile: noConfig(devHome) }),
  });
  expect(prewarm.exitCode).toBe(0);

  expect(lockIn(devHome)?.port).toBe(portB);
  expect((await health(portB)).stateDir).toBe(join(devHome, "caret"));
  expect((await health(resident.port)).instanceId).toBe(residentBefore.instanceId);
});

test("a spawned daemon drops the boot marker naming it once its lock is written", async () => {
  const home = await tempHome("caret-boot-marker-");
  const daemon = spawnCaretDaemon(home, { CARET_CONFIG_FILE: noConfig(home) });
  procs.push(daemon);
  // Planted after spawn because only then is the pid known; the daemon reads the marker
  // only once it has bound, far behind this synchronous write.
  const markerFile = join(home, "caret", "daemon.boot");
  mkdirSync(dirname(markerFile), { recursive: true });
  writeFileSync(markerFile, JSON.stringify({ pid: daemon.pid, claimedAt: Date.now() }));

  await untilLockWritten(daemon, join(home, "caret", "daemon.lock"));
  expect(await until(() => !existsSync(markerFile), 2_000)).toBe(true);
  expect(daemon.exitCode).toBeNull();
});
