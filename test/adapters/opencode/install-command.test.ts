import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import { withEnv } from "@test/support/env.ts";
import { expectCleanExitCode } from "@test/support/exit-code.ts";
import { caretEntries, readConfigText } from "@/adapters/opencode/entries.ts";
import type { OpencodePackaging } from "@/adapters/opencode/packaging.ts";
import { CARET_PACKAGE, CONFIG_FILENAMES } from "@/adapters/opencode/paths.ts";
import { type InstallOpencodeDeps, runInstallOpencodeTarget } from "@/commands/install/opencode.ts";
import { type InstallUI, recordingUI } from "@/commands/install/ui.ts";
import type { VersionTriple } from "@/lib/semver.ts";

// Stub packaging so the target never resolves the real caret root. Only the command
// files, bin path, and demo template matter (caret itself installs as a
// `plugin`/`plugins` entry).
const PACKAGING: OpencodePackaging = {
  binPath: "/opt/caret/bin/caret",
  demoTemplate: "# Demo plan",
  commands: [{ name: "demo.md", contents: "run __CARET_BIN__ with __CARET_DEMO_TEMPLATE__" }],
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-install-oc-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The deps every case shares. The upgrade check is wired OFFLINE by default — no suite
 * here may reach npm or read the real OpenCode cache: reads resolve under the temp tree
 * `cacheDir(spec, requested)` writes into, and a case that exercises the clear overrides
 * `published`/`cacheDirs` with its own fixture. */
function deps(overrides: InstallOpencodeDeps = {}): InstallOpencodeDeps {
  return {
    configDir: dir,
    packaging: PACKAGING,
    published: async () => null,
    cacheDir: (e) => join(dir, "cache", e.spec),
    cacheDirs: () => [],
    opencodeVersion: () => null,
    ...overrides,
  };
}

async function install(uninstall = false, dryRun = false) {
  await runInstallOpencodeTarget({ uninstall, dryRun, refresh: false }, deps());
}
const configJson = () => join(dir, "opencode.json");
const commandFile = () => join(dir, "commands", "caret:demo.md");
const plugins = () => JSON.parse(readFileSync(configJson(), "utf-8")).plugin;

/** A cache dir shaped like OpenCode's: one directory per verbatim specifier, holding the
 * shim manifest that records caret's requested spec and, when `installed` is given, the
 * installed caret's own manifest. Under the temp dir, never the real cache. */
function cacheDir(specifier: string, requested: string, installed?: string): string {
  const d = join(dir, "cache", specifier);
  mkdirSync(d, { recursive: true });
  writeFileSync(
    join(d, "package.json"),
    JSON.stringify({ dependencies: { [CARET_PACKAGE]: requested } }),
  );
  if (installed !== undefined) {
    const pkg = join(d, "node_modules", CARET_PACKAGE);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ version: installed }));
  }
  return d;
}

/** Run an install against a recording UI, returning everything it rendered as one
 * string — the upgrade check's contract is what the user is told, not which surface
 * told them. */
async function transcript(
  overrides: InstallOpencodeDeps,
  opts: { refresh?: boolean; uninstall?: boolean; dryRun?: boolean } = {},
): Promise<string> {
  const ui = recordingUI();
  const capturing: InstallUI = {
    ...ui,
    // recordingUI keeps only a note's title; the dry-run verdict rides in the body.
    note: (body, title) => {
      ui.note(body, title);
      ui.events.push(body);
    },
  };
  await runInstallOpencodeTarget(
    { uninstall: false, dryRun: false, refresh: false, ...opts },
    deps({ ui: capturing, ...overrides }),
  );
  return ui.events.join("\n");
}

test("install adds caret to the plugin array (creating opencode.json) and deploys namespaced commands", async () => {
  await install();
  expect(JSON.parse(readFileSync(configJson(), "utf-8")).plugin).toEqual([CARET_PACKAGE]);
  expect(existsSync(commandFile())).toBe(true);
  expect(existsSync(join(dir, "commands", "demo.md"))).toBe(false);
  // The command's markers are substituted with the running caret's binary and demo template.
  expect(readFileSync(commandFile(), "utf-8")).toBe("run /opt/caret/bin/caret with # Demo plan");
});

test("install is idempotent (re-adding leaves the config unchanged)", async () => {
  await install();
  const first = readFileSync(configJson(), "utf-8");
  await install();
  expect(readFileSync(configJson(), "utf-8")).toBe(first);
});

test("install leaves the config untouched when caret is already pinned to a version", async () => {
  // A user who hard-coded `@macintacos/caret@0.4.0` must not get a duplicate bare entry.
  writeFileSync(configJson(), JSON.stringify({ plugin: [`${CARET_PACKAGE}@0.4.0`] }, null, 2));
  const before = readFileSync(configJson(), "utf-8");
  await install();
  expect(readFileSync(configJson(), "utf-8")).toBe(before);
});

test("install preserves a user's existing plugins and other config keys", async () => {
  writeFileSync(
    configJson(),
    JSON.stringify({ theme: "dark", plugin: ["opencode-wakatime"] }, null, 2),
  );
  await install();
  expect(JSON.parse(readFileSync(configJson(), "utf-8"))).toEqual({
    theme: "dark",
    plugin: ["opencode-wakatime", CARET_PACKAGE],
  });
});

