// OpenCode's command enumerator: the names a reviewer may cite in feedback, for
// the feedback editors' `/` completion (EXC-1176). OpenCode has no "skills" of its
// own — its `/` menu IS its commands — so this is the OpenCode answer to the same
// question, in the same best-effort, strictly read-only posture as install.ts.
//
// The enumeration reads file NAMES only; a command's markdown is never opened, so
// nothing a command author wrote reaches the UI on that route.
// `readOpencodeCommandDescription` is a SECOND, on-demand route beside it that
// DOES open one command's file, for the reviewer who highlighted that one name and
// asked what it is — only its frontmatter `description` crosses, never its body
// (EXC-1186). The reviewed project's cwd plays no part in either: OpenCode's
// commands are config-dir-rooted, which is why neither takes one.
//
// Both the canonical `commands/` and the legacy singular `command/` are read,
// because OpenCode loads out of either (paths.ts § COMMAND_DIRNAME) and the
// question here is what the agent can reach, not what caret wrote — a user's own
// `command/foo.md` is a live `/foo`. On a name collision the canonical dir wins,
// matching caret's own write preference.

import { access, readdir } from "node:fs/promises";
import { join, sep } from "node:path";

import { commandDirs, opencodeConfigDir } from "@/adapters/opencode/paths.ts";
import { readDescriptionUnder } from "@/lib/skill-doc.ts";
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

/** Whether `path` is there at all, following symlinks. */
async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * One command's own `description`, for the completion preview panel — null when
 * the command has none, which is an ordinary answer rather than an error.
 *
 * The command dirs are tried canonical-first and the FILE decides, not the
 * description: the first dir holding `<name>.md` is the command OpenCode loads, so
 * a canonical file with no description answers null rather than letting a shadowed
 * legacy file describe it. That is `readOpencodeCommands`' collision preference,
 * applied to the same question one route over.
 *
 * Never throws, and never reads outside the dir it picked. Each command dir is its
 * own containment root, which is what makes a `../` safe in a name that arrived
 * from the browser — and a nested command legitimately carries a `/`, so one is
 * ordinary input here rather than a hypothetical.
 */
export async function readOpencodeCommandDescription(name: string): Promise<string | null> {
  const relative = `${name}.md`;
  for (const dir of commandDirs(opencodeConfigDir())) {
    if (await exists(join(dir, relative))) return readDescriptionUnder(dir, relative);
  }
  return null;
}
