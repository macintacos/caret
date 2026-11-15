import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setupTempConfigFile, setupTempStateDir } from "@test/support/env.ts";
import { fakeLaunchctl } from "@test/support/launchctl.ts";
import {
  type MenubarChoice,
  reconcileMenubar,
  uninstallMenubar,
} from "@/commands/install/menubar.ts";
import { recordingUI } from "@/commands/install/ui.ts";
import { daemonTokenFile, menubarDir } from "@/config/paths.ts";
import type { LaunchctlResult } from "@/service/launchd-manager.ts";
import { buildMenubarPlist, createMenubarAgent, MENUBAR_LABEL } from "@/service/menubar-agent.ts";

const configFile = setupTempConfigFile(setupTempStateDir("caret-install-menubar-"));

const SERVICE_PLIST = "<plist>the user's service</plist>\n";
const SERVICE_TARGET = "gui/501/dev.excessive.caret";

let pkg: string;
let agents: string;
let state: "running" | "not running";
let failBootstrap: boolean;
let fake: ReturnType<typeof fakeLaunchctl>;

function reply(args: string[]): LaunchctlResult {
  if (args[0] === "print") return { code: 0, stdout: `state = ${state}\n`, stderr: "" };
  if (args[0] === "bootstrap" && failBootstrap) return { code: 5, stdout: "", stderr: "boom" };
  return { code: 0, stdout: "", stderr: "" };
}

function bundleExecutable(): string {
  const info = readFileSync(join(import.meta.dir, "../../../../menubar/Info.plist"), "utf8");
  const name = info.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]*)/)?.[1];
  if (name === undefined) throw new Error("menubar/Info.plist has no CFBundleExecutable");
  return name;
}
const EXECUTABLE = bundleExecutable();
const exePath = (id: string) =>
  join(menubarDir(), id, "caret-menubar.app", "Contents/MacOS", EXECUTABLE);

function writeBundle(bytes: string): void {
  const app = join(pkg, "bin", "caret-menubar.app", "Contents");
  mkdirSync(join(app, "MacOS"), { recursive: true });
  writeFileSync(join(app, "Info.plist"), "<plist/>");
  writeFileSync(join(app, "MacOS", EXECUTABLE), bytes);
  chmodSync(join(app, "MacOS", EXECUTABLE), 0o755);
}

const LOGIN_LINE =
  'info:The caret menubar app is in the menu bar and starts at login.\nTo remove it, run `caret install` and answer "No".';
const QUIT_LINE = "info:Refreshed the caret menubar app — it stays quit until your next login.";

function deps(withAgent = true) {
  return {
    menubar: withAgent
      ? createMenubarAgent({ launchctl: fake.launchctl, uid: 501, launchAgentsDir: agents })
      : undefined,
    packageRoot: () => pkg,
  };
}

const plistPath = () => join(agents, `${MENUBAR_LABEL}.plist`);
const plist = () => readFileSync(plistPath(), "utf8");
const ids = () => readdirSync(menubarDir()).filter((n) => !n.startsWith("."));
function onlyId(): string {
  const [id, ...rest] = ids();
  if (id === undefined || rest.length > 0) throw new Error(`expected one copy, got ${ids()}`);
  return id;
}
const mutations = () => fake.calls.filter((a) => a[0] !== "print");

async function run(choice: MenubarChoice, dryRun = false, localRoot?: string) {
  const ui = recordingUI();
  await reconcileMenubar({ dryRun, choice, localRoot }, deps(), ui);
  return ui.events;
}

beforeEach(() => {
  pkg = mkdtempSync(join(tmpdir(), "caret-menubar-pkg-"));
  agents = mkdtempSync(join(tmpdir(), "caret-menubar-agents-"));
  writeFileSync(join(agents, "dev.excessive.caret.plist"), SERVICE_PLIST);
  writeBundle("build-1");
  state = "running";
  failBootstrap = false;
  fake = fakeLaunchctl(reply);
  writeFileSync(configFile(), "[daemon]\nport = 4321\n");
});

