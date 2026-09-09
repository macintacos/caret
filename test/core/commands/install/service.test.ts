// The install step that decides whether this machine is resident: it reconciles the
// persisted intent against what the supervisor actually holds, in both directions, and
// never fails an install over a service that would not register.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { setupTempConfigFile, setupTempStateDir } from "@test/support/env.ts";
import type { LauncherDeps } from "@/commands/install/launcher.ts";
import { type ServiceTarget, serviceStep } from "@/commands/install/service.ts";
import { recordingUI } from "@/commands/install/ui.ts";
import { VANITY_HOST } from "@/config/constants.ts";
import { launcherPath, launcherRecordDir } from "@/config/paths.ts";
import type { ServiceConfig, ServiceManager, ServiceStatus } from "@/service/manager.ts";

// Each test starts from a config nobody has written, so an absent key means default.
const configFile = setupTempConfigFile(setupTempStateDir("caret-install-service-"));

/** A ServiceManager that records the verbs it was asked for and the unit it was handed,
 * reporting whatever status the case describes. */
function fakeService(status: Partial<ServiceStatus> = {}): {
  target: () => ServiceTarget;
  manager: ServiceManager;
  calls: string[];
  installedConfig: () => ServiceConfig | undefined;
} {
  const calls: string[] = [];
  let installedConfig: ServiceConfig | undefined;
  const manager: ServiceManager = {
    install: async (cfg) => {
      calls.push("install");
      installedConfig = cfg;
    },
    uninstall: async () => void calls.push("uninstall"),
    status: async () => ({ installed: false, running: false, disabled: false, ...status }),
    restart: async () => void calls.push("restart"),
  };
  return {
    target: () => ({ manager, label: "caret.service", optOutSurface: "`systemctl --user`" }),
    manager,
    calls,
    installedConfig: () => installedConfig,
  };
}

/** A plain install: resident intent, nothing to refresh, nothing to preview. */
const INSTALL = { uninstall: false, dryRun: false, refresh: false, resident: true };

/** The launcher seam every case shares — the real installLauncher needs a resolvable
 * caret root, which no test has. */
function recordingLauncher(calls: string[]): (deps: LauncherDeps) => void {
  return (deps) => void calls.push(`launcher:${deps.serviceLabel}`);
}

test("a plain install registers the unit, naming the launcher the unit runs", async () => {
  const service = fakeService();
  const calls: string[] = [];

  await serviceStep(
    INSTALL,
    { service: service.target, installLauncher: recordingLauncher(calls) },
    recordingUI(),
  );

  // The launcher must exist before the unit names it.
  expect(calls).toEqual(["launcher:caret.service"]);
  expect(service.calls).toEqual(["install"]);
  expect(service.installedConfig()).toMatchObject({
    launcherPath: launcherPath(),
    label: "caret.service",
    environment: expect.objectContaining({ CARET_SUPERVISED: "1" }),
  });
});

test("the install says where the review UI now lives", async () => {
  const ui = recordingUI();

  await serviceStep(INSTALL, { service: fakeService().target, installLauncher: () => {} }, ui);

  expect(ui.events.some((e) => e.includes(VANITY_HOST))).toBe(true);
});

test("--no-resident persists the opt-out and removes a unit already installed", async () => {
  const service = fakeService({ installed: true, running: true });

  await serviceStep(
    { ...INSTALL, resident: false },
    { service: service.target, installLauncher: () => {} },
    recordingUI(),
  );

  expect(readFileSync(configFile(), "utf8")).toContain("resident = false");
  expect(service.calls).toEqual(["uninstall"]);
});

test("a later install on an opted-out machine registers nothing", async () => {
  const optOut = fakeService();
  await serviceStep(
    { ...INSTALL, resident: false },
    { service: optOut.target, installLauncher: () => {} },
    recordingUI(),
  );

  // `--no-resident` is not repeated: the plain refresh must read the persisted intent.
  const refresh = fakeService();
  const calls: string[] = [];
  await serviceStep(
    { ...INSTALL, refresh: true },
    { service: refresh.target, installLauncher: recordingLauncher(calls) },
    recordingUI(),
  );

  expect(refresh.calls).toEqual([]);
  expect(calls).toEqual([]);
});

test("--refresh cycles the service so the new build is the one serving", async () => {
  const service = fakeService({ installed: true, running: true });

  await serviceStep(
    { ...INSTALL, refresh: true },
    { service: service.target, installLauncher: () => {} },
    recordingUI(),
  );

  expect(service.calls).toEqual(["install", "restart"]);
});