test("install edits an existing opencode.jsonc in place, preserving comments", async () => {
  const jsonc = join(dir, "opencode.jsonc");
  writeFileSync(jsonc, ["{", "  // my config", '  "plugin": []', "}", ""].join("\n"));
  await install();
  expect(existsSync(configJson())).toBe(false); // did not create a second config file
  const out = readFileSync(jsonc, "utf-8");
  expect(out).toContain("// my config");
  expect(out).toContain(CARET_PACKAGE);
});

test("uninstall removes caret's array entry and the command files", async () => {
  await install();
  await install(true);
  expect(JSON.parse(readFileSync(configJson(), "utf-8")).plugin).toEqual([]);
  expect(existsSync(commandFile())).toBe(false);
});

test("uninstall preserves a user's other plugins", async () => {
  writeFileSync(configJson(), JSON.stringify({ plugin: ["opencode-wakatime"] }, null, 2));
  await install();
  await install(true);
  expect(JSON.parse(readFileSync(configJson(), "utf-8")).plugin).toEqual(["opencode-wakatime"]);
});

test("uninstall with caret never installed reports nothing removed, and is not a failure", async () => {
  // `--uninstall` sweeps every agent, so a machine that only runs the other one lands
  // here; a throw or a non-zero exit would stop the run before the rest of the teardown.
  const said = await expectCleanExitCode(() => transcript({}, { uninstall: true }));
  expect(said).toContain("caret was not in any OpenCode config");
  expect(said).toContain("Removed 0 command file(s)");
});

test("dry-run uninstall previews what it would remove and writes nothing", async () => {
  await install();
  const said = await transcript({}, { uninstall: true, dryRun: true });
  expect(said).toContain("OpenCode — would remove");
  expect(said).toContain(configJson());
  expect(said).toContain(join("commands", "caret:demo.md"));
  expect(said).not.toContain("plugin entry:");
  expect(plugins()).toEqual([CARET_PACKAGE]);
  expect(existsSync(commandFile())).toBe(true);
});

test("uninstall never probes the OpenCode version, live or previewed", async () => {
  const probes: string[] = [];
  const opencodeVersion = () => {
    probes.push("probed");
    return null;
  };
  await transcript({ opencodeVersion }, { uninstall: true, dryRun: true });
  await transcript({ opencodeVersion }, { uninstall: true });
  expect(probes).toEqual([]);
});

test("dry-run install writes nothing", async () => {
  await install(false, true);
  expect(existsSync(configJson())).toBe(false);
  expect(existsSync(commandFile())).toBe(false);
});

// --- the upgrade check: is the caret OpenCode would load behind the published one? ---

test("a caret matching the published version is reported current, and nothing changes", async () => {
  const cache = cacheDir(CARET_PACKAGE, "0.8.1");
  const said = await transcript({ published: async () => "0.8.1", cacheDirs: () => [cache] });
  expect(said).toContain("0.8.1");
  expect(said).toContain("already current");
  expect(said).not.toContain("Cleared");
  expect(existsSync(cache)).toBe(true);
  expect(plugins()).toEqual([CARET_PACKAGE]);
});

test("a bare entry with nothing cached is reported fresh, and nothing is cleared", async () => {
  const said = await transcript({ published: async () => "0.8.1" });
  expect(said).toContain("resolve caret on its next start");
  expect(said).not.toContain("Cleared");
});

/** A `confirm` stub that records every prompt kind it is asked — for a case
 * that expects it never to fire. */
function recordingConfirm(): { confirm: InstallOpencodeDeps["confirm"]; asked: string[] } {
  const asked: string[] = [];
  return {
    confirm: async (v) => {
      asked.push(v.kind);
      return true;
    },
    asked,
  };
}

test("--refresh clears a stale cache without asking", async () => {
  const cache = cacheDir(CARET_PACKAGE, "0.2.0");
  const { confirm, asked } = recordingConfirm();
  const said = await transcript(
    { published: async () => "0.8.1", cacheDirs: () => [cache], confirm },
    { refresh: true },
  );
  expect(asked).toEqual([]);
  expect(existsSync(cache)).toBe(false);
  expect(said).toContain("Cleared 1 cached copy");
});

test("--refresh clears a stale cache whose shim records a range", async () => {
  const cache = cacheDir(CARET_PACKAGE, "^1.1.0", "1.1.3");
  await transcript({ published: async () => "1.2.0", cacheDirs: () => [cache] }, { refresh: true });
  expect(existsSync(cache)).toBe(false);
});

/** The stale-cache upgrade deps a case exercises, with the prompt's answer as the only
 * variable — the fixture every "user did not clear the cache" case shares. */
function staleCacheDeps(
  cache: string,
  confirm: InstallOpencodeDeps["confirm"],
): InstallOpencodeDeps {
  return {
    published: async () => "0.8.1",
    cacheDirs: () => [cache],
    isInteractive: () => true,
    confirm,
  };
}

test("a stale cache the user accepts is cleared", async () => {
  const cache = cacheDir(CARET_PACKAGE, "0.2.0");
  const said = await transcript(staleCacheDeps(cache, async () => true));
  expect(existsSync(cache)).toBe(false);
  expect(said).toContain("Cleared 1 cached copy");
});