afterEach(() => {
  expect(readFileSync(join(agents, "dev.excessive.caret.plist"), "utf8")).toBe(SERVICE_PLIST);
  expect(fake.calls.some((a) => a.includes(SERVICE_TARGET))).toBe(false);
  rmSync(pkg, { recursive: true, force: true });
  rmSync(agents, { recursive: true, force: true });
});

describe("reconcileMenubar", () => {
  test("a yes copies the app under menubarDir() and loads a LaunchAgent naming it", async () => {
    state = "not running";
    const events = await run("yes");

    const id = onlyId();
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    const exe = exePath(id);
    expect(statSync(exe).mode & 0o111).not.toBe(0);
    expect(statSync(menubarDir()).mode & 0o777).toBe(0o700);
    expect(plist()).toBe(
      buildMenubarPlist({
        executable: exe,
        baseUrl: "http://127.0.0.1:4321",
        reviewUrl: "http://caret.localhost:4321",
        tokenFile: daemonTokenFile(),
      }),
    );
    expect(fake.subcommands()).toEqual(["print", "bootout", "bootstrap"]);
    expect(events).toEqual([LOGIN_LINE]);
  });

  test("a changed bundle lands under a new id, reloads, and prunes the old copy", async () => {
    await run("yes");
    const old = onlyId();
    writeBundle("build-2");
    fake.calls.length = 0;

    await run("yes");

    const next = onlyId();
    expect(next).not.toBe(old);
    expect(plist()).toContain(join(menubarDir(), next));
    expect(fake.subcommands()).toEqual(["print", "bootout", "bootstrap"]);
  });

  test("an unchanged re-run of a running app reloads nothing", async () => {
    await run("yes");
    const id = onlyId();
    fake.calls.length = 0;

    await run("yes");

    expect(ids()).toEqual([id]);
    expect(fake.subcommands()).not.toContain("bootstrap");
  });

  test("an as-found refresh of a running app carries a new build and port, reloads, and prunes", async () => {
    await run("yes");
    const old = onlyId();
    writeBundle("build-2");
    writeFileSync(configFile(), "[daemon]\nport = 4322\n");
    fake.calls.length = 0;

    const events = await run("as-found");

    const next = onlyId();
    expect(next).not.toBe(old);
    expect(plist()).toBe(
      buildMenubarPlist({
        executable: exePath(next),
        baseUrl: "http://127.0.0.1:4322",
        reviewUrl: "http://caret.localhost:4322",
        tokenFile: daemonTokenFile(),
      }),
    );
    expect(fake.subcommands()).toEqual(["print", "bootout", "bootstrap"]);
    expect(events).toEqual([LOGIN_LINE]);
  });

  test("an as-found refresh of a quit app rewrites the plist, leaves it stopped, and keeps the old copy", async () => {
    await run("yes");
    const old = onlyId();
    writeBundle("build-2");
    writeFileSync(configFile(), "[daemon]\nport = 4322\n");
    state = "not running";
    fake.calls.length = 0;

    const events = await run("as-found");

    expect(plist()).toContain("http://caret.localhost:4322");
    expect(mutations()).toEqual([]);
    expect(ids()).toContain(old);
    expect(ids()).toHaveLength(2);
    expect(events).toEqual([QUIT_LINE]);
  });

  test("as-found with nothing installed asks nothing of launchd and copies nothing", async () => {
    const events = await run("as-found");

    expect(mutations()).toEqual([]);
    expect(existsSync(menubarDir())).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toStartWith("info:");
  });

  test("a no removes an installed app and its copies", async () => {
    await run("yes");
    fake.calls.length = 0;

    const events = await run("no");

    expect(existsSync(plistPath())).toBe(false);
    expect(existsSync(menubarDir())).toBe(false);
    expect(fake.subcommands()).toContain("bootout");
    expect(events.filter((e) => e.startsWith("info:"))).toHaveLength(1);
  });

  test("a no with nothing installed reports nothing", async () => {
    expect(await run("no")).toEqual([]);
  });

  test("a dry run of an installed app reports and changes nothing", async () => {
    await run("yes");
    const before = plist();
    const id = onlyId();
    writeBundle("build-2");
    fake.calls.length = 0;

    const events = await run("as-found", true);

    expect(events).toHaveLength(1);
    expect(events[0]).toInclude("Would");
    expect(plist()).toBe(before);
    expect(ids()).toEqual([id]);
    expect(fake.calls).toEqual([]);
  });

  test("a dry run of a no leaves the app and its copies in place", async () => {
    await run("yes");
    const id = onlyId();
    fake.calls.length = 0;

    const events = await run("no", true);

    expect(events).toEqual(["info:Would remove the caret menubar app."]);
    expect(existsSync(plistPath())).toBe(true);
    expect(ids()).toEqual([id]);
    expect(fake.calls).toEqual([]);
  });

  test("a dry run with a missing bundle warns as the real run would", async () => {
    await run("yes");
    rmSync(join(pkg, "bin"), { recursive: true });

    const events = await run("as-found", true);

    expect(events).toHaveLength(1);
    expect(events[0]).toStartWith("warn:No menubar app at");
  });

  test("a missing bundle warns with its path and leaves launchd alone", async () => {
    rmSync(join(pkg, "bin"), { recursive: true });

    const events = await run("yes");

    expect(events).toHaveLength(1);
    expect(events[0]).toStartWith("warn:");
    expect(events[0]).toInclude(join(pkg, "bin", "caret-menubar.app"));
    expect(fake.calls).toEqual([]);
  });

  test("a missing bundle in a checkout names the build that makes it", async () => {
    const checkout = mkdtempSync(join(tmpdir(), "caret-menubar-checkout-"));
    try {
      const events = await run("yes", false, checkout);
      expect(events[0]).toInclude("mise run build menubar");
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  test("a non-loopback bind warns and installs nothing", async () => {
    writeFileSync(configFile(), '[daemon]\nhost = "192.168.1.5"\n');

    const events = await run("yes");

    expect(events).toHaveLength(1);
    expect(events[0]).toStartWith("warn:");
    expect(existsSync(plistPath())).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  for (const [host, baseUrl] of [
    ["0.0.0.0", "http://127.0.0.1:4321"],
    ["::", "http://[::1]:4321"],
  ]) {
    test(`a wildcard bind (${host}) installs against loopback`, async () => {
      writeFileSync(configFile(), `[daemon]\nhost = "${host}"\nport = 4321\n`);

      await run("yes");

      expect(plist()).toContain(`<string>${baseUrl}</string>`);
    });
  }

  test("without a menubar agent it does nothing and says nothing", async () => {
    const ui = recordingUI();
    await reconcileMenubar({ dryRun: false, choice: "yes" }, deps(false), ui);
    await uninstallMenubar({ dryRun: false }, deps(false), ui);

    expect(ui.events).toEqual([]);
    expect(existsSync(menubarDir())).toBe(false);
  });

  test("a bootstrap failure is one warning, not a throw", async () => {
    state = "not running";
    failBootstrap = true;

    const events = await run("yes");

    expect(events).toHaveLength(1);
    expect(events[0]).toStartWith("warn:");
    expect(events[0]).not.toInclude("caret service");
  });
});

describe("uninstallMenubar", () => {
  test("removes the app it installed but never a path a hand-edited plist names", async () => {
    await run("yes");
    const elsewhere = mkdtempSync(join(tmpdir(), "caret-menubar-elsewhere-"));
    writeFileSync(plistPath(), plist().replaceAll(menubarDir(), elsewhere));
    const ui = recordingUI();

    await uninstallMenubar({ dryRun: false }, deps(), ui);

    expect(existsSync(plistPath())).toBe(false);
    expect(existsSync(menubarDir())).toBe(false);
    expect(existsSync(elsewhere)).toBe(true);
    expect(ui.events.filter((e) => e.startsWith("info:"))).toHaveLength(1);
    rmSync(elsewhere, { recursive: true, force: true });
  });

  test("a dry run reports and changes nothing", async () => {
    await run("yes");
    fake.calls.length = 0;
    const ui = recordingUI();

    await uninstallMenubar({ dryRun: true }, deps(), ui);

    expect(ui.events).toHaveLength(1);
    expect(ui.events[0]).toInclude("Would");
    expect(existsSync(plistPath())).toBe(true);
    expect(fake.calls).toEqual([]);
  });
});
