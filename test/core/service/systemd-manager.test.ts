import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakeServiceConfig } from "@test/support/service-config.ts";
import { SYSTEMD_UNIT } from "@/service/manager.ts";
import type { CommandResult } from "@/service/run.ts";
import { buildSystemdUnit } from "@/service/systemd.ts";
import { createSystemdManager } from "@/service/systemd-manager.ts";

const OK: CommandResult = { code: 0, stdout: "", stderr: "" };
/** What `systemctl --user show-environment` answers with no user bus to reach. */
const NO_BUS: CommandResult = {
  code: 1,
  stdout: "",
  stderr: "Failed to connect to bus: No medium found\n",
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "caret-systemd-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A runner that records every argv it is handed and answers from `reply`. Argv is
 * full — `systemctl --user …` and `loginctl …` share this one seam. */
function fakeRun(reply: (argv: string[]) => CommandResult = () => OK) {
  const calls: string[][] = [];
  return {
    calls,
    /** The systemctl verbs, in order — the assertion most cases want. */
    verbs: () => calls.filter((argv) => argv[0] === "systemctl").map((argv) => argv[2]),
    run: async (argv: string[]) => {
      calls.push(argv);
      return reply(argv);
    },
  };
}

function manager(fake: ReturnType<typeof fakeRun>, unitDir = dir) {
  return createSystemdManager({ unitDir, run: fake.run });
}

function unitPath() {
  return join(dir, SYSTEMD_UNIT);
}

/** Scripts the two reads status() performs after the probe, which answer independently. */
function statusRun(isActive: string, isEnabled: string, activeCode = 0, enabledCode = 0) {
  return fakeRun((argv) => {
    if (argv[2] === "is-active") return { code: activeCode, stdout: `${isActive}\n`, stderr: "" };
    if (argv[2] === "is-enabled")
      return { code: enabledCode, stdout: `${isEnabled}\n`, stderr: "" };
    return OK;
  });
}

test("install writes exactly the generated unit at the unit name's path", async () => {
  const cfg = fakeServiceConfig({ label: SYSTEMD_UNIT });
  await manager(fakeRun()).install(cfg);
  expect(readFileSync(unitPath(), "utf8")).toBe(buildSystemdUnit(cfg));
});

test("install creates a unit directory the account has never had", async () => {
  const nested = join(dir, ".config", "systemd", "user");
  await manager(fakeRun(), nested).install(fakeServiceConfig({ label: SYSTEMD_UNIT }));
  expect(existsSync(join(nested, SYSTEMD_UNIT))).toBe(true);
});

test("install reloads, enables, then restarts so a changed unit replaces a live one", async () => {
  const fake = fakeRun();
  await manager(fake).install(fakeServiceConfig({ label: SYSTEMD_UNIT }));
  expect(fake.verbs()).toEqual([
    "show-environment",
    "daemon-reload",
    "enable",
    "reset-failed",
    "restart",
  ]);
});

test("install enables without --now, leaving the one start to restart", async () => {
  const fake = fakeRun();
  await manager(fake).install(fakeServiceConfig({ label: SYSTEMD_UNIT }));
  expect(fake.calls).toContainEqual(["systemctl", "--user", "enable", SYSTEMD_UNIT]);
  expect(fake.calls.flat()).not.toContain("--now");
});

test("install clears a parked unit so a crash-burst machine is recoverable", async () => {
  // A unit systemd parked on its start limit refuses further starts until reset-failed,
  // and re-running install is what a user does next.
  const fake = fakeRun((argv) =>
    argv[2] === "reset-failed" ? { code: 1, stdout: "", stderr: "Unit not loaded.\n" } : OK,
  );
  await manager(fake).install(fakeServiceConfig({ label: SYSTEMD_UNIT }));
  const order = fake.verbs();
  expect(order).toContain("reset-failed");
  expect(order.indexOf("reset-failed")).toBeLessThan(order.indexOf("restart"));
});

test("install enables lingering so the unit survives logout", async () => {
  const fake = fakeRun();
  await manager(fake).install(fakeServiceConfig({ label: SYSTEMD_UNIT }));
  expect(fake.calls.at(-1)).toEqual(["loginctl", "enable-linger"]);
});

/** What a re-install spends before it can decide: install's own bus probe, then the two
 * reads the enablement check performs. */
const PROBE_THEN_READ = ["show-environment", "is-active", "is-enabled"];
const FULL_INSTALL = ["daemon-reload", "enable", "reset-failed", "restart"];

/** Install, forget those calls, then install the same config again. */
async function reinstall(fake: ReturnType<typeof fakeRun>) {
  const mgr = manager(fake);
  await mgr.install(fakeServiceConfig({ label: SYSTEMD_UNIT }));
  fake.calls.length = 0;
  await mgr.install(fakeServiceConfig({ label: SYSTEMD_UNIT }));
  return fake.verbs();
}

test("re-installing an unchanged config leaves a running unit alone", async () => {
  expect(await reinstall(statusRun("active", "enabled"))).toEqual(PROBE_THEN_READ);
});

test("re-installing an unchanged config enables a unit systemd never loaded", async () => {
  expect(await reinstall(statusRun("inactive", "not-found", 3, 4))).toEqual([
    ...PROBE_THEN_READ,
    ...FULL_INSTALL,
  ]);
});

test("re-installing an unchanged config restarts an enabled unit that stopped", async () => {
  expect(await reinstall(statusRun("inactive", "enabled", 3))).toEqual([
    ...PROBE_THEN_READ,
    ...FULL_INSTALL,
  ]);
});

test("re-installing an unchanged config re-enables a running unit that lost its symlink", async () => {
  // `systemctl --user disable` without --now strips the wants symlink and leaves the unit
  // running, which is also where an install whose enable threw leaves a live machine. It
  // reads installed — is-enabled answers `disabled`, not `not-found` — so without the
  // opt-out check the one repair a user has would skip.
  expect(await reinstall(statusRun("active", "disabled", 0, 1))).toEqual([
    ...PROBE_THEN_READ,
    ...FULL_INSTALL,
  ]);
});

test("re-installing an unchanged config retries lingering the host may since have allowed", async () => {
  const fake = statusRun("active", "enabled");
  await reinstall(fake);
  expect(fake.calls).toContainEqual(["loginctl", "enable-linger"]);
});

test("an install that failed after writing the unit is repaired by the next one", async () => {
  const upgraded = fakeServiceConfig({
    label: SYSTEMD_UNIT,
    launcherPath: "/opt/caret/bin/caret",
  });
  let reloads = 0;
  const fake = fakeRun((argv) => {
    if (argv[2] === "daemon-reload" && ++reloads === 2) {
      return { code: 1, stdout: "", stderr: "Failed to connect to bus: No medium found\n" };
    }
    if (argv[2] === "is-active") return { code: 0, stdout: "active\n", stderr: "" };
    if (argv[2] === "is-enabled") return { code: 0, stdout: "enabled\n", stderr: "" };
    return OK;
  });
  const mgr = manager(fake);
  await mgr.install(fakeServiceConfig({ label: SYSTEMD_UNIT }));
  await expect(mgr.install(upgraded)).rejects.toThrow(/Failed to connect to bus/);
  fake.calls.length = 0;
  await mgr.install(upgraded);
  expect(fake.verbs()).toEqual(["show-environment", ...FULL_INSTALL]);
  expect(readFileSync(unitPath(), "utf8")).toBe(buildSystemdUnit(upgraded));
});

test("install refuses a config whose label the manager's targets cannot name", async () => {
  const fake = fakeRun();
  await expect(
    manager(fake).install(fakeServiceConfig({ label: "other.service" })),
  ).rejects.toThrow(/other\.service/);
  expect(fake.calls).toEqual([]);
});

test("install on a host with no user bus throws the diagnostic and writes nothing", async () => {
  const fake = fakeRun((argv) => (argv[2] === "show-environment" ? NO_BUS : OK));
  await expect(manager(fake).install(fakeServiceConfig({ label: SYSTEMD_UNIT }))).rejects.toThrow(
    /Failed to connect to bus/,
  );
  expect(existsSync(unitPath())).toBe(false);
  expect(fake.verbs()).toEqual(["show-environment"]);
});

test("install throws with systemd's own exit code and stderr when enable fails", async () => {
  const fake = fakeRun((argv) =>
    argv[2] === "enable"
      ? { code: 1, stdout: "", stderr: "Failed to enable unit: Unit is masked.\n" }
      : OK,
  );
  const install = manager(fake).install(fakeServiceConfig({ label: SYSTEMD_UNIT }));
  await expect(install).rejects.toThrow(/Unit is masked/);
  await expect(install).rejects.toThrow(/\(1\)/);
});

test("install still enables the unit when lingering cannot be granted", async () => {
  const fake = fakeRun((argv) =>
    argv[0] === "loginctl"
      ? { code: 1, stdout: "", stderr: "Could not enable linger: Access denied\n" }
      : OK,
  );
  await manager(fake).install(fakeServiceConfig({ label: SYSTEMD_UNIT }));
  expect(fake.verbs()).toContain("enable");
  expect(existsSync(unitPath())).toBe(true);
});

test("installing twice rewrites the unit rather than failing", async () => {
  const fake = fakeRun();
  const mgr = manager(fake);
  await mgr.install(fakeServiceConfig({ label: SYSTEMD_UNIT }));
  await mgr.install(
    fakeServiceConfig({ label: SYSTEMD_UNIT, launcherPath: "/opt/caret/bin/caret" }),
  );
  expect(readFileSync(unitPath(), "utf8")).toContain('ExecStart="/opt/caret/bin/caret"');
  // The file compare gates the enablement reads, so a changed config never pays for them.
  expect(fake.verbs()).not.toContain("is-active");
});

test("uninstall disables the unit, removes it, and has systemd forget it", async () => {
  const fake = fakeRun();
  const mgr = manager(fake);
  await mgr.install(fakeServiceConfig({ label: SYSTEMD_UNIT }));
  fake.calls.length = 0;
  await mgr.uninstall();
  expect(existsSync(unitPath())).toBe(false);
  expect(fake.verbs()).toEqual(["disable", "daemon-reload"]);
  expect(fake.calls[0]).toEqual(["systemctl", "--user", "disable", "--now", SYSTEMD_UNIT]);
});

test("uninstalling a unit that was never installed is not an error", async () => {
  const fake = fakeRun(() => ({
    code: 1,
    stdout: "",
    stderr: `Unit file ${SYSTEMD_UNIT} does not exist.\n`,
  }));
  await manager(fake).uninstall();
  expect(existsSync(unitPath())).toBe(false);
});

test("uninstall leaves lingering alone, since caret did not grant it exclusively", async () => {
  const fake = fakeRun();
  await manager(fake).uninstall();
  expect(fake.calls.map((argv) => argv[0])).not.toContain("loginctl");
});

test("status reports a unit systemd does not know about", async () => {
  const fake = statusRun("inactive", "not-found", 3, 4);
  expect(await manager(fake).status()).toEqual({
    installed: false,
    running: false,
    disabled: false,
    keepsAlive: false,
  });
});

test("status reports an enabled unit that is not running", async () => {
  const fake = statusRun("inactive", "enabled", 3);
  expect(await manager(fake).status()).toEqual({
    installed: true,
    running: false,
    disabled: false,
    keepsAlive: false,
  });
});

test("status reads running from is-active", async () => {
  const fake = statusRun("active", "enabled");
  expect(await manager(fake).status()).toEqual({
    installed: true,
    running: true,
    disabled: false,
    keepsAlive: true,
  });
  expect(fake.calls.slice(1)).toEqual([
    ["systemctl", "--user", "is-active", SYSTEMD_UNIT],
    ["systemctl", "--user", "is-enabled", SYSTEMD_UNIT],
  ]);
});

// is-enabled answers `enabled` whatever the unit is doing, so only is-active can say
// whether systemd will start the daemon again by itself.
test.each<[string, boolean]>([
  ["active", true],
  // RestartSec's gap between an exit and the restart.
  ["activating", true],
  // A drain, which a restart follows as often as a stop does.
  ["deactivating", true],
  // Told to stop.
  ["inactive", false],
  // Parked: a terminal exit, or its start limit spent.
  ["failed", false],
  // No answer: waiting on a supervisor beats racing one for the port.
  ["", true],
])("status reads is-active `%s` as keepsAlive %p", async (activity, keepsAlive) => {
  const fake = statusRun(activity, "enabled", activity === "active" ? 0 : 3);
  expect((await manager(fake).status()).keepsAlive).toBe(keepsAlive);
});

test("status reads a user's opt-out from a disabled unit", async () => {
  // `disable` without `--now` leaves the unit running, and it is an opt-out all the same.
  const fake = statusRun("active", "disabled", 0, 1);
  expect(await manager(fake).status()).toEqual({
    installed: true,
    running: true,
    disabled: true,
    keepsAlive: false,
  });
});

test("status reads a user's opt-out from a masked unit", async () => {
  const fake = statusRun("inactive", "masked", 3, 1);
  expect((await manager(fake).status()).disabled).toBe(true);
});

test("status reads a runtime mask as the same opt-out", async () => {
  // `systemctl --user mask --runtime` masks until reboot and reports its own word; read
  // as enabled it would send a reconcile into an install that can only fail at enable.
  const fake = statusRun("inactive", "masked-runtime", 3, 1);
  expect((await manager(fake).status()).disabled).toBe(true);
});

test("status reads an unanswered is-enabled as not installed", async () => {
  // The one negative match, so it is the one field an unrecognised answer could flip the
  // unsafe way: installed:true on silence would have a reconcile skip a machine that has
  // nothing installed.
  const fake = statusRun("inactive", "", 3, 1);
  expect((await manager(fake).status()).installed).toBe(false);
});

test("status on a host with no systemctl reports it unsupported rather than throwing", async () => {
  const fake = fakeRun(() => ({
    code: 127,
    stdout: "",
    stderr: 'Executable not found in $PATH: "systemctl"',
  }));
  expect(await manager(fake).status()).toEqual({
    installed: false,
    running: false,
    disabled: false,
    keepsAlive: false,
    unsupported: expect.stringContaining("systemctl"),
  });
});

test("install on a host with no systemctl throws the diagnostic and writes nothing", async () => {
  const fake = fakeRun(() => ({
    code: 127,
    stdout: "",
    stderr: 'Executable not found in $PATH: "systemctl"',
  }));
  await expect(manager(fake).install(fakeServiceConfig({ label: SYSTEMD_UNIT }))).rejects.toThrow(
    /systemctl/,
  );
  expect(existsSync(unitPath())).toBe(false);
});

test("status on a host with no user bus reports the diagnostic instead of probing further", async () => {
  const fake = fakeRun((argv) => (argv[2] === "show-environment" ? NO_BUS : OK));
  const status = await manager(fake).status();
  expect(status).toEqual({
    installed: false,
    running: false,
    disabled: false,
    keepsAlive: false,
    unsupported: expect.stringContaining("Failed to connect to bus"),
  });
  expect(fake.verbs()).toEqual(["show-environment"]);
});

test("restart cycles the unit", async () => {
  const fake = fakeRun();
  await manager(fake).restart();
  expect(fake.calls).toEqual([["systemctl", "--user", "restart", SYSTEMD_UNIT]]);
});

test("restart throws with systemd's own stderr when the unit is not loaded", async () => {
  const fake = fakeRun(() => ({
    code: 5,
    stdout: "",
    stderr: `Unit ${SYSTEMD_UNIT} not found.\n`,
  }));
  await expect(manager(fake).restart()).rejects.toThrow(/not found/);
});
