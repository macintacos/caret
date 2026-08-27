// OpenCode's command enumerator: the names a reviewer may cite in feedback, for
// the feedback editors' `/` completion (EXC-1176). OpenCode has no "skills" of its
// own — its `/` menu IS its commands — so this is the OpenCode answer to the same
// question, in the same best-effort, strictly read-only posture as install.ts.
//
// Only file NAMES are read; a command's markdown body is never opened, so nothing
// a command author wrote reaches the UI. The reviewed project's cwd plays no part:
// OpenCode's commands are config-dir-rooted, which is why this takes no argument.
//
// Both the canonical `commands/` and the legacy singular `command/` are read,
// because OpenCode loads out of either (paths.ts § COMMAND_DIRNAME) and the
// question here is what the agent can reach, not what caret wrote — a user's own
// `command/foo.md` is a live `/foo`. On a name collision the canonical dir wins,
// matching caret's own write preference.

import { readdir } from "node:fs/promises";
import { sep } from "node:path";

import { commandDirs, opencodeConfigDir } from "@/adapters/opencode/paths.ts";
import type { SkillRef } from "@/lib/types.ts";

/** The command names under one dir: each `.md` file's path minus the extension,
 * separators normalised to `/`. Empty when the dir is absent or unreadable. */
async function commandNamesUnder(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir, { recursive: true });
  } catch {
    return []; // dir absent or unreadable — no commands from here.
  }
  return entries
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => rel.slice(0, -".md".length).split(sep).join("/"));
}

/**
 * Every command the OpenCode session can reach, named the way OpenCode names one:
 * its path under the command dir minus the `.md`. That form carries caret's own
 * `caret:` namespace through verbatim (`caret:demo.md` → `caret:demo`) and names
 * a nested command by its path.
 *
 * Sorted by name so the list is the same on every machine. Never throws: an
 * absent or unreadable command dir yields nothing.
 */
export async function readOpencodeCommands(): Promise<SkillRef[]> {
  const perDir = await Promise.all(commandDirs(opencodeConfigDir()).map(commandNamesUnder));
  // Canonical dir first, so its entry survives a same-name collision.
  const names = new Set(perDir.flat());
  return [...names].sort().map((name): SkillRef => ({ name, origin: "command" }));
}
