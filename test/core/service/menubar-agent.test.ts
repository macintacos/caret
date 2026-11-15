import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakeLaunchctl } from "@test/support/launchctl.ts";
import type { LaunchctlResult } from "@/service/launchd-manager.ts";
import {
  buildMenubarPlist,
  createMenubarAgent,
  MENUBAR_LABEL,
  type MenubarLaunch,
  type MenubarStart,
  menubarSupported,
} from "@/service/menubar-agent.ts";

const TARGET = `gui/501/${MENUBAR_LABEL}`;

const LAUNCH: MenubarLaunch = {
  executable: "/state/caret-menubar.app/Contents/MacOS/caret-menubar",
  baseUrl: "http://127.0.0.1:42718",
  reviewUrl: "http://caret.localhost:42718",
  tokenFile: "/state/token",
};

const RUNNING_STATE: LaunchctlResult = { code: 0, stdout: "\tstate = running\n", stderr: "" };
const STOPPED_STATE: LaunchctlResult = { code: 0, stdout: "\tstate = not running\n", stderr: "" };
const BOOTSTRAP_FAILED: LaunchctlResult = { code: 5, stdout: "", stderr: "Input/output error" };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "caret-menubar-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function agent(fake: ReturnType<typeof fakeLaunchctl>, launchAgentsDir = dir) {
  return createMenubarAgent({ launchAgentsDir, uid: 501, launchctl: fake.launchctl });
}

function plistPath() {
  return join(dir, `${MENUBAR_LABEL}.plist`);
}

function printing(printed: LaunchctlResult) {
  return fakeLaunchctl((args) =>
    args[0] === "print" ? printed : { code: 0, stdout: "", stderr: "" },
  );
}

const reloads = (fake: ReturnType<typeof fakeLaunchctl>) =>
  fake.subcommands().filter((cmd) => cmd === "bootout" || cmd === "bootstrap");

test("menubarSupported admits macOS 13 (Darwin 22) and later only", () => {
  expect(menubarSupported("darwin", "22.0.0")).toBe(true);
  expect(menubarSupported("darwin", "27.2.0")).toBe(true);
  expect(menubarSupported("darwin", "21.6.0")).toBe(false);
  expect(menubarSupported("linux", "6.8.0")).toBe(false);
});