test("a host that cannot run the service is reported, not installed onto", async () => {
  const service = fakeService({ unsupported: "systemd is not running" });
  const ui = recordingUI();
  const before = process.exitCode;

  await serviceStep(INSTALL, { service: service.target, installLauncher: () => {} }, ui);

  expect(service.calls).toEqual([]);
  expect(ui.events.some((e) => e.includes("systemd is not running"))).toBe(true);
  expect(process.exitCode).toBe(before);
});

test("a service the user turned off themselves is never re-enabled", async () => {
  const service = fakeService({ installed: true, disabled: true });

  await serviceStep(INSTALL, { service: service.target, installLauncher: () => {} }, recordingUI());

  expect(service.calls).toEqual([]);
});

test("--dry-run writes no config, installs no launcher, and registers no unit", async () => {
  const service = fakeService({ installed: true });
  const calls: string[] = [];

  await serviceStep(
    { ...INSTALL, dryRun: true, resident: false },
    { service: service.target, installLauncher: recordingLauncher(calls) },
    recordingUI(),
  );

  expect(existsSync(configFile())).toBe(false);
  expect(calls).toEqual([]);
  expect(service.calls).toEqual([]);
});

test("--uninstall tears the service down and takes the launcher with it", async () => {
  const service = fakeService({ installed: true, running: true });
  mkdirSync(dirname(launcherPath()), { recursive: true });
  mkdirSync(launcherRecordDir(), { recursive: true });

  await serviceStep(
    { ...INSTALL, uninstall: true },
    { service: service.target, installLauncher: () => {} },
    recordingUI(),
  );

  expect(service.calls).toEqual(["uninstall"]);
  expect(existsSync(launcherPath())).toBe(false);
  expect(existsSync(launcherRecordDir())).toBe(false);
});

test("--uninstall --dry-run leaves the service and the launcher where they are", async () => {
  const service = fakeService({ installed: true, running: true });
  mkdirSync(dirname(launcherPath()), { recursive: true });
  writeFileSync(launcherPath(), "#!/usr/bin/env bash\n");

  await serviceStep(
    { ...INSTALL, uninstall: true, dryRun: true },
    { service: service.target, installLauncher: () => {} },
    recordingUI(),
  );

  expect(service.calls).toEqual([]);
  expect(existsSync(launcherPath())).toBe(true);
});

test("--no-resident --dry-run previews the removal rather than an install", async () => {
  const service = fakeService({ installed: true, running: true });
  const ui = recordingUI();

  await serviceStep(
    { ...INSTALL, dryRun: true, resident: false },
    { service: service.target, installLauncher: () => {} },
    ui,
  );

  expect(ui.events.some((e) => e.includes("Would install"))).toBe(false);
  expect(ui.events.some((e) => e.includes("not resident"))).toBe(true);
});

test("a supervisor that refuses the unit warns and leaves the install standing", async () => {
  const service = fakeService();
  service.manager.install = () => Promise.reject(new Error("bootstrap failed"));
  const ui = recordingUI();
  const before = process.exitCode;

  await serviceStep(INSTALL, { service: service.target, installLauncher: () => {} }, ui);

  expect(ui.events.some((e) => e.startsWith("warn:") && e.includes("bootstrap failed"))).toBe(true);
  expect(process.exitCode).toBe(before);
});

test("a platform with no supervisor at all warns rather than throwing", async () => {
  const ui = recordingUI();
  const before = process.exitCode;

  await serviceStep(
    INSTALL,
    // What servicePlatform() raises on a host that is neither darwin nor linux.
    {
      service: () => {
        throw new Error("caret service: unsupported platform win32 (darwin/linux only)");
      },
      installLauncher: () => {},
    },
    ui,
  );

  expect(ui.events.some((e) => e.startsWith("warn:") && e.includes("win32"))).toBe(true);
  expect(process.exitCode).toBe(before);
});

test("a config the opt-out cannot be written to is reported as that, not as the service", async () => {
  const service = fakeService({ installed: true });
  const ui = recordingUI();
  // A directory in the config's place: the write fails, the supervisor never comes up.
  mkdirSync(configFile(), { recursive: true });

  await serviceStep(
    { ...INSTALL, resident: false },
    { service: service.target, installLauncher: () => {} },
    ui,
  );

  expect(ui.events.some((e) => e.startsWith("warn:") && e.includes("opt-out"))).toBe(true);
  expect(service.calls).toEqual([]);
});

test("the announcement names where the service shows up outside caret", async () => {
  const ui = recordingUI();

  await serviceStep(
    INSTALL,
    {
      service: () => ({
        ...fakeService().target(),
        optOutSurface: "System Settings › Login Items",
      }),
      installLauncher: () => {},
    },
    ui,
  );

  expect(ui.events.some((e) => e.includes("System Settings › Login Items"))).toBe(true);
});
