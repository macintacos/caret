// OpenCode's command enumerator: the names a reviewer may cite in feedback, for
// the feedback editors' `/` completion (EXC-1176). OpenCode has no "skills" of its
// own — its `/` menu is its commands — so this is the OpenCode answer to the same
// question, in the same best-effort, strictly read-only posture as install.ts.
//
// Only file NAMES are read; a command's markdown body is never opened, so nothing
// a command author wrote reaches the UI. The reviewed project's cwd plays no part:
// OpenCode's commands are config-dir-rooted, which is why this takes no argument.
//
// The singular legacy `command/` dir that paths.ts sweeps is deliberately out of
// scope — caret writes only the canonical plural `commands/`.

import { readdir } from "node:fs/promises";
import { sep } from "node:path";

import { commandDir, opencodeConfigDir } from "@/adapters/opencode/paths.ts";
import type { SkillRef } from "@/lib/types.ts";

/**
 * Every command the OpenCode session can reach, named the way OpenCode names one:
 * its path under `commands/` minus the `.md`. That form carries caret's own
 * `caret:` namespace through verbatim (`caret:demo.md` → `caret:demo`) and names
 * a nested command by its path.
 *
 * Sorted by name so the list is the same on every machine. Never throws: an
 * absent or unreadable command dir yields nothing.
 */
export async function readOpencodeCommands(): Promise<SkillRef[]> {
  const dir = commandDir(opencodeConfigDir());
  let entries: string[];
  try {
    entries = await readdir(dir, { recursive: true });
  } catch {
    return []; // dir absent or unreadable — no commands from here.
  }
  return entries
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => rel.slice(0, -".md".length).split(sep).join("/"))
    .sort()
    .map((name): SkillRef => ({ name, origin: "command" }));
}
