// Claude Code's skill enumerator: the names a reviewer may cite in feedback, for
// the feedback editors' `/` completion (EXC-1176). Best-effort and strictly
// read-only, in the same posture as install.ts — every miss degrades to "nothing
// from that root" rather than throwing, so the editor behaves exactly as it did
// before completion existed when a directory is unreadable.
//
// The enumeration reads directory NAMES only: a skill's `SKILL.md` is probed for
// existence and never opened, so nothing a skill author wrote reaches the UI on
// that route.
//
// `readClaudeSkillDescription` is a SECOND, on-demand route beside it, and it
// DOES open one skill's SKILL.md to read that skill's own `description`
// (EXC-1186). The privacy question is a different one: enumerating is caret
// deciding what to read, while this is the reviewer pointing at one name in the
// `/` list and asking what it is. One file is opened per ask, only its
// frontmatter `description` crosses to the UI, and its body never does — which is
// why it stays a separate call rather than a field on the list, where every `/`
// keystroke would open every skill's file.
//
// SCOPE: Claude's SKILLS, not everything its `/` menu lists. Slash commands
// (`~/.claude/commands/*.md`, and a plugin's `commands/` — caret's own
// `/caret:demo` among them) and the skills bundled inside the Claude Code client
// are all absent. The line is that a skill is model-invocable from the plan a
// reviewer is writing, while a command is a client-side prompt macro the agent
// cannot reach mid-turn. Worth naming because the OpenCode adapter enumerates
// exactly the thing excluded here — its `/` menu IS its commands.
//
// Plugin skills come from Claude's own registry rather than from a glob of the
// cache tree. `installed_plugins.json` gives each plugin's installPath and the
// settings layers' `enabledPlugins` says which of them the agent actually loads;
// the cache holds several versions of the same plugin side by side and several
// plugins that are installed but disabled, every one of which a glob would offer
// as a skill the agent cannot reach. Reading `enabledPlugins` means reading keys
// that are not caret's own — unlike install.ts, whose output is shared in a
// discovery report, nothing here leaves the machine.

import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  claudeConfigDir,
  installedPluginsFile,
  userSettingsFile,
} from "@/adapters/claude/paths.ts";
import { readJsonFile } from "@/lib/json-file.ts";
import { readDescriptionUnder } from "@/lib/skill-doc.ts";
import type { SkillRef } from "@/lib/types.ts";

/** The file whose presence makes a directory a skill. */
const SKILL_FILE = "SKILL.md";

/** One install of a plugin, as `installed_plugins.json` records it. Three fields
 * are read — where the install lives, the scope it was installed at
 * (`managed`/`user`/`project`/`local`), and, for the project-shaped scopes, the
 * directory it was installed against. All stay `unknown` and are narrowed at use:
 * this is someone else's JSON. The rest of each entry is Claude's. */
interface PluginInstall {
  installPath?: unknown;
  scope?: unknown;
  projectPath?: unknown;
}

/** One registry entry per plugin, holding every install of it. */
interface InstalledPlugins {
  plugins?: Record<string, PluginInstall[] | undefined>;
}

/** The `enabledPlugins` map from a settings file — the only key read. */
interface ClaudeSettings {
  enabledPlugins?: Record<string, unknown>;
}

/** The skill directories directly under `root`, sorted by name. Empty when the
 * root is absent or unreadable. Only one level deep: a skill is a directory
 * holding a SKILL.md, and every root Claude scans is flat.
 *
 * Entry types are deliberately NOT filtered. A skill deployed by symlink — the
 * ordinary dotfiles layout — reports as a symlink rather than a directory, and
 * Claude Code loads it fine; the same trap `opencode/paths.ts` documents for its
 * cache dirs. `access()` follows symlinks, so the SKILL.md probe is the whole
 * test and a type filter would only lose those skills. A plain file in the root
 * (a stray `README.md`) fails the probe like any other non-skill. */
async function skillNamesUnder(root: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return []; // root absent or unreadable — nothing from here.
  }
  const found = await Promise.all(names.map((name) => hasSkillFile(join(root, name))));
  return names.filter((_, i) => found[i]).sort();
}

async function hasSkillFile(dir: string): Promise<boolean> {
  try {
    await access(join(dir, SKILL_FILE));
    return true;
  } catch {
    return false;
  }
}

/** The settings files Claude merges `enabledPlugins` from, in precedence order
 * (later wins): the user layer, then the reviewed project's. A plugin enabled for
 * one project only is live for a review of that project, so reading the user
 * layer alone would drop its skills — the same reason the project skills root is
 * walked at all. Managed/enterprise settings are not read: they live at a
 * platform-specific path outside the reviewer's own directories. */