test.each([
  ["declines", false],
  ["cancels", null],
])(
  "a stale cache the user %s is left alone, and the install is not a failure",
  async (_label, answer) => {
    const cache = cacheDir(CARET_PACKAGE, "0.2.0");
    await expectCleanExitCode(() => transcript(staleCacheDeps(cache, async () => answer)));
    expect(existsSync(cache)).toBe(true);
    expect(existsSync(commandFile())).toBe(true);
  },
);

test("without a terminal, a stale cache names the gap and --refresh rather than asking", async () => {
  const cache = cacheDir(CARET_PACKAGE, "0.2.0");
  const { confirm, asked } = recordingConfirm();
  const said = await transcript({
    published: async () => "0.8.1",
    cacheDirs: () => [cache],
    isInteractive: () => false,
    confirm,
  });
  expect(asked).toEqual([]);
  expect(said).toContain("0.2.0");
  expect(said).toContain("0.8.1");
  expect(said).toContain("--refresh");
  expect(existsSync(cache)).toBe(true);
});

test("without a terminal, a stale pin is told to bump rather than to clear", async () => {
  // The two stale kinds have different remedies, so the nudge names the right one.
  writeFileSync(configJson(), JSON.stringify({ plugin: [`${CARET_PACKAGE}@0.7.3`] }, null, 2));
  const said = await transcript({
    published: async () => "0.8.1",
    isInteractive: () => false,
  });
  expect(said).toContain("--refresh to bump the pin");
  expect(plugins()).toEqual([`${CARET_PACKAGE}@0.7.3`]);
});

test("--refresh bumps a stale pin in place, and leaves the cache alone", async () => {
  writeFileSync(configJson(), JSON.stringify({ plugin: [`${CARET_PACKAGE}@0.7.3`] }, null, 2));
  const cache = cacheDir(`${CARET_PACKAGE}@0.7.3`, "0.7.3");
  const said = await transcript(
    { published: async () => "0.8.1", cacheDirs: () => [cache] },
    { refresh: true },
  );
  expect(plugins()).toEqual([`${CARET_PACKAGE}@0.8.1`]);
  // A pin's new specifier gets its own cache dir; the old pin's dir is not caret's to
  // delete.
  expect(existsSync(cache)).toBe(true);
  expect(said).toContain(`Bumped the pin to ${CARET_PACKAGE}@0.8.1`);
});

test("a check that could not be made warns, and the install still finishes", async () => {
  const said = await transcript({ published: async () => null });
  expect(said).toContain("warn:");
  expect(said).toContain("could not reach npm");
  expect(existsSync(commandFile())).toBe(true);
  expect(plugins()).toEqual([CARET_PACKAGE]);
});

test("dry-run reports the verdict and still writes nothing", async () => {
  const said = await transcript({ published: async () => "0.8.1" }, { dryRun: true });
  expect(said).toContain("resolve caret on its next start");
  expect(existsSync(configJson())).toBe(false);
  expect(existsSync(commandFile())).toBe(false);
});

test("a dry run that could not check says why, since it has no warning to carry it", async () => {
  const said = await transcript({ published: async () => null }, { dryRun: true });
  expect(said).toContain("could not reach npm");
});

test("--from-local skips the check: a dev-loop install asks npm nothing", async () => {
  // `mise run build --install` runs this path, so a network read and a possible confirm
  // would land in the middle of a build — and a checkout entry has no published version
  // to be behind anyway.
  const calls: string[] = [];
  await runInstallOpencodeTarget(
    {
      uninstall: false,
      dryRun: false,
      refresh: false,
      local: { repoDir: "/checkout", marketplaceDir: "/dev-mp" },
    },
    deps({
      published: async () => {
        calls.push("published");
        return "0.8.1";
      },
    }),
  );
  expect(calls).toEqual([]);
  expect(plugins()).toEqual(["file:/checkout"]); // the rest of the install still ran
  expect(existsSync(commandFile())).toBe(true);
});

test("uninstall skips the check: no network call, no cache read, nothing cleared", async () => {
  await install();
  const cache = cacheDir(CARET_PACKAGE, "0.2.0");
  const calls: string[] = [];
  await transcript(
    {
      published: async () => {
        calls.push("published");
        return "0.8.1";
      },
      cacheDir: (s) => {
        calls.push("cacheDir");
        return join(dir, "cache", s.spec);
      },
      cacheDirs: () => {
        calls.push("cacheDirs");
        return [cache];
      },
    },
    { uninstall: true },
  );
  expect(calls).toEqual([]);
  expect(existsSync(cache)).toBe(true);
});

// --- the local (--from-local) plugin entry ----------------------------------------
// These cases pin that the two entry forms — the npm package and `file:<checkout>` — are
// mutually exclusive, because caret owns exactly one entry: both present would load two
// caret plugins, each registering the review tool, with the published one answering from
// a build nobody made.
// `isCheckout` is deliberately NOT injected: the fixtures create the real probe file, so
// the suite exercises the same predicate production uses.

/** A directory the install target will accept as a caret checkout, by the one file it
 * probes for (`opencode/caret.plugin.ts` — what resolveCaretRoot looks for too). */
function checkout(name: string): string {
  const repo = join(dir, name);
  mkdirSync(join(repo, "opencode"), { recursive: true });
  writeFileSync(join(repo, "opencode", "caret.plugin.ts"), "// caret");
  return repo;
}

