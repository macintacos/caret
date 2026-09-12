// `mise run dev` beside a resident daemon: the dev task's daemon keeps its own port and
// state dir, and neither world's hook reaches the other world's daemon or the machine's
// supervisor. Real daemons, because the property is what two live processes leave each
// other — the dev task's own childEnvFor and daemonCommand drive the dev side.
import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { spawnCaretDaemon, untilLockWritten } from "@test/support/cli-process.ts";
import { withEnv } from "@test/support/env.ts";
import { freePort } from "@test/support/net.ts";
import { fakeServiceManager } from "@test/support/service-manager.ts";
import { launcherServiceFile } from "@/config/paths.ts";
import { loadSettings } from "@/config/settings.ts";
import { ensureDaemon, prodEnsureDeps } from "@/daemon/lifecycle.ts";
import { childEnvFor, daemonCommand } from "@/tasks/dev/run.ts";

// Real daemon boots stretch to seconds under preflight's concurrent load; see
// test/core/daemon/integration.test.ts for why the waits are patient-while-alive instead.
setDefaultTimeout(90_000);

interface Health {
  stateDir?: string;
  resident?: boolean;
  instanceId?: string;
}

interface Lock {
  pid: number;
  port: number;
}

function readLock(stateHome: string): Lock {
  return JSON.parse(readFileSync(join(stateHome, "caret", "daemon.lock"), "utf8")) as Lock;
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
async function bootResident(tmp: string[]) {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-resident-"));
  const configHome = await mkdtemp(join(tmpdir(), "caret-resident-cfg-"));
  tmp.push(stateHome, configHome);
  // Pinned so the developer's own config.toml cannot decide residency here.
  await Bun.write(join(configHome, "caret", "config.toml"), "");
  const proc = spawnCaretDaemon(stateHome, {
    CARET_SUPERVISED: "1",
    XDG_CONFIG_HOME: configHome,
    CARET_CONFIG_FILE: "",
  });
  await untilLockWritten(proc, join(stateHome, "caret", "daemon.lock"));
  const serviceRecord = withEnv({ XDG_STATE_HOME: stateHome }, launcherServiceFile);
  mkdirSync(dirname(serviceRecord), { recursive: true });
  writeFileSync(serviceRecord, "caret.service\n");
  return { proc, stateHome, configFile: join(configHome, "caret", "config.toml") };
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
    return ensureDaemon(deps);
  });
  return { url, built, calls: service.calls };
}

test("the dev task's daemon keeps its own port and world beside a resident daemon, and neither world's hook reaches the other", async () => {
  const tmp: string[] = [];
  const procs: Array<ReturnType<typeof Bun.spawn>> = [];
  try {
    const resident = await bootResident(tmp);
    procs.push(resident.proc);
    const devHome = await mkdtemp(join(tmpdir(), "caret-dev-world-"));
    tmp.push(devHome);
    const dev = Bun.spawn(daemonCommand({ kind: "ephemeral" }), {
      env: childEnvFor(devHome, { kind: "ephemeral" }, { configFile: noConfig(devHome) }),
      stdio: ["ignore", "ignore", "ignore"],
    });
    procs.push(dev);
    await untilLockWritten(dev, join(devHome, "caret", "daemon.lock"));

    const portA = readLock(resident.stateHome).port;
    const portB = readLock(devHome).port;
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

    const residentHook = await runHook({ ...resident, port: portA });
    expect(residentHook).toMatchObject({ url: `http://localhost:${portA}`, calls: [] });

    expect((await health(portA)).instanceId).toBe(before.a.instanceId);
    expect((await health(portB)).instanceId).toBe(before.b.instanceId);
  } finally {
    for (const p of procs) p.kill("SIGKILL");
    await Promise.all(procs.map((p) => p.exited));
    await Promise.all(tmp.map((d) => rm(d, { recursive: true, force: true })));
  }
});

test("a dev-world hook with no dev daemon spawns its own rather than attaching to the resident one", async () => {
  const tmp: string[] = [];
  const procs: Array<ReturnType<typeof Bun.spawn>> = [];
  const devHome = await mkdtemp(join(tmpdir(), "caret-dev-world-"));
  tmp.push(devHome);
  try {
    const resident = await bootResident(tmp);
    procs.push(resident.proc);
    const portA = readLock(resident.stateHome).port;
    const residentBefore = await health(portA);

    // World B has no launcher `service` record, so prewarm never builds the real
    // supervisor — launchd and systemd stay untouched on a developer's machine.
    const portB = freePort();
    const prewarm = Bun.spawn([process.execPath, "src/cli.ts", "prewarm"], {
      env: childEnvFor(devHome, { kind: "fixed", port: portB }, { configFile: noConfig(devHome) }),
      stdio: ["ignore", "ignore", "ignore"],
    });
    procs.push(prewarm);
    await prewarm.exited;

    expect(readLock(devHome).port).toBe(portB);
    expect((await health(portB)).stateDir).toBe(join(devHome, "caret"));
    expect((await health(portA)).instanceId).toBe(residentBefore.instanceId);
  } finally {
    // The daemon prewarm spawned is detached and resident, so only its lock names it.
    try {
      process.kill(readLock(devHome).pid, "SIGKILL");
    } catch {
      // never spawned, or already gone
    }
    for (const p of procs) p.kill("SIGKILL");
    await Promise.all(procs.map((p) => p.exited));
    await Promise.all(tmp.map((d) => rm(d, { recursive: true, force: true })));
  }
});
