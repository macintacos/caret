import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readClaudeSkills } from "@/adapters/claude/skills.ts";

// The Claude skill enumerator reads three roots: the user's own skills dir, the
// reviewed project's, and each ENABLED plugin's. Point CLAUDE_CONFIG_DIR at a
// throwaway temp dir so it never reads the real ~/.claude, and root the project
// half at a second temp dir; both are restored/removed after each test.

let tmp: string;
let savedClaude: string | undefined;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-claude-skills-"));
  savedClaude = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(tmp, "claude");
});
afterEach(async () => {
  if (savedClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedClaude;
  await rm(tmp, { recursive: true, force: true });
});

/** Write `<root>/<name>/SKILL.md` — the shape that makes a directory a skill. */
async function seedSkill(root: string, name: string): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, "SKILL.md"), "---\nname: x\n---\n");
}

/** The user skills root under the temp config dir. */
function userRoot(): string {
  return join(tmp, "claude", "skills");
}

/** A project cwd whose `.claude/skills/` root is seeded with `names`. */
async function seedProject(names: string[]): Promise<string> {
  const cwd = join(tmp, "project");
  for (const name of names) await seedSkill(join(cwd, ".claude", "skills"), name);
  return cwd;
}

/**
 * Seed Claude's plugin registry and the plugins' own skill trees.
 * `plugins` maps `<plugin>@<marketplace>` to its skill names; `enabled` is the
 * subset listed as `true` in settings.json.
 */
async function seedPlugins(
  plugins: Record<string, string[]>,
  enabled: string[],
  settingsPath = join(tmp, "claude", "settings.json"),
): Promise<void> {
  const dir = join(tmp, "claude");
  const registry: Record<string, Array<{ installPath: string; version: string }>> = {};
  for (const [key, names] of Object.entries(plugins)) {
    const installPath = join(dir, "plugins", "cache", key.replace("@", "-"), "1.0.0");
    for (const name of names) await seedSkill(join(installPath, "skills"), name);
    registry[key] = [{ installPath, version: "1.0.0" }];
  }
  await mkdir(join(dir, "plugins"), { recursive: true });
  await writeFile(
    join(dir, "plugins", "installed_plugins.json"),
    JSON.stringify({ plugins: registry }),
  );
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(
    settingsPath,
    JSON.stringify({ enabledPlugins: Object.fromEntries(enabled.map((k) => [k, true])) }),
  );
}

test("yields nothing when no root exists, rather than throwing", async () => {
  expect(await readClaudeSkills(join(tmp, "nowhere"))).toEqual([]);
});

test("names a user skill by its directory", async () => {
  await seedSkill(userRoot(), "linear-plan");
  expect(await readClaudeSkills(join(tmp, "nowhere"))).toEqual([
    { name: "linear-plan", origin: "user" },
  ]);
});

test("names a project skill by its directory under .claude/skills", async () => {
  const cwd = await seedProject(["release-caret"]);
  expect(await readClaudeSkills(cwd)).toEqual([{ name: "release-caret", origin: "project" }]);
});

test("namespaces a plugin skill with its plugin name", async () => {
  await seedPlugins({ "superpowers@official": ["brainstorming"] }, ["superpowers@official"]);
  expect(await readClaudeSkills(join(tmp, "nowhere"))).toEqual([
    { name: "superpowers:brainstorming", origin: "plugin" },
  ]);
});

test("skips a plugin that is installed but not enabled", async () => {
  await seedPlugins({ "superpowers@official": ["brainstorming"], "chrome@official": ["driving"] }, [
    "superpowers@official",
  ]);
  const names = (await readClaudeSkills(join(tmp, "nowhere"))).map((s) => s.name);
  expect(names).toEqual(["superpowers:brainstorming"]);
});