/** Seed the config's `plugin` array before an install, so a case can start from a config
 * a user (or an earlier install) already wrote. */
function seedPlugins(entries: string[]): void {
  writeFileSync(configJson(), `${JSON.stringify({ plugin: entries }, null, 2)}\n`);
}

async function installLocal(repoDir: string, overrides: InstallOpencodeDeps = {}) {
  await runInstallOpencodeTarget(
    {
      uninstall: false,
      dryRun: false,
      refresh: false,
      local: { repoDir, marketplaceDir: join(dir, "dev-marketplace") },
    },
    deps(overrides),
  );
}

test("--from-local points the plugin array at the checkout, not the npm package", async () => {
  const repo = checkout("repo");
  await installLocal(repo);
  expect(plugins()).toEqual([`file:${repo}`]);
});

test("--from-local replaces a pinned npm entry so only one caret plugin loads", async () => {
  const repo = checkout("repo");
  seedPlugins(["someone-else", `${CARET_PACKAGE}@0.7.3`]);
  await installLocal(repo);
  expect(plugins()).toEqual(["someone-else", `file:${repo}`]);
});

test("--from-local is idempotent", async () => {
  const repo = checkout("repo");
  await installLocal(repo);
  await installLocal(repo);
  expect(plugins()).toEqual([`file:${repo}`]);
});

// The reverse direction matters as much: a developer who goes back to the published caret
// must not silently keep running their checkout.
test("a published install replaces the checkout entry --from-local left", async () => {
  const repo = checkout("repo");
  seedPlugins([`file:${repo}`]);
  await install();
  expect(plugins()).toEqual([CARET_PACKAGE]);
});

test("a local entry that is not a caret checkout is another plugin's, and is kept", async () => {
  const other = join(dir, "not-caret");
  mkdirSync(other, { recursive: true });
  seedPlugins([`file:${other}`]);
  await install();
  expect(plugins()).toEqual([`file:${other}`, CARET_PACKAGE]);
});

test("uninstall removes a checkout entry, not just the npm package", async () => {
  const repo = checkout("repo");
  seedPlugins(["someone-else", `file:${repo}`]);
  await install(true);
  expect(plugins()).toEqual(["someone-else"]);
});

test("uninstall clears caret from both plugin and plugins, keeping comments and other entries", async () => {
  const repo = checkout("repo");
  writeFileSync(
    configJson(),
    [
      "{",
      "  // mine",
      `  "plugin": ["someone-else", "${CARET_PACKAGE}@0.7.3"],`,
      `  "plugins": ["other", { "package": "${CARET_PACKAGE}" }, "file:${repo}"]`,
      "}",
      "",
    ].join("\n"),
  );
  await install(true);
  const out = readFileSync(configJson(), "utf-8");
  expect(out).toContain("// mine");
  expect(JSON.parse(out.replace(/^\s*\/\/.*$/gm, ""))).toEqual({
    plugin: ["someone-else"],
    plugins: ["other"],
  });
});

// A checkout entry resolves to that checkout on every OpenCode start, so it cannot be
// stale and npm's version says nothing about it. The check is skipped for that reason,
// not merely to keep the dev loop quiet.
test("--from-local never asks npm what is published", async () => {
  const repo = checkout("repo");
  let asked = false;
  await installLocal(repo, {
    published: async () => {
      asked = true;
      return "9.9.9";
    },
  });
  expect(asked).toBe(false);
});

// --- the pre-array-install sweep ---------------------------------------------------
// caret deployed itself as FILES before the `plugin` array install: a plugin module under
// `plugin/` and command files under `command/` (through v0.1.0), then a plugin module
// under `plugins/` (through v0.3.0). OpenCode scans both spellings of both dirs, so every
// one of those orphans still loads — a leftover plugin file registers a SECOND
// caret_review_plan alongside the array entry, and a leftover command file exposes
// `/caret:*` pointed at a binary path nothing writes any more. Install and uninstall
// sweep them. What the sweep must NOT touch is pinned just as hard: other tools' files,
// the config dir's `package.json`, and the canonical `commands/` dir.

/** caret's own pre-array-install artifacts, all of which the sweep removes. */
function legacyPaths(): string[] {
  return [
    join(dir, "plugins", "caret.ts"),
    join(dir, "plugin", "caret.ts"),
    join(dir, "command", "caret:demo.md"),
    // A command the package no longer ships: the sweep matches caret's NAMESPACE, not the
    // live command set, so an install can't strand a file an older caret deployed.
    join(dir, "command", "caret:retired.md"),
  ];
}

/** A `caret:`-named SUBDIRECTORY of the singular command dir. It matches caret's
 * namespace by name but is not a file caret ever wrote — and handing it to `rmSync`
 * throws, which would abort the install after the array entry was already written. */
const caretNamedDir = () => join(dir, "command", "caret:tools");

/** Files the sweep must leave exactly where they are. */
function survivorPaths(): string[] {
  return [
    join(dir, "plugins", "other-plugin.ts"), // another tool's plugin
    join(dir, "command", "mine.md"), // another tool's command
    join(dir, "command", "caret:demo.md.bak"), // not a command OpenCode would load
    caretNamedDir(),
    join(dir, "package.json"), // the config-dir manifest — deliberately out of scope
    join(dir, "commands", "caret:orphan.md"), // the canonical dir is live, not legacy
  ];
}