function settingsLayers(cwd: string): string[] {
  const userDir = claudeConfigDir();
  return [
    userSettingsFile(),
    join(userDir, "settings.local.json"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.local.json"),
  ];
}

/** Where each origin's skills live. Named because both routes over this file —
 * the enumeration and the description reader — must agree about them: a root
 * spelled differently in the two places would answer null for every skill of that
 * origin, silently and only in the preview panel. */
const userSkillsRoot = (): string => join(claudeConfigDir(), "skills");
const projectSkillsRoot = (cwd: string): string => join(cwd, ".claude", "skills");
const pluginSkillsRoot = (install: string): string => join(install, "skills");

/** Every plugin key the merged settings layers mark enabled. */
async function enabledPluginKeys(cwd: string): Promise<Set<string>> {
  const layers = (await Promise.all(
    settingsLayers(cwd).map((path) => readJsonFile(path)),
  )) as Array<ClaudeSettings | null>;
  const merged: Record<string, unknown> = {};
  for (const layer of layers) Object.assign(merged, layer?.enabledPlugins ?? {});
  return new Set(Object.keys(merged).filter((key) => merged[key] === true));
}

/** The install directory a session in `cwd` would load this plugin from.
 *
 * The registry records an ARRAY of installs per plugin — the same plugin can be
 * installed at user scope and again against a particular project. `enabledPlugins`
 * is keyed by plugin rather than by install, so the settings layers decide only
 * *whether* the plugin is live; which install is meant comes from the entries
 * themselves. Claude Code answers that by REACHABILITY: a `user` or `managed`
 * install is reachable from anywhere, a project-shaped one only from the directory
 * it names. Preferred here, most specific first: an install whose `projectPath` is
 * exactly this cwd, then a user/managed one.
 *
 * The last resort is the first install with a usable path, reachable or not.
 * Claude Code canonicalizes both paths before comparing and caret cannot, and
 * caret's own reviews run inside git worktrees — a plugin installed against
 * `…/trunk` while the review sits in `…/EXC-1176+…` fails an equality test that
 * Claude Code passes. Falling back rather than dropping keeps this preference from
 * ever offering FEWER skills than registry order did; it only stops preferring a
 * foreign project's install when a reachable one exists. */
function pickInstallPath(installs: PluginInstall[], cwd: string): string | undefined {
  const usable = installs.filter(
    (install): install is PluginInstall & { installPath: string } =>
      typeof install.installPath === "string",
  );
  const here = usable.find((install) => install.projectPath === cwd);
  const anywhere = usable.find(
    (install) => install.scope === "user" || install.scope === "managed",
  );
  return (here ?? anywhere ?? usable[0])?.installPath;
}

/** Each enabled plugin's bare name paired with its install directory, sorted by
 * name. Empty when the registry is absent or unparseable. */
async function enabledPlugins(cwd: string): Promise<Array<[string, string]>> {
  const [registry, enabled] = await Promise.all([
    readJsonFile(installedPluginsFile()) as Promise<InstalledPlugins | null>,
    enabledPluginKeys(cwd),
  ]);
  const out: Array<[string, string]> = [];
  for (const [key, installs] of Object.entries(registry?.plugins ?? {})) {
    if (!enabled.has(key)) continue;
    const installPath = pickInstallPath(installs ?? [], cwd);
    if (installPath === undefined) continue;
    // The registry key is `<plugin>@<marketplace>`; the `/` menu names a skill by
    // the plugin half alone (`/superpowers:brainstorming`).
    out.push([key.split("@")[0] ?? key, installPath]);
  }
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Every skill the Claude Code session reviewing `cwd` can reach: the reviewer's
 * own skills, the reviewed project's, and each enabled plugin's — the last
 * namespaced as `<plugin>:<skill>`, which is how the agent's own menu names them
 * and the only form that identifies exactly one skill.
 *
 * Ordered user, then project, then plugin, each group sorted by name, so the list
 * is the same on every machine. A bare name offered by two roots yields two
 * entries: which one wins is the agent's business, and hiding one here would be
 * the silent-shadowing the completion list exists to avoid.
 *
 * Never throws: an unreadable root contributes nothing.
 */
export async function readClaudeSkills(cwd: string): Promise<SkillRef[]> {
  const [user, project, plugins] = await Promise.all([
    skillNamesUnder(userSkillsRoot()),
    skillNamesUnder(projectSkillsRoot(cwd)),
    enabledPlugins(cwd),
  ]);
  const pluginSkills = await Promise.all(
    plugins.map(async ([plugin, dir]) =>
      (await skillNamesUnder(pluginSkillsRoot(dir))).map(
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

/** The skills root a `SkillRef` belongs to, and the path of its document under
 * that root — or null for an origin no root answers to. A plugin's root is its own
 * install dir, so its namespaced `<plugin>:<rest>` name is split here: the plugin
 * half picks the root and the rest names the skill inside it. */
async function skillDocLocation(
  cwd: string,
  skill: SkillRef,
): Promise<{ root: string; relative: string } | null> {
  const under = (root: string, name: string) => ({ root, relative: join(name, SKILL_FILE) });
  if (skill.origin === "user") return under(userSkillsRoot(), skill.name);
  if (skill.origin === "project") return under(projectSkillsRoot(cwd), skill.name);
  if (skill.origin !== "plugin") return null;
  const at = skill.name.indexOf(":");
  if (at === -1) return null; // a plugin skill is always namespaced.
  const plugin = skill.name.slice(0, at);
  const hit = (await enabledPlugins(cwd)).find(([key]) => key === plugin);
  // An unknown or disabled plugin has no root to read: the `/` list never offered
  // that name, so this is a stale or invented one either way.
  return hit === undefined ? null : under(pluginSkillsRoot(hit[1]), skill.name.slice(at + 1));
}

/**
 * One skill's own `description`, for the completion preview panel — null when the
 * skill has none, which is an ordinary answer rather than an error.
 *
 * Takes the whole `SkillRef` because its `origin` is what says WHICH skill is
 * meant: two roots may offer the same bare name and the list deliberately shows
 * both rows, so the name alone would describe one of them twice.
 *
 * Never throws, and never reads outside the root the origin picked — the name
 * arrives from the browser, and `readDescriptionUnder` decides containment.
 */
export async function readClaudeSkillDescription(
  cwd: string,
  skill: SkillRef,
): Promise<string | null> {
  const at = await skillDocLocation(cwd, skill);
  return at === null ? null : readDescriptionUnder(at.root, at.relative);
}
