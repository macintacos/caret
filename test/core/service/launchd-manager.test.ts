import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakeServiceConfig } from "@test/support/service-config.ts";
import { buildLaunchdPlist } from "@/service/launchd.ts";
import { createLaunchdManager, type LaunchctlResult } from "@/service/launchd-manager.ts";
import { LAUNCHD_LABEL } from "@/service/manager.ts";

const UID = 501;
const DOMAIN = `gui/${UID}`;
const TARGET = `${DOMAIN}/${LAUNCHD_LABEL}`;
const OK: LaunchctlResult = { code: 0, stdout: "", stderr: "" };
const NO_SUCH_SERVICE: LaunchctlResult = {
  code: 113,
  stdout: "",
  stderr: "Could not find service",
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "caret-launchd-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A launchctl that records every argv it is handed and answers from `reply`. */
function fakeLaunchctl(reply: (args: string[]) => LaunchctlResult = () => OK) {
  const calls: string[][] = [];
  return {
    calls,
    subcommands: () => calls.map((args) => args[0]),
    launchctl: async (args: string[]) => {
      calls.push(args);
      return reply(args);
    },
  };
}

function manager(fake: ReturnType<typeof fakeLaunchctl>) {
  return createLaunchdManager({ launchAgentsDir: dir, uid: UID, launchctl: fake.launchctl });
}

function plistPath() {
  return join(dir, `${LAUNCHD_LABEL}.plist`);
}

const LOADED = `${LAUNCHD_LABEL} = {
	active count = 0
	path = /Users/ada/Library/LaunchAgents/${LAUNCHD_LABEL}.plist
	program = /Users/ada/.local/state/caret/bin/caret
}`;

const RUNNING_STATE = `${LAUNCHD_LABEL} = {
	active count = 1
	state = running
}`;

const RUNNING_PID = `${LAUNCHD_LABEL} = {
	active count = 1
	pid = 4242
}`;

/** Scripts the two reads status() performs, which answer independently. */
function statusLaunchctl(printed: LaunchctlResult, printDisabled: LaunchctlResult = OK) {
  return fakeLaunchctl((args) => (args[0] === "print" ? printed : printDisabled));
}

function disabledList(entry: string): LaunchctlResult {
  return { code: 0, stdout: `{\n\t"com.apple.other" => false\n\t${entry}\n}`, stderr: "" };
}

test("install writes exactly the generated plist at the label's path", async () => {
  const cfg = fakeServiceConfig();
  await manager(fakeLaunchctl()).install(cfg);
  expect(readFileSync(plistPath(), "utf8")).toBe(buildLaunchdPlist(cfg));
});

test("install creates a LaunchAgents directory the account has never had", async () => {
  const nested = join(dir, "Library", "LaunchAgents");
  const fake = fakeLaunchctl();
  await createLaunchdManager({
    launchAgentsDir: nested,
    uid: UID,
    launchctl: fake.launchctl,
  }).install(fakeServiceConfig());
  expect(existsSync(join(nested, `${LAUNCHD_LABEL}.plist`))).toBe(true);
});

test("install boots the agent out before bootstrapping it", async () => {
  const fake = fakeLaunchctl();
  await manager(fake).install(fakeServiceConfig());
  expect(fake.calls).toEqual([
    ["bootout", TARGET],
    ["bootstrap", DOMAIN, plistPath()],
  ]);
});

test("installing twice reloads the agent rather than failing", async () => {
  const fake = fakeLaunchctl((args) => (args[0] === "bootout" ? NO_SUCH_SERVICE : OK));
  const mgr = manager(fake);
  await mgr.install(fakeServiceConfig());
  await mgr.install(fakeServiceConfig({ launcherPath: "/opt/caret/bin/caret" }));
  expect(readFileSync(plistPath(), "utf8")).toContain("<string>/opt/caret/bin/caret</string>");
  expect(fake.subcommands()).toEqual(["bootout", "bootstrap", "bootout", "bootstrap"]);
});

test("install throws with launchctl's own stderr when bootstrap fails", async () => {
  const fake = fakeLaunchctl((args) =>
    args[0] === "bootstrap"
      ? { code: 5, stdout: "", stderr: "Load failed: 5: Input/output error\n" }
      : OK,
  );
  await expect(manager(fake).install(fakeServiceConfig())).rejects.toThrow(
    /Load failed: 5: Input\/output error/,
  );
});

test("uninstall boots the agent out and removes its plist", async () => {
  const fake = fakeLaunchctl();
  const mgr = manager(fake);
  await mgr.install(fakeServiceConfig());
  await mgr.uninstall();
  expect(existsSync(plistPath())).toBe(false);
  expect(fake.calls.at(-1)).toEqual(["bootout", TARGET]);
});

test("uninstalling an agent that was never installed is not an error", async () => {
  const fake = fakeLaunchctl(() => NO_SUCH_SERVICE);
  await manager(fake).uninstall();
  expect(existsSync(plistPath())).toBe(false);
});

test("restart kickstarts the agent in the gui domain", async () => {
  const fake = fakeLaunchctl();
  await manager(fake).restart();
  expect(fake.calls).toEqual([["kickstart", "-k", TARGET]]);
});

test("restart throws with launchctl's own stderr when the agent is not loaded", async () => {
  const fake = fakeLaunchctl(() => NO_SUCH_SERVICE);
  await expect(manager(fake).restart()).rejects.toThrow(/Could not find service/);
});

test("status reports an agent launchd does not know about", async () => {
  const fake = statusLaunchctl(NO_SUCH_SERVICE);
  expect(await manager(fake).status()).toEqual({
    installed: false,
    running: false,
    disabled: false,
  });
});

test("status reports a loaded agent that is not running", async () => {
  const fake = statusLaunchctl({ code: 0, stdout: LOADED, stderr: "" });
  expect(await manager(fake).status()).toEqual({
    installed: true,
    running: false,
    disabled: false,
  });
});

test("status reads running from launchd's state line", async () => {
  const fake = statusLaunchctl({ code: 0, stdout: RUNNING_STATE, stderr: "" });
  expect(await manager(fake).status()).toEqual({
    installed: true,
    running: true,
    disabled: false,
  });
});

test("status reads running from a pid line with no state line beside it", async () => {
  const fake = statusLaunchctl({ code: 0, stdout: RUNNING_PID, stderr: "" });
  expect(await manager(fake).status()).toEqual({
    installed: true,
    running: true,
    disabled: false,
  });
});

test("status reads the pre-Ventura disabled spelling", async () => {
  const fake = statusLaunchctl(NO_SUCH_SERVICE, disabledList(`"${LAUNCHD_LABEL}" => true`));
  expect((await manager(fake).status()).disabled).toBe(true);
});

test("status reads the Ventura-era disabled spelling", async () => {
  const fake = statusLaunchctl(NO_SUCH_SERVICE, disabledList(`"${LAUNCHD_LABEL}" => disabled`));
  expect((await manager(fake).status()).disabled).toBe(true);
});

test("status reports an agent the user has left enabled as not disabled", async () => {
  const fake = statusLaunchctl(NO_SUCH_SERVICE, disabledList(`"${LAUNCHD_LABEL}" => false`));
  expect((await manager(fake).status()).disabled).toBe(false);
});

test("no method ever enables the agent, so a user's opt-out survives", async () => {
  const fake = fakeLaunchctl();
  const mgr = manager(fake);
  await mgr.install(fakeServiceConfig());
  await mgr.restart();
  await mgr.status();
  await mgr.uninstall();
  expect(fake.subcommands()).not.toContain("enable");
});