/** Write the config dir as a pre-array-install machine left it. */
function seedLegacy(): void {
  mkdirSync(caretNamedDir(), { recursive: true });
  for (const p of [...legacyPaths(), ...survivorPaths()].filter((p) => p !== caretNamedDir())) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "// seeded");
  }
}

/** The subset still on disk / already gone — filters rather than booleans, so a failure
 * names which path broke the expectation. */
const stillThere = (paths: string[]) => paths.filter((p) => existsSync(p));
const missing = (paths: string[]) => paths.filter((p) => !existsSync(p));

test("install sweeps caret's pre-array-install plugin and command files", async () => {
  seedLegacy();
  await install();
  expect(stillThere(legacyPaths())).toEqual([]);
});

test("the sweep leaves other tools' files, the config-dir manifest, and commands/ alone", async () => {
  seedLegacy();
  await install();
  expect(missing(survivorPaths())).toEqual([]);
  expect(existsSync(commandFile())).toBe(true); // the command file it just deployed
});

test("with nothing legacy on disk, no sweep step is raised at all", async () => {
  const said = await transcript({ published: async () => "0.8.1" });
  expect(said).not.toContain("pre-array-install");
  expect(existsSync(commandFile())).toBe(true);
});

test("a `caret:`-named directory is not swept, and does not break the install", async () => {
  // `rmSync` on a directory throws, and the step's throw aborts the run — after the array
  // entry is written and before the command files deploy, on every re-run.
  seedLegacy();
  await install();
  expect(existsSync(caretNamedDir())).toBe(true);
  expect(existsSync(commandFile())).toBe(true); // the run got past the sweep
});

test("the sweep is idempotent: a second install raises no step and changes nothing", async () => {
  seedLegacy();
  await install();
  const said = await transcript({ published: async () => "0.8.1" });
  expect(said).not.toContain("pre-array-install");
  expect(stillThere(legacyPaths())).toEqual([]);
  expect(missing(survivorPaths())).toEqual([]);
});

// The install arm's ordering is what unblocked this work from the upgrade-path child: a
// cached array plugin can be OLDER than the file-deployed one, so dropping the file before
// the refresh is offered can move a user backwards.
test("the install sweep runs after the upgrade check, never before it", async () => {
  seedLegacy();
  const ui = recordingUI();
  await runInstallOpencodeTarget(
    { uninstall: false, dryRun: false, refresh: true },
    deps({
      ui,
      published: async () => "0.8.1",
      cacheDirs: () => [cacheDir(CARET_PACKAGE, "0.2.0")],
    }),
  );
  const checkStep = ui.events.findIndex((e) => e.startsWith("step:Checking OpenCode's caret"));
  const sweepStep = ui.events.findIndex((e) => e.includes("pre-array-install"));
  expect(checkStep).toBeGreaterThanOrEqual(0);
  expect(sweepStep).toBeGreaterThan(checkStep);
});

test("a declined refresh still sweeps — two loaded caret plugins is the worse outcome", async () => {
  const cache = cacheDir(CARET_PACKAGE, "0.2.0");
  seedLegacy();
  await transcript(staleCacheDeps(cache, async () => false));
  expect(existsSync(cache)).toBe(true); // the decline was honoured
  expect(stillThere(legacyPaths())).toEqual([]);
});

test("uninstall sweeps them too, reported apart from the command-file step", async () => {
  seedLegacy();
  const ui = recordingUI();
  await runInstallOpencodeTarget({ uninstall: true, dryRun: false, refresh: false }, deps({ ui }));
  expect(stillThere(legacyPaths())).toEqual([]);
  expect(missing(survivorPaths())).toEqual([]);
  const commandStep = ui.events.findIndex((e) => e.startsWith("step:Removing the /caret:*"));
  const sweepStep = ui.events.findIndex((e) => e.includes("pre-array-install"));
  expect(commandStep).toBeGreaterThanOrEqual(0);
  expect(sweepStep).toBeGreaterThan(commandStep);
});

test("--dry-run names the legacy files in its preview and removes none of them", async () => {
  seedLegacy();
  const said = await transcript({ published: async () => "0.8.1" }, { dryRun: true });
  expect(said).toContain("pre-array-install files to remove:");
  for (const p of legacyPaths()) expect(said).toContain(p);
  expect(missing(legacyPaths())).toEqual([]);
});

// --- the key the host loads: v2's `plugins`, v1's `plugin` -------------------------

const V2_VERSION: VersionTriple = [2, 0, 18];
const V1_VERSION: VersionTriple = [1, 18, 29];
const V2 = { opencodeVersion: () => V2_VERSION };
const V1 = { opencodeVersion: () => V1_VERSION };
const config = () => JSON.parse(readFileSync(configJson(), "utf-8"));

async function installOn(overrides: InstallOpencodeDeps, local?: string): Promise<void> {
  await runInstallOpencodeTarget(
    {
      uninstall: false,
      dryRun: false,
      refresh: false,
      ...(local === undefined
        ? {}
        : { local: { repoDir: local, marketplaceDir: join(dir, "dev-marketplace") } }),
    },
    deps(overrides),
  );
}

test("on v2, install writes caret to plugins as a bare string", async () => {
  await installOn(V2);
  expect(config()).toEqual({ plugins: [CARET_PACKAGE] });
});

