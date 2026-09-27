// The install steps that decide whether this machine is resident: reconcileService acts
// on the install's service choice against what the supervisor actually holds,
// uninstallService tears both down, and neither fails an install over a service that
// would not register.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { manifest, runnableRoot } from "@test/support/caret-root.ts";
import { setupTempConfigFile, setupTempStateDir } from "@test/support/env.ts";
import { expectCleanExitCode } from "@test/support/exit-code.ts";
import { fakeServiceTarget } from "@test/support/service-manager.ts";
import type { LauncherDeps } from "@/commands/install/launcher.ts";
import {
  reconcileService,
  type ServiceStepDeps,
  type ServiceWatch,
  uninstallService,
} from "@/commands/install/service.ts";
import { recordingUI } from "@/commands/install/ui.ts";
import { SURFACES } from "@/commands/service-target.ts";
import { VANITY_HOST } from "@/config/constants.ts";
import { launcherPath, launcherRecordDir, ownedRootsDir } from "@/config/paths.ts";
import type { HealthIdentity } from "@/lib/types.ts";

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

/** A watch for a caret at 1.0.0 whose health probes answer `answers` in call order,
 * repeating the last once the list runs out, each probe logged to `calls`. */
function scriptedWatch(
  answers: (HealthIdentity | null)[],
  calls: string[] = [],
): ServiceWatch & { probes: number } {
  const watch = {
    probes: 0,
    version: "1.0.0",
    health: async () => {
      calls.push("probe");
      return answers[Math.min(watch.probes++, answers.length - 1)] ?? null;
    },
    sleep: async () => {},
  };
  return watch;
}

/** Reconcile an installed, running service while `watch` reads what comes back. */
async function reconcileWatched(
  watch: ServiceWatch,
  opts: { refresh: boolean } = { refresh: true },
  calls?: string[],
) {
  const service = fakeServiceTarget({ status: { installed: true, running: true }, calls });
  const ui = recordingUI();
  await reconcileService(
    { ...RECONCILE, ...opts },
    { service: service.target, installLauncher: stubLauncher, watch },
    ui,
  );
  return { calls: service.calls, events: ui.events };
}

const announced = (events: string[]) => events.some((e) => e.includes(VANITY_HOST));
const warning = (events: string[]) => events.find((e) => e.startsWith("warn:"));

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