test("the label and macOS floor match the bundle's Info.plist", () => {
  const info = readFileSync(join(import.meta.dir, "../../../menubar/Info.plist"), "utf8");
  const value = (key: string) =>
    info.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)`))?.[1];

  expect(value("CFBundleIdentifier")).toBe(MENUBAR_LABEL);
  expect(value("LSMinimumSystemVersion")).toBe("13.0");
});

describe("buildMenubarPlist", () => {
  test("starts the executable with its three flags, at login, relaunching only after a crash", () => {
    const text = buildMenubarPlist(LAUNCH);

    expect(text).toContain(`<key>Label</key>\n  <string>${MENUBAR_LABEL}</string>`);
    expect(text).toContain(
      [
        LAUNCH.executable,
        "--base-url",
        LAUNCH.baseUrl,
        "--review-url",
        LAUNCH.reviewUrl,
        "--token-file",
        LAUNCH.tokenFile,
      ]
        .map((arg) => `    <string>${arg}</string>`)
        .join("\n"),
    );
    expect(text).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(text).toContain(
      "<key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>",
    );
    expect(text).toContain("<key>LimitLoadToSessionType</key>\n  <string>Aqua</string>");
    expect(text).toContain("<key>ProcessType</key>\n  <string>Interactive</string>");
  });

  test("escapes XML metacharacters in a path", () => {
    const text = buildMenubarPlist({ ...LAUNCH, tokenFile: "/a&b/<t>" });

    expect(text).toContain("<string>/a&amp;b/&lt;t&gt;</string>");
  });
});

describe("install", () => {
  test("writes the plist into a missing LaunchAgents dir, then reloads the job", async () => {
    const nested = join(dir, "LaunchAgents");
    const fake = printing({ code: 113, stdout: "", stderr: "" });

    expect(await agent(fake, nested).install(LAUNCH, "start")).toBe("reloaded");

    const plist = join(nested, `${MENUBAR_LABEL}.plist`);
    expect(readFileSync(plist, "utf8")).toBe(buildMenubarPlist(LAUNCH));
    expect(fake.calls.slice(1)).toEqual([
      ["bootout", TARGET],
      ["bootstrap", "gui/501", plist],
    ]);
  });

  const STARTS: MenubarStart[] = ["start", "leave-stopped"];
  for (const start of STARTS) {
    test(`${start}: leaves a running job with an unchanged plist alone`, async () => {
      writeFileSync(plistPath(), buildMenubarPlist(LAUNCH));
      const fake = printing(RUNNING_STATE);

      expect(await agent(fake).install(LAUNCH, start)).toBe("unchanged");

      expect(reloads(fake)).toEqual([]);
    });

    test(`${start}: reloads a running job whose plist changed`, async () => {
      writeFileSync(plistPath(), "stale");
      const fake = printing(RUNNING_STATE);

      expect(await agent(fake).install(LAUNCH, start)).toBe("reloaded");

      expect(reloads(fake)).toEqual(["bootout", "bootstrap"]);
      expect(readFileSync(plistPath(), "utf8")).toBe(buildMenubarPlist(LAUNCH));
    });
  }

  test("start: relaunches a Quit app, plist changed or not", async () => {
    for (const seeded of ["stale", buildMenubarPlist(LAUNCH)]) {
      writeFileSync(plistPath(), seeded);
      const fake = printing(STOPPED_STATE);

      expect(await agent(fake).install(LAUNCH, "start")).toBe("reloaded");

      expect(reloads(fake)).toEqual(["bootout", "bootstrap"]);
    }
  });

  test("leave-stopped: rewrites a changed plist but keeps a Quit app stopped", async () => {
    writeFileSync(plistPath(), "stale");
    const fake = printing(STOPPED_STATE);

    expect(await agent(fake).install(LAUNCH, "leave-stopped")).toBe("deferred");

    expect(readFileSync(plistPath(), "utf8")).toBe(buildMenubarPlist(LAUNCH));
    expect(reloads(fake)).toEqual([]);
  });

  test("leave-stopped: does nothing to a Quit app with an unchanged plist", async () => {
    writeFileSync(plistPath(), buildMenubarPlist(LAUNCH));
    const fake = printing(STOPPED_STATE);

    expect(await agent(fake).install(LAUNCH, "leave-stopped")).toBe("deferred");

    expect(reloads(fake)).toEqual([]);
  });

  test("throws when bootstrap fails", async () => {
    const fake = fakeLaunchctl((args) =>
      args[0] === "bootstrap" ? BOOTSTRAP_FAILED : { code: 113, stdout: "", stderr: "" },
    );

    await expect(agent(fake).install(LAUNCH, "start")).rejects.toThrow(
      "caret menubar: launchctl bootstrap failed (5): Input/output error",
    );
  });

  test("never names the caret service's job and keeps its plist bytes", async () => {
    const servicePlist = join(dir, "dev.excessive.caret.plist");
    writeFileSync(servicePlist, "service bytes");
    const fake = printing(STOPPED_STATE);
    const menubar = agent(fake);

    await menubar.install(LAUNCH, "start");
    await menubar.uninstall();

    expect(fake.calls.flat()).not.toContain("gui/501/dev.excessive.caret");
    expect(readFileSync(servicePlist, "utf8")).toBe("service bytes");
  });
});

describe("uninstall", () => {
  test("boots the job out and removes its plist", async () => {
    writeFileSync(plistPath(), buildMenubarPlist(LAUNCH));
    const fake = fakeLaunchctl();

    await agent(fake).uninstall();

    expect(fake.calls).toEqual([["bootout", TARGET]]);
    expect(existsSync(plistPath())).toBe(false);
  });

  test("resolves with nothing installed", async () => {
    await agent(fakeLaunchctl(() => ({ code: 113, stdout: "", stderr: "" }))).uninstall();
  });
});

test("installed() tracks the plist file", async () => {
  const menubar = agent(printing(STOPPED_STATE));
  expect(menubar.installed()).toBe(false);

  await menubar.install(LAUNCH, "start");
  expect(menubar.installed()).toBe(true);

  await menubar.uninstall();
  expect(menubar.installed()).toBe(false);
});