test("on v2, a caret plugin entry moves to plugins, keeping comments and other entries", async () => {
  writeFileSync(
    configJson(),
    [
      "{",
      "  // mine",
      `  "plugin": ["wakatime", "${CARET_PACKAGE}"],`,
      '  "plugins": ["other"]',
      "}",
      "",
    ].join("\n"),
  );
  await installOn(V2);
  const text = readFileSync(configJson(), "utf-8");
  expect(text).toContain("// mine");
  expect(parseJsonc(text)).toEqual({ plugin: ["wakatime"], plugins: ["other", CARET_PACKAGE] });
});

test("on v2, a pin survives the move to plugins", async () => {
  writeFileSync(configJson(), JSON.stringify({ plugin: [`${CARET_PACKAGE}@0.8.1`] }));
  await installOn(V2);
  expect(config()).toEqual({ plugin: [], plugins: [`${CARET_PACKAGE}@0.8.1`] });
});

test("a move says which key caret left and names the pin it carried", async () => {
  writeFileSync(configJson(), JSON.stringify({ plugin: [`${CARET_PACKAGE}@0.8.1`] }));
  const said = await transcript(V2);
  expect(said).toContain("(moved from plugin)");
  expect(said).toContain(`Added ${CARET_PACKAGE}@0.8.1 to opencode.json`);
});

test("on v2, duplicate caret plugins entries collapse to the pinned one", async () => {
  writeFileSync(
    configJson(),
    JSON.stringify({ plugins: [CARET_PACKAGE, `${CARET_PACKAGE}@0.8.1`] }),
  );
  await installOn(V2);
  expect(config()).toEqual({ plugins: [`${CARET_PACKAGE}@0.8.1`] });
});

test("on v2, a string and an object caret item collapse to one", async () => {
  writeFileSync(
    configJson(),
    JSON.stringify({ plugins: [CARET_PACKAGE, { package: CARET_PACKAGE }] }),
  );
  await installOn(V2);
  expect(config()).toEqual({ plugins: [CARET_PACKAGE] });
});

test("on v2, the plugin pin the user runs today wins over a bare plugins entry", async () => {
  writeFileSync(
    configJson(),
    JSON.stringify({ plugin: [`${CARET_PACKAGE}@0.8.1`], plugins: [CARET_PACKAGE] }),
  );
  await installOn(V2);
  expect(config()).toEqual({ plugin: [], plugins: [`${CARET_PACKAGE}@0.8.1`] });
});

test("re-installing over a correct v2 config writes nothing", async () => {
  const text = `{\n  "plugins": [{ "package": "${CARET_PACKAGE}" }]\n}\n`;
  writeFileSync(configJson(), text);
  const before = statSync(configJson()).mtimeMs;
  await Bun.sleep(5);
  await installOn(V2);
  expect(readFileSync(configJson(), "utf-8")).toBe(text);
  expect(statSync(configJson()).mtimeMs).toBe(before);
});

test("--from-local on v2 writes the checkout to plugins and drops package entries in both keys", async () => {
  const repo = checkout("repo");
  writeFileSync(
    configJson(),
    JSON.stringify({ plugin: [CARET_PACKAGE], plugins: [CARET_PACKAGE] }),
  );
  await installOn(V2, repo);
  expect(config()).toEqual({ plugin: [], plugins: [`file:${repo}`] });
});

const configFile = (name: string) => join(dir, name);
const parsed = (name: string) => parseJsonc(readFileSync(configFile(name), "utf-8"));
const caretCount = () =>
  CONFIG_FILENAMES.reduce(
    (n, name) => n + caretEntries(readConfigText(configFile(name)), () => false).length,
    0,
  );

test("v2: a config.json-only user gets caret in a new opencode.json", async () => {
  writeFileSync(
    configFile("config.json"),
    JSON.stringify({ theme: "dark", plugin: ["wakatime", `${CARET_PACKAGE}@1.0.0`] }),
  );
  await installOn(V2);
  expect(config()).toEqual({ plugins: [`${CARET_PACKAGE}@1.0.0`] });
  expect(parsed("config.json")).toEqual({ theme: "dark", plugin: ["wakatime"] });
});

test("v2: with both opencode.json and opencode.jsonc, caret stays only in opencode.jsonc", async () => {
  writeFileSync(configFile("opencode.jsonc"), '{\n  // mine\n  "theme": "dark"\n}\n');
  writeFileSync(
    configJson(),
    JSON.stringify({ plugin: [CARET_PACKAGE], plugins: [CARET_PACKAGE] }),
  );
  await installOn(V2);
  expect(parsed("opencode.jsonc").plugins).toEqual([CARET_PACKAGE]);
  expect(config()).toEqual({ plugin: [] });
  expect(caretCount()).toBe(1);
});

test("v2: a duplicate spread across both keys and both files collapses to one", async () => {
  writeFileSync(configFile("opencode.jsonc"), JSON.stringify({ plugin: [CARET_PACKAGE] }));
  writeFileSync(configJson(), JSON.stringify({ plugins: [`${CARET_PACKAGE}@1.2.3`] }));
  await installOn(V2);
  expect(caretCount()).toBe(1);
  expect(parsed("opencode.jsonc").plugins).toEqual([`${CARET_PACKAGE}@1.2.3`]);
});

