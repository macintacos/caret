// Claude Code's skill enumerator: the names a reviewer may cite in feedback, for
// the feedback editors' `/` completion (EXC-1176). Best-effort and strictly
// read-only, in the same posture as install.ts — every miss degrades to "nothing
// from that root" rather than throwing, so the editor behaves exactly as it did
// before completion existed when a directory is unreadable.
//
// Only directory NAMES are read. A skill's own `SKILL.md` is never opened (its
// existence is the whole test), so nothing a skill author wrote reaches the UI.
//
// Plugin skills come from Claude's own registry rather than from a glob of the
// cache tree. `plugins/installed_plugins.json` gives each plugin's installPath and
// `settings.json`'s `enabledPlugins` says which of them the agent actually loads;
// the cache holds several versions of the same plugin side by side and several
// plugins that are installed but disabled, every one of which a glob would offer
// as a skill the agent cannot reach. Reading `enabledPlugins` means reading keys
// that are not caret's own — unlike install.ts, whose output is shared in a
// discovery report, nothing here leaves the machine.

import type { Dirent } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { readJsonFile } from "@/lib/json-file.ts";
import type { SkillRef } from "@/lib/types.ts";

/** The file whose presence makes a directory a skill. */
const SKILL_FILE = "SKILL.md";

/** The Claude Code config dir: CLAUDE_CONFIG_DIR override, else ~/.claude. */
function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

/** One registry entry per install of a plugin, as `installed_plugins.json`
 * records them. Only `installPath` is read; the rest of each entry is Claude's. */
interface InstalledPlugins {
  plugins?: Record<string, Array<{ installPath?: unknown }> | undefined>;
}

/** The `enabledPlugins` map from `settings.json` — the only key read. */
interface ClaudeSettings {
  enabledPlugins?: Record<string, unknown>;
}

/** The skill directories directly under `root`, sorted by name. Empty when the
 * root is absent or unreadable. Only one level deep: a skill is a directory
 * holding a SKILL.md, and every root Claude scans is flat. */
async function skillNamesUnder(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return []; // root absent or unreadable — nothing from here.
  }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const found = await Promise.all(dirs.map((name) => hasSkillFile(join(root, name))));
  return dirs.filter((_, i) => found[i]).sort();
}

async function hasSkillFile(dir: string): Promise<boolean> {
  try {
    await access(join(dir, SKILL_FILE));
    return true;
  } catch {
    return false;
  }
}

/** Each enabled plugin's bare name paired with its install directory, sorted by
 * name. Empty when either file is absent or unparseable. */
async function enabledPlugins(configDir: string): Promise<Array<[string, string]>> {
  const registry = (await readJsonFile(
    join(configDir, "plugins", "installed_plugins.json"),
  )) as InstalledPlugins | null;
  const settings = (await readJsonFile(join(configDir, "settings.json"))) as ClaudeSettings | null;
  const enabled = settings?.enabledPlugins ?? {};
  const out: Array<[string, string]> = [];
  for (const [key, installs] of Object.entries(registry?.plugins ?? {})) {
    if (enabled[key] !== true) continue;
    const installPath = installs?.[0]?.installPath;
    if (typeof installPath !== "string") continue;
    // The registry key is `<plugin>@<marketplace>`; the `/` menu names a skill by
    // the plugin half alone (`/superpowers:brainstorming`).
    out.push([key.split("@")[0] ?? key, installPath]);
  }
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Every skill the Claude Code session reviewing `cwd` can reach: the reviewer's
 * own skills, the reviewed project's, and each enabled plugin's — the last
 * namespaced as `<plugin>:<skill>`, which is how the agent's own `/` menu names
 * them and the only form that identifies exactly one skill.
 *
 * Ordered user, then project, then plugin, each group sorted by name, so the list
 * is the same on every machine. A bare name offered by two roots yields two
 * entries: which one wins is the agent's business, and hiding one here would be
 * the silent-shadowing the completion list exists to avoid.
 *
 * Never throws: an unreadable root contributes nothing.
 */
export async function readClaudeSkills(cwd: string): Promise<SkillRef[]> {
  const configDir = claudeConfigDir();
  const [user, project, plugins] = await Promise.all([
    skillNamesUnder(join(configDir, "skills")),
    skillNamesUnder(join(cwd, ".claude", "skills")),
    enabledPlugins(configDir),
  ]);
  const pluginSkills = await Promise.all(
    plugins.map(async ([plugin, dir]) =>
      (await skillNamesUnder(join(dir, "skills"))).map(
        (name): SkillRef => ({ name: `${plugin}:${name}`, origin: "plugin" }),
      ),
    ),
  );
  return [
    ...user.map((name): SkillRef => ({ name, origin: "user" })),
    ...project.map((name): SkillRef => ({ name, origin: "project" })),
    ...pluginSkills.flat(),
  ];
}
