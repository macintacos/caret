// The install steps that decide whether this machine is resident: reconcileService acts
// on the install's service choice against what the supervisor actually holds,
// uninstallService tears both down, and neither fails an install over a service that
// would not register.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { setupTempConfigFile, setupTempStateDir } from "@test/support/env.ts";
import { expectCleanExitCode } from "@test/support/exit-code.ts";
import { fakeServiceTarget } from "@test/support/service-manager.ts";
import type { LauncherDeps } from "@/commands/install/launcher.ts";
import { reconcileService, uninstallService } from "@/commands/install/service.ts";
import { recordingUI } from "@/commands/install/ui.ts";
import { VANITY_HOST } from "@/config/constants.ts";
import { launcherPath, launcherRecordDir } from "@/config/paths.ts";

// Each test starts from a config nobody has written, so an absent key means default.
setupTempConfigFile(setupTempStateDir("caret-install-service-"));

/** A plain install: the service kept running, nothing to refresh, nothing to preview. */
const RECONCILE = { dryRun: false, refresh: false, choice: "always-on" } as const;

/** A launcher on disk where the real uninstallLauncher looks for one. */
function writeLauncher(): void {
  mkdirSync(dirname(launcherPath()), { recursive: true });
  writeFileSync(launcherPath(), "#!/usr/bin/env bash\n");
}

/** The launcher seam every case shares — the real installLauncher needs a resolvable
 * caret root, which no test has. */
function recordingLauncher(calls: string[]): (deps: LauncherDeps) => { unpinned: boolean } {
  return (deps) => {
    calls.push(`launcher:${deps.serviceLabel}`);
    return { unpinned: false };
  };
}

const stubLauncher = () => ({ unpinned: false });