test("v2: install says v2 ignores config.json once", async () => {
  writeFileSync(configFile("config.json"), JSON.stringify({ plugin: [CARET_PACKAGE] }));
  const note = "OpenCode v2 ignores config.json — caret goes in opencode.json";
  expect(await transcript(V2)).toContain(note);
  expect(await transcript(V2)).not.toContain(note);
});

test("v1: a config.json-only user keeps caret in config.json", async () => {
  writeFileSync(configFile("config.json"), JSON.stringify({ theme: "dark" }));
  await installOn(V1);
  expect(parsed("config.json")).toEqual({ theme: "dark", plugin: [CARET_PACKAGE] });
  expect(existsSync(configJson())).toBe(false);
});

test("unknown host: a config.json-only user moves caret to opencode.json", async () => {
  writeFileSync(configFile("config.json"), JSON.stringify({ plugin: [CARET_PACKAGE] }));
  await installOn({});
  expect(config()).toEqual({ plugin: [CARET_PACKAGE] });
  expect(parsed("config.json")).toEqual({ plugin: [] });
});

test("v2: a pin in an ignored config.json does not replace the opencode.json entry", async () => {
  writeFileSync(configJson(), JSON.stringify({ plugins: [CARET_PACKAGE] }));
  writeFileSync(configFile("config.json"), JSON.stringify({ plugin: [`${CARET_PACKAGE}@0.4.0`] }));
  await installOn(V2);
  expect(config()).toEqual({ plugins: [CARET_PACKAGE] });
  expect(parsed("config.json")).toEqual({ plugin: [] });
});

test("uninstall removes caret from every global config file", async () => {
  for (const name of CONFIG_FILENAMES) {
    writeFileSync(
      configFile(name),
      JSON.stringify({ theme: name, plugin: ["wakatime", CARET_PACKAGE] }),
    );
  }
  await install(true);
  for (const name of CONFIG_FILENAMES) {
    expect(parsed(name)).toEqual({ theme: name, plugin: ["wakatime"] });
  }
});

/** v2, with caret absent from the target opencode.jsonc but present in both files the
 * install strips. */
function seedSpreadCaret(): Map<string, string> {
  writeFileSync(configFile("opencode.jsonc"), '{ "theme": "dark" }');
  writeFileSync(configJson(), JSON.stringify({ plugins: [CARET_PACKAGE] }));
  writeFileSync(configFile("config.json"), JSON.stringify({ plugin: [CARET_PACKAGE] }));
  return new Map(CONFIG_FILENAMES.map((n) => [n, readFileSync(configFile(n), "utf-8")]));
}

test("install --dry-run lists every config file it would change and writes nothing", async () => {
  const before = seedSpreadCaret();
  const said = await transcript(V2, { dryRun: true });
  for (const name of CONFIG_FILENAMES) {
    expect(said).toContain(configFile(name));
    expect(readFileSync(configFile(name), "utf-8")).toBe(before.get(name) ?? "");
  }
});

test("uninstall --dry-run lists every config file it would change", async () => {
  seedSpreadCaret();
  const said = await transcript(V2, { uninstall: true, dryRun: true });
  expect(said).toContain(configJson());
  expect(said).toContain(configFile("config.json"));
  expect(said).not.toContain(configFile("opencode.jsonc"));
});

test("on v1, install writes caret to plugin", async () => {
  await installOn(V1);
  expect(config()).toEqual({ plugin: [CARET_PACKAGE] });
});

test("an unreadable version moves caret back to plugin, deleting a plugins it emptied", async () => {
  writeFileSync(configJson(), JSON.stringify({ plugins: [`${CARET_PACKAGE}@0.8.1`] }));
  const said = await transcript({});
  expect(config()).toEqual({ plugin: [`${CARET_PACKAGE}@0.8.1`] });
  expect(said).toContain("(moved from plugins)");
});

test("a non-caret file: entry is kept on v2", async () => {
  const other = join(dir, "not-caret");
  mkdirSync(other, { recursive: true });
  writeFileSync(configJson(), JSON.stringify({ plugin: [`file:${other}`] }));
  await installOn(V2);
  expect(config()).toEqual({ plugin: [`file:${other}`], plugins: [CARET_PACKAGE] });
});

test("the install names the host it found and the key it writes", async () => {
  expect(await transcript(V2)).toContain("OpenCode 2.0.18 — writing caret to plugins");
  expect(await transcript({})).toContain("couldn't read `opencode --version`");
});

test("the dry run names the key and writes nothing", async () => {
  const said = await transcript(V2, { dryRun: true });
  expect(said).toContain(`plugin entry: ${CARET_PACKAGE} → plugins`);
  expect(existsSync(configJson())).toBe(false);
});

test("--refresh bumps a stale plugins pin in plugins", async () => {
  writeFileSync(configJson(), JSON.stringify({ plugins: [`${CARET_PACKAGE}@0.7.3`] }, null, 2));
  cacheDir(`${CARET_PACKAGE}@0.7.3`, "0.7.3");
  await transcript({ ...V2, published: async () => "0.8.1" }, { refresh: true });
  expect(config()).toEqual({ plugins: [`${CARET_PACKAGE}@0.8.1`] });
});