// clack draws its 3-column gutter only on explicit line breaks, so a line the terminal
// soft-wraps spills out of the frame.
test("the announcement fits an 80-column terminal line by line", async () => {
  const ui = recordingUI();

  await reconcileService(
    RECONCILE,
    {
      service: () => ({ ...fakeServiceTarget().target(), ...SURFACES.darwin }),
      installLauncher: stubLauncher,
    },
    ui,
  );

  const announcement = ui.events.find((e) => e.includes(VANITY_HOST)) ?? "";
  const lines = announcement.replace(/^info:/, "").split("\n");
  expect(lines.filter((l) => l.length > 77)).toEqual([]);
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

test("install warns, naming the daemon log, when no caret answers within the window", async () => {
  const watch = scriptedWatch([null]);
  const { events } = await reconcileWatched(watch);

  expect(warning(events)).toContain("daemon-stderr.log");
  expect(announced(events)).toBe(false);
  expect(watch.probes).toBe(61);
});

test("install warns, naming the version, when an older caret keeps answering", async () => {
  const { events } = await reconcileWatched(
    scriptedWatch([
      null,
      { service: "caret", version: "0.9.0", instanceId: "b", supervised: true },
    ]),
  );

  expect(warning(events)).toContain("0.9.0");
  expect(warning(events)).toContain("daemon-stderr.log");
  expect(announced(events)).toBe(false);
});

test("install announces once a caret at its own version answers", async () => {
  const watch = scriptedWatch([
    null,
    { service: "caret", version: "1.0.0", instanceId: "b", supervised: true },
  ]);
  const { events } = await reconcileWatched(watch);

  expect(announced(events)).toBe(true);
  expect(warning(events)).toBeUndefined();
  expect(watch.probes).toBe(2);
});

test("install keeps polling past a draining older daemon", async () => {
  const old = { service: "caret", version: "0.9.0", instanceId: "b", supervised: true };
  const { events } = await reconcileWatched(
    scriptedWatch([
      null,
      old,
      old,
      { service: "caret", version: "1.0.0", instanceId: "c", supervised: true },
    ]),
  );

  expect(announced(events)).toBe(true);
});

test("a non-caret squatter on the port never counts as the service coming up", async () => {
  const { events } = await reconcileWatched(
    scriptedWatch([null, { service: "other", version: "9.9.9" }]),
  );

  expect(warning(events)).toBeDefined();
  expect(announced(events)).toBe(false);
});

test("the replaced daemon draining at the same version never counts", async () => {
  const { events } = await reconcileWatched(
    scriptedWatch([{ service: "caret", version: "1.0.0", instanceId: "a", supervised: true }]),
  );

  expect(warning(events)).toContain("replaced (caret 1.0.0) is still answering");
  expect(announced(events)).toBe(false);
});

test("a caret the service did not start never counts, even at the installer's version", async () => {
  const { events } = await reconcileWatched(
    scriptedWatch([null, { service: "caret", version: "1.0.0", instanceId: "b" }]),
  );

  expect(warning(events)).toContain("did not start");
  expect(announced(events)).toBe(false);
});

test("a refresh reads the running instance before it restarts the service", async () => {
  const calls: string[] = [];
  const replaced = { service: "caret", version: "1.0.0", instanceId: "a", supervised: true };
  const fresh = { ...replaced, instanceId: "b" };
  await reconcileWatched(scriptedWatch([replaced, fresh], calls), { refresh: true }, calls);

  expect(calls).toEqual(["install", "probe", "restart", "probe"]);
});

test("a new instance at the same version counts once the replaced one stops answering", async () => {
  const replaced = { service: "caret", version: "1.0.0", instanceId: "a", supervised: true };
  const watch = scriptedWatch([
    replaced,
    replaced,
    replaced,
    { service: "caret", version: "1.0.0", instanceId: "b", supervised: true },
  ]);
  const { events } = await reconcileWatched(watch);

  expect(announced(events)).toBe(true);
  expect(watch.probes).toBe(4);
});

test("a plain install over an older daemon says to refresh it", async () => {
  const watch = scriptedWatch([
    { service: "caret", version: "0.9.0", instanceId: "b", supervised: true },
  ]);
  const { calls, events } = await reconcileWatched(watch, { refresh: false });

  expect(calls).toEqual(["install"]);
  expect(watch.probes).toBe(60);
  expect(warning(events)).toContain("0.9.0");
  expect(warning(events)).toContain("caret install --refresh");
});

/** Two runnable owned roots, as a newer install leaves beside an older one. */
function seedOwnedRoots(): void {
  for (const v of ["1.0.2", "1.1.0"]) runnableRoot(join(ownedRootsDir(), v), manifest(v));
}

test("a cycling install prunes the owned roots the restarted service no longer runs", async () => {
  seedOwnedRoots();
  const service = fakeServiceTarget({ status: { installed: true, running: true } });

  await reconcileService(
    { ...RECONCILE, refresh: true },
    { service: service.target, installLauncher: stubLauncher },
    recordingUI(),
  );

  expect(service.calls).toContain("restart");
  expect(existsSync(join(ownedRootsDir(), "1.0.2"))).toBe(false);
  expect(existsSync(join(ownedRootsDir(), "1.1.0"))).toBe(true);
});

test("a cycling install whose service never answers still prunes", async () => {
  seedOwnedRoots();
  const service = fakeServiceTarget({ status: { installed: true, running: true } });

  await reconcileService(
    { ...RECONCILE, refresh: true },
    { service: service.target, installLauncher: stubLauncher, watch: scriptedWatch([null]) },
    recordingUI(),
  );

  expect(existsSync(join(ownedRootsDir(), "1.0.2"))).toBe(false);
  expect(existsSync(join(ownedRootsDir(), "1.1.0"))).toBe(true);
});

test("an install that does not cycle keeps every owned root a live daemon may serve from", async () => {
  seedOwnedRoots();
  const service = fakeServiceTarget({ status: { installed: true, running: true } });

  await reconcileService(
    RECONCILE,
    { service: service.target, installLauncher: stubLauncher },
    recordingUI(),
  );

  expect(existsSync(join(ownedRootsDir(), "1.0.2"))).toBe(true);
  expect(existsSync(join(ownedRootsDir(), "1.1.0"))).toBe(true);
});

/** Reconcile a refresh while `launcherRoot` predicts what the launcher starts. */
async function reconcilePredicted(launcherRoot: ServiceStepDeps["launcherRoot"]) {
  const watch = scriptedWatch([
    null,
    { service: "caret", version: "1.1.0", instanceId: "b", supervised: true },
  ]);
  const service = fakeServiceTarget({ status: { installed: true, running: true } });
  const ui = recordingUI();
  await reconcileService(
    { ...RECONCILE, refresh: true },
    { service: service.target, installLauncher: stubLauncher, watch, launcherRoot },
    ui,
  );
  return { calls: service.calls, events: ui.events, watch };
}

test("the announcement names the caret the launcher starts and where it lives", async () => {
  const { events } = await reconcilePredicted(() => ({ root: "/r/1.1.0", version: "1.1.0" }));

  const announcement = events.find((e) => e.includes(VANITY_HOST));
  expect(announcement).toContain("1.1.0");
  expect(announcement).toContain("/r/1.1.0");
});

test("an install that does not cycle announces without naming a root", async () => {
  const service = fakeServiceTarget({ status: { installed: true, running: true } });
  const ui = recordingUI();
  await reconcileService(
    RECONCILE,
    {
      service: service.target,
      installLauncher: stubLauncher,
      watch: scriptedWatch([
        { service: "caret", version: "1.1.0", instanceId: "a", supervised: true },
      ]),
      launcherRoot: () => ({ root: "/r/1.1.0", version: "1.1.0" }),
    },
    ui,
  );

  const announcement = ui.events.find((e) => e.includes(VANITY_HOST));
  expect(announcement).toBeDefined();
  expect(announcement).not.toContain("/r/1.1.0");
});

test("with no runnable caret for the launcher, the install warns and cycles nothing", async () => {
  const { calls, events, watch } = await reconcilePredicted(() => null);

  expect(warning(events)).toBeDefined();
  expect(announced(events)).toBe(false);
  expect(watch.probes).toBe(0);
  expect(calls).not.toContain("restart");
});

test("a prediction that throws never costs the restart", async () => {
  const { calls, events } = await reconcilePredicted(() => {
    throw new Error("boom");
  });

  expect(calls).toContain("restart");
  expect(warning(events)).toBeUndefined();
});