test("reads the registry's installPath, so a stale cached version contributes nothing", async () => {
  await seedPlugins({ "superpowers@official": ["brainstorming"] }, ["superpowers@official"]);
  // A second version sits in the cache tree beside the installed one. Only the
  // registry's installPath is walked, so its skills never reach the list.
  await seedSkill(
    join(tmp, "claude", "plugins", "cache", "superpowers-official", "0.9.0", "skills"),
    "since-removed",
  );
  const names = (await readClaudeSkills(join(tmp, "nowhere"))).map((s) => s.name);
  expect(names).toEqual(["superpowers:brainstorming"]);
});

test("ignores a directory with no SKILL.md", async () => {
  await mkdir(join(userRoot(), "__lib__"), { recursive: true });
  await writeFile(join(userRoot(), "README.md"), "not a skill");
  await seedSkill(userRoot(), "git");
  expect(await readClaudeSkills(join(tmp, "nowhere"))).toEqual([{ name: "git", origin: "user" }]);
});

test("keeps both entries when a user and a project skill share a bare name", async () => {
  await seedSkill(userRoot(), "deploy");
  const cwd = await seedProject(["deploy"]);
  expect(await readClaudeSkills(cwd)).toEqual([
    { name: "deploy", origin: "user" },
    { name: "deploy", origin: "project" },
  ]);
});

test("orders user, then project, then plugin, each sorted by name", async () => {
  await seedSkill(userRoot(), "zebra");
  await seedSkill(userRoot(), "alpha");
  const cwd = await seedProject(["yak", "bison"]);
  await seedPlugins({ "pz@m": ["one"], "pa@m": ["two"] }, ["pz@m", "pa@m"]);
  expect((await readClaudeSkills(cwd)).map((s) => s.name)).toEqual([
    "alpha",
    "zebra",
    "bison",
    "yak",
    "pa:two",
    "pz:one",
  ]);
});

test("offers only what the filesystem yields — never the client's own session commands", async () => {
  await seedSkill(userRoot(), "git");
  const names = (await readClaudeSkills(join(tmp, "nowhere"))).map((s) => s.name);
  expect(names).not.toContain("compact");
  expect(names).not.toContain("clear");
  expect(names).not.toContain("help");
});

test("survives a malformed registry, contributing no plugin skills", async () => {
  const dir = join(tmp, "claude");
  await seedSkill(userRoot(), "git");
  await mkdir(join(dir, "plugins"), { recursive: true });
  await writeFile(join(dir, "plugins", "installed_plugins.json"), "{ not json");
  expect(await readClaudeSkills(join(tmp, "nowhere"))).toEqual([{ name: "git", origin: "user" }]);
});

test("follows a symlinked skill directory, the ordinary dotfiles layout", async () => {
  // A skill deployed by `ln -s` reports as a symlink rather than a directory, and
  // Claude Code loads it fine — so a directory-type filter would silently drop it.
  const real = join(tmp, "dotfiles", "my-skill");
  await mkdir(real, { recursive: true });
  await writeFile(join(real, "SKILL.md"), "---\nname: x\n---\n");
  await mkdir(userRoot(), { recursive: true });
  await symlink(real, join(userRoot(), "my-skill"));
  expect(await readClaudeSkills(join(tmp, "nowhere"))).toEqual([
    { name: "my-skill", origin: "user" },
  ]);
});

test("honours a plugin enabled at the project settings layer", async () => {
  const cwd = join(tmp, "project");
  await seedPlugins(
    { "superpowers@official": ["brainstorming"] },
    ["superpowers@official"],
    join(cwd, ".claude", "settings.json"),
  );
  // The user layer says nothing about this plugin; the reviewed project enables it.
  expect((await readClaudeSkills(cwd)).map((s) => s.name)).toEqual(["superpowers:brainstorming"]);
});

test("lets a project layer disable what no layer enabled, leaving the list empty", async () => {
  const cwd = join(tmp, "project");
  await seedPlugins({ "superpowers@official": ["brainstorming"] }, []);
  expect(await readClaudeSkills(cwd)).toEqual([]);
});
