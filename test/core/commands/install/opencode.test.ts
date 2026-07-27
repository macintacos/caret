import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OpencodePackaging } from "@/adapters/opencode/packaging.ts";
import { CARET_PACKAGE } from "@/adapters/opencode/paths.ts";
import { type InstallOpencodeDeps, runInstallOpencodeTarget } from "@/commands/install/opencode.ts";
import { type InstallUI, recordingUI } from "@/commands/install/ui.ts";

// Stub packaging so the target never resolves the real caret root. Only the command
// files + bin path matter now (caret itself installs as a `plugin` array entry).
const PACKAGING: OpencodePackaging = {
  binPath: "/opt/caret/bin/caret",
  commands: [{ name: "demo.md", contents: "run __CARET_BIN__" }],
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-install-oc-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The deps every case shares. The upgrade check is wired OFFLINE by default — no suite
 * here may reach npm or read the real OpenCode cache — so a case that exercises the
 * check overrides `published`/`cacheDirs` with its own fixture. */
function deps(overrides: InstallOpencodeDeps = {}): InstallOpencodeDeps {
  return {
    configDir: dir,
    packaging: PACKAGING,
    published: async () => null,
    cacheDirs: () => [],
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
 * shim manifest that records caret's resolved version. Under the temp dir, never the
 * real cache. */
function cacheDir(specifier: string, version: string): string {
  const d = join(dir, "cache", specifier);
  mkdirSync(d, { recursive: true });
  writeFileSync(
    join(d, "package.json"),
    JSON.stringify({ dependencies: { [CARET_PACKAGE]: version } }),
  );
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
  // The command's __CARET_BIN__ marker is substituted with the running caret binary.
  expect(readFileSync(commandFile(), "utf-8")).toBe("run /opt/caret/bin/caret");
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

test("--refresh clears a stale cache without asking", async () => {
  const cache = cacheDir(CARET_PACKAGE, "0.2.0");
  const asked: string[] = [];
  const said = await transcript(
    {
      published: async () => "0.8.1",
      cacheDirs: () => [cache],
      confirm: async (v) => {
        asked.push(v.kind);
        return true;
      },
    },
    { refresh: true },
  );
  expect(asked).toEqual([]);
  expect(existsSync(cache)).toBe(false);
  expect(said).toContain("Cleared 1 cached copy");
});

test("a stale cache the user accepts is cleared", async () => {
  const cache = cacheDir(CARET_PACKAGE, "0.2.0");
  const said = await transcript({
    published: async () => "0.8.1",
    cacheDirs: () => [cache],
    isInteractive: () => true,
    confirm: async () => true,
  });
  expect(existsSync(cache)).toBe(false);
  expect(said).toContain("Cleared 1 cached copy");
});

test("a stale cache the user declines is left alone, and the install is not a failure", async () => {
  const cache = cacheDir(CARET_PACKAGE, "0.2.0");
  const exitCode = process.exitCode;
  await transcript({
    published: async () => "0.8.1",
    cacheDirs: () => [cache],
    isInteractive: () => true,
    confirm: async () => false,
  });
  expect(existsSync(cache)).toBe(true);
  expect(process.exitCode).toBe(exitCode);
  expect(existsSync(commandFile())).toBe(true);
});

test("a cancelled prompt leaves the cache alone, and is not a failure", async () => {
  const cache = cacheDir(CARET_PACKAGE, "0.2.0");
  const exitCode = process.exitCode;
  await transcript({
    published: async () => "0.8.1",
    cacheDirs: () => [cache],
    isInteractive: () => true,
    confirm: async () => null,
  });
  expect(existsSync(cache)).toBe(true);
  expect(process.exitCode).toBe(exitCode);
  expect(existsSync(commandFile())).toBe(true);
});

test("without a terminal, a stale cache names the gap and --refresh rather than asking", async () => {
  const cache = cacheDir(CARET_PACKAGE, "0.2.0");
  const asked: string[] = [];
  const said = await transcript({
    published: async () => "0.8.1",
    cacheDirs: () => [cache],
    isInteractive: () => false,
    confirm: async (v) => {
      asked.push(v.kind);
      return true;
    },
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
// `--from-local` writes `file:<checkout>` instead of the npm package, which is what makes
// OpenCode load the developer's build: it symlinks the target into its cache, so the
// plugin module is the checkout's own and the binary it spawns is the one `mise run build`
// just produced. These cases pin that the two forms are mutually exclusive — caret owns
// exactly one entry — because both present would load two caret plugins, each registering
// the review tool, with the published one answering from a build nobody made.
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