test("moving caret out of plugins on a v1 host keeps the config's comments", async () => {
  writeFileSync(configJson(), `{\n  // mine\n  "plugins": ["${CARET_PACKAGE}"]\n}\n`);
  await installOn(V1);
  const out = readFileSync(configJson(), "utf-8");
  expect(out).toContain("// mine");
  expect(JSON.parse(out.replace(/^\s*\/\/.*$/gm, ""))).toEqual({ plugin: [CARET_PACKAGE] });
});

test("a v2 dry run reads a plugin entry's version from v2's cache layout", async () => {
  writeFileSync(configJson(), JSON.stringify({ plugin: [CARET_PACKAGE] }));
  const gen = join(dir, "xdg-cache", "opencode", "npm", `${CARET_PACKAGE}@latest`, "1");
  mkdirSync(join(gen, "node_modules", CARET_PACKAGE), { recursive: true });
  writeFileSync(
    join(gen, "node_modules", CARET_PACKAGE, "package.json"),
    JSON.stringify({ version: "0.8.0" }),
  );
  const said = await withEnv({ XDG_CACHE_HOME: join(dir, "xdg-cache") }, () =>
    transcript({ ...V2, cacheDir: undefined, published: async () => "0.9.0" }, { dryRun: true }),
  );
  expect(said).toContain("OpenCode's cached caret is 0.8.0");
});

test("a config that fails to parse stops install before any write", async () => {
  const jsonc = configFile("opencode.jsonc");
  writeFileSync(jsonc, '{ "plugins": [');
  writeFileSync(configJson(), JSON.stringify({ plugin: [CARET_PACKAGE] }));
  const before = [readFileSync(jsonc, "utf-8"), readFileSync(configJson(), "utf-8")];
  await expect(installOn(V2)).rejects.toThrow("opencode.jsonc");
  expect([readFileSync(jsonc, "utf-8"), readFileSync(configJson(), "utf-8")]).toEqual(before);
});

test("a config that fails to parse stops an install dry run, naming it", async () => {
  const jsonc = configFile("opencode.jsonc");
  writeFileSync(jsonc, '{ "plugins": [');
  writeFileSync(configJson(), JSON.stringify({ plugin: [CARET_PACKAGE] }));
  const before = [readFileSync(jsonc, "utf-8"), readFileSync(configJson(), "utf-8")];
  await expect(transcript(V2, { dryRun: true })).rejects.toThrow("opencode.jsonc");
  expect([readFileSync(jsonc, "utf-8"), readFileSync(configJson(), "utf-8")]).toEqual(before);
});

test("uninstall skips a config that fails to parse and clears the rest", async () => {
  const garbled = configFile("config.json");
  const jsonc = configFile("opencode.jsonc");
  writeFileSync(garbled, "{ nope");
  writeFileSync(jsonc, JSON.stringify({ plugins: [CARET_PACKAGE] }));
  const said = await transcript({}, { uninstall: true });
  expect(caretEntries(readFileSync(jsonc, "utf-8"), () => false)).toEqual([]);
  expect(readFileSync(garbled, "utf-8")).toBe("{ nope");
  expect(said).toMatch(/warn.*config\.json/);
  expect(said.search(/warn:.*config\.json/)).toBeLessThan(
    said.indexOf("step:Removing caret from OpenCode's plugin and plugins keys"),
  );
});

test("a symlinked config is edited through to its target", async () => {
  const elsewhere = await mkdtemp(join(tmpdir(), "caret-install-oc-target-"));
  try {
    const real = join(elsewhere, "opencode.jsonc");
    writeFileSync(real, "{}");
    symlinkSync(real, configFile("opencode.jsonc"));
    await installOn(V2);
    expect(lstatSync(configFile("opencode.jsonc")).isSymbolicLink()).toBe(true);
    expect(caretEntries(readFileSync(real, "utf-8"), () => false).length).toBe(1);
  } finally {
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("a config.json that aliases opencode.json keeps caret on v2", async () => {
  writeFileSync(configJson(), JSON.stringify({ plugins: [CARET_PACKAGE] }));
  symlinkSync(configJson(), configFile("config.json"));
  await installOn(V2);
  expect(config()).toEqual({ plugins: [CARET_PACKAGE] });
});

test("uninstall warns past a config it cannot read and clears the rest", async () => {
  mkdirSync(configFile("config.json"));
  writeFileSync(configFile("opencode.jsonc"), JSON.stringify({ plugins: [CARET_PACKAGE] }));
  const said = await transcript({}, { uninstall: true });
  expect(parsed("opencode.jsonc")).toEqual({});
  expect(said).toMatch(/warn:.*config\.json/);
});

test("uninstall that could only skip caret's file says no readable config held it", async () => {
  writeFileSync(configFile("config.json"), `{ "plugin": ["${CARET_PACKAGE}"`);
  const said = await transcript({}, { uninstall: true });
  expect(said).toContain("caret was not in any readable OpenCode config");
});

test("a failed later write names the files already changed", async () => {
  const legacy = configFile("config.json");
  writeFileSync(legacy, JSON.stringify({ plugin: [CARET_PACKAGE] }));
  symlinkSync(join(dir, "missing", "opencode.json"), configJson());
  await expect(installOn(V2)).rejects.toThrow(/already changed: .*config\.json/);
  expect(caretEntries(readFileSync(legacy, "utf-8"), () => false)).toEqual([]);
});