test("a plain install registers the unit, naming the launcher the unit runs", async () => {
  const service = fakeServiceTarget();
  const calls: string[] = [];

  await reconcileService(
    RECONCILE,
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

test("the install says where the review UI now lives, with no dangling caveat", async () => {
  const ui = recordingUI();

  await reconcileService(
    RECONCILE,
    { service: fakeServiceTarget().target, installLauncher: stubLauncher },
    ui,
  );

  const announcement = ui.events.find((e) => e.includes(VANITY_HOST));
  expect(announcement).toBeDefined();
  expect(announcement).not.toContain("undefined");
});

test("--refresh cycles the service so the new build is the one serving", async () => {
  const service = fakeServiceTarget({ status: { installed: true, running: true } });

  await reconcileService(
    { ...RECONCILE, refresh: true },
    { service: service.target, installLauncher: stubLauncher },
    recordingUI(),
  );

  expect(service.calls).toEqual(["install", "restart"]);
});

test("--from-local pins the launcher to the checkout and cycles the service onto it", async () => {
  const service = fakeServiceTarget({ status: { installed: true, running: true } });
  let pinnedRoot: string | undefined;

  await reconcileService(
    { ...RECONCILE, pinnedRoot: "/checkout" },
    {
      service: service.target,
      installLauncher: (deps) => {
        pinnedRoot = deps.pinnedRoot;
        return { unpinned: false };
      },
    },
    recordingUI(),
  );

  expect(pinnedRoot).toBe("/checkout");
  expect(service.calls).toEqual(["install", "restart"]);
});

test("a published install clears a pin and cycles off the checkout", async () => {
  const service = fakeServiceTarget({ status: { installed: true, running: true } });

  await reconcileService(
    RECONCILE,
    { service: service.target, installLauncher: () => ({ unpinned: true }) },
    recordingUI(),
  );

  expect(service.calls).toEqual(["install", "restart"]);
});

test("a host that cannot run the service is reported, not installed onto", async () => {
  const service = fakeServiceTarget({ status: { unsupported: "systemd is not running" } });
  const ui = recordingUI();

  await expectCleanExitCode(() =>
    reconcileService(RECONCILE, { service: service.target, installLauncher: stubLauncher }, ui),
  );

  expect(service.calls).toEqual([]);
  expect(ui.events.some((e) => e.includes("systemd is not running"))).toBe(true);
});

test("a service the user turned off themselves is never re-enabled", async () => {
  const service = fakeServiceTarget({ status: { installed: true, disabled: true } });

  await reconcileService(
    RECONCILE,
    { service: service.target, installLauncher: stubLauncher },
    recordingUI(),
  );

  expect(service.calls).toEqual([]);
});

test("--dry-run installs no launcher and registers no unit", async () => {
  const service = fakeServiceTarget({ status: { installed: true } });
  const calls: string[] = [];

  await reconcileService(
    { ...RECONCILE, dryRun: true },
    { service: service.target, installLauncher: recordingLauncher(calls) },
    recordingUI(),
  );

  expect(calls).toEqual([]);
  expect(service.calls).toEqual([]);
});

test("--uninstall tears the service down and takes the launcher with it", async () => {
  const service = fakeServiceTarget({ status: { installed: true, running: true } });
  mkdirSync(dirname(launcherPath()), { recursive: true });
  mkdirSync(launcherRecordDir(), { recursive: true });

  await uninstallService(
    { dryRun: false },
    { service: service.target, installLauncher: stubLauncher },
    recordingUI(),
  );

  expect(service.calls).toEqual(["uninstall"]);
  expect(existsSync(launcherPath())).toBe(false);
  expect(existsSync(launcherRecordDir())).toBe(false);
});

test("--uninstall --dry-run leaves the service and the launcher where they are", async () => {
  const service = fakeServiceTarget({ status: { installed: true, running: true } });
  writeLauncher();

  await uninstallService(
    { dryRun: true },
    { service: service.target, installLauncher: stubLauncher },
    recordingUI(),
  );

  expect(service.calls).toEqual([]);
  expect(existsSync(launcherPath())).toBe(true);
});

test("running caret yourself removes a registered service and its launcher", async () => {
  const service = fakeServiceTarget({ status: { installed: true, running: true } });
  writeLauncher();

  await reconcileService(
    { ...RECONCILE, choice: "run-yourself" },
    { service: service.target, installLauncher: stubLauncher },
    recordingUI(),
  );

  expect(service.calls).toEqual(["uninstall"]);
  expect(existsSync(launcherPath())).toBe(false);
});

test("running caret yourself clears the unit and launcher even when none is loaded", async () => {
  // On macOS `installed` is loadedness, and the launcher's terminal exit boots the agent
  // out while leaving the plist to load at the next login.
  const service = fakeServiceTarget();
  writeLauncher();
  const ui = recordingUI();

  await reconcileService(
    { ...RECONCILE, choice: "run-yourself" },
    { service: service.target, installLauncher: stubLauncher },
    ui,
  );

  expect(service.calls).toEqual(["uninstall"]);
  expect(existsSync(launcherPath())).toBe(false);
  expect(ui.events.find((e) => e.includes("caret@latest serve"))).not.toContain("was removed");
});

test("running caret yourself on a host that cannot run the service removes nothing", async () => {
  const service = fakeServiceTarget({ status: { unsupported: "systemd is not running" } });
  const ui = recordingUI();

  await reconcileService(
    { ...RECONCILE, choice: "run-yourself" },
    { service: service.target, installLauncher: stubLauncher },
    ui,
  );

  expect(service.calls).toEqual([]);
  expect(ui.events.some((e) => e.includes("caret@latest serve"))).toBe(true);
});

test("running caret yourself says how to serve the review UI by hand", async () => {
  const ui = recordingUI();

  await reconcileService(
    { ...RECONCILE, choice: "run-yourself" },
    { service: fakeServiceTarget().target, installLauncher: stubLauncher },
    ui,
  );

  expect(ui.events.some((e) => e.includes("caret@latest serve") && e.includes(VANITY_HOST))).toBe(
    true,
  );
});

test("running a local build yourself names that checkout's caret serve", async () => {
  const ui = recordingUI();

  await reconcileService(
    { ...RECONCILE, choice: "run-yourself", pinnedRoot: "/checkout" },
    { service: fakeServiceTarget().target, installLauncher: stubLauncher },
    ui,
  );

  expect(ui.events.some((e) => e.includes("/checkout/bin/caret serve"))).toBe(true);
});

test("the serve instructions still print when the supervisor cannot be looked up", async () => {
  const ui = recordingUI();

  await reconcileService(
    { ...RECONCILE, choice: "run-yourself" },
    {
      service: () => {
        throw new Error("caret service: unsupported platform win32 (darwin/linux only)");
      },
      installLauncher: stubLauncher,
    },
    ui,
  );

  expect(ui.events.some((e) => e.includes("caret@latest serve"))).toBe(true);
});

test("running caret yourself under --dry-run previews the removal without performing it", async () => {
  const service = fakeServiceTarget({ status: { installed: true, running: true } });
  writeLauncher();
  const ui = recordingUI();

  await reconcileService(
    { ...RECONCILE, dryRun: true, choice: "run-yourself" },
    { service: service.target, installLauncher: stubLauncher },
    ui,
  );

  expect(service.calls).toEqual([]);
  expect(existsSync(launcherPath())).toBe(true);
  expect(ui.events.some((e) => e.includes("Would remove the caret service"))).toBe(true);
});

test("an install nobody was asked about registers no service where there is none", async () => {
  const service = fakeServiceTarget();
  const calls: string[] = [];

  await reconcileService(
    { ...RECONCILE, choice: "as-found" },
    { service: service.target, installLauncher: recordingLauncher(calls) },
    recordingUI(),
  );

  expect(service.calls).toEqual([]);
  expect(calls).toEqual([]);
});

test("an install nobody was asked about refreshes a service already registered", async () => {
  const service = fakeServiceTarget({ status: { installed: true, running: true } });

  await reconcileService(
    { ...RECONCILE, choice: "as-found" },
    { service: service.target, installLauncher: stubLauncher },
    recordingUI(),
  );

  expect(service.calls).toEqual(["install"]);
});

test("a supervisor that refuses the unit warns and leaves the install standing", async () => {
  const service = fakeServiceTarget();
  service.manager.install = () => Promise.reject(new Error("bootstrap failed"));
  const ui = recordingUI();

  await expectCleanExitCode(() =>
    reconcileService(RECONCILE, { service: service.target, installLauncher: stubLauncher }, ui),
  );

  expect(ui.events.some((e) => e.startsWith("warn:") && e.includes("bootstrap failed"))).toBe(true);
});

test("a platform with no supervisor at all warns rather than throwing", async () => {
  const ui = recordingUI();

  await expectCleanExitCode(() =>
    reconcileService(
      RECONCILE,
      // What servicePlatform() raises on a host that is neither darwin nor linux.
      {
        service: () => {
          throw new Error("caret service: unsupported platform win32 (darwin/linux only)");
        },
        installLauncher: stubLauncher,
      },
      ui,
    ),
  );

  expect(ui.events.some((e) => e.startsWith("warn:") && e.includes("win32"))).toBe(true);
});

test("the announcement names where the service shows up outside caret", async () => {
  const ui = recordingUI();

  await reconcileService(
    RECONCILE,
    {
      service: () => ({
        ...fakeServiceTarget().target(),
        visibleIn: "System Settings › Login Items",
      }),
      installLauncher: stubLauncher,
    },
    ui,
  );

  expect(ui.events.some((e) => e.includes("System Settings › Login Items"))).toBe(true);
});

test("the announcement carries the caveat for a switch caret cannot read", async () => {
  const ui = recordingUI();

  await reconcileService(
    RECONCILE,
    {
      service: () => ({
        ...fakeServiceTarget().target(),
        visibleToggleCaveat: "That switch is not one caret can read.",
      }),
      installLauncher: stubLauncher,
    },
    ui,
  );

  expect(ui.events.some((e) => e.includes("That switch is not one caret can read."))).toBe(true);
});

test("the message that leaves an opted-out service alone names what turned it off", async () => {
  const ui = recordingUI();

  await reconcileService(
    RECONCILE,
    {
      service: () => ({
        ...fakeServiceTarget({ status: { installed: true, disabled: true } }).target(),
        visibleIn: "System Settings › Login Items",
        optOutSurface: "`launchctl disable`",
      }),
      installLauncher: stubLauncher,
    },
    ui,
  );

  const message = ui.events.find((e) => e.includes("leaving it that way"));
  expect(message).toContain("`launchctl disable`");
  expect(message).not.toContain("System Settings › Login Items");
});
