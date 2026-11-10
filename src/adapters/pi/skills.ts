// pi's skill enumerator: the names a reviewer may cite in feedback, for the
// feedback editors' `/` completion. Names only, like the Claude enumerator — a
// SKILL.md is probed for existence and opened only by `readPiSkillDescription`.
// Unlike Claude's flat roots, pi discovers skills recursively, so the walk here is
// too — but pi walks unbounded and follows symlinked directories, while this walk
// stops at MAX_DEPTH and descends no symlink, so a loop or a large tree can't stall
// the `/` completion; a skill pi reaches only past either bound isn't offered. pi's
// bare `.md` skill files, its ignore files, and its project-trust gate aren't
// modelled. Prompt templates (`/name`) are not listed. Never throws.

import { existsSync } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { compareCodeUnits } from "@/lib/compare.ts";
import { readDescriptionUnder } from "@/lib/skill-doc.ts";
import type { SkillRef } from "@/lib/types.ts";

const SKILL_FILE = "SKILL.md";

/** How many directories below a root the walk goes; a root's direct children are depth 1. */
export const MAX_DEPTH = 4;

export interface PiSkillRoot {
  dir: string;
  origin: "user" | "user-agents" | "project" | "project-agents";
}

/** `cwd` and each ancestor up to the first holding `.git`, or to the filesystem root. */
function ancestorsToRepoRoot(cwd: string): string[] {
  const ancestors: string[] = [];
  for (let dir = cwd; ; dir = dirname(dir)) {
    ancestors.push(dir);
    if (existsSync(join(dir, ".git")) || dirname(dir) === dir) return ancestors;
  }
}

/** pi's skill roots in the order caret lists them, deduplicated by `dir` (first wins). */
export function piSkillRoots(
  cwd: string,
  { agentDir, home }: { agentDir: string; home: string },
): PiSkillRoot[] {
  const roots: PiSkillRoot[] = [
    { dir: join(agentDir, "skills"), origin: "user" },
    { dir: join(home, ".agents", "skills"), origin: "user-agents" },
    { dir: join(cwd, ".pi", "skills"), origin: "project" },
    ...ancestorsToRepoRoot(cwd).map(
      (dir): PiSkillRoot => ({ dir: join(dir, ".agents", "skills"), origin: "project-agents" }),
    ),
  ];
  return roots.filter((root, i) => roots.findIndex((r) => r.dir === root.dir) === i);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Each skill directory under `root`, as a path relative to it. A skill is not
 * descended, and a symlink is never descended — which is what ends a symlink loop. */
async function skillDirsUnder(root: string, relative = "", depth = 1): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  const entries = await readdir(join(root, relative), { withFileTypes: true }).catch(() => []);
  const found = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
      const entryPath = join(relative, entry.name);
      if (!entry.isDirectory() && !entry.isSymbolicLink()) return [];
      if (await exists(join(root, entryPath, SKILL_FILE))) return [entryPath];
      return entry.isDirectory() ? skillDirsUnder(root, entryPath, depth + 1) : [];
    }),
  );
  return found.flat();
}

// pi prefers a frontmatter `name` over the directory name, but enumeration reads
// names only, so a skill whose declared name differs is offered by directory name.
const skillName = (relative: string): string => `skill:${basename(relative)}`;

async function skillsUnder(root: PiSkillRoot): Promise<Array<{ name: string; relative: string }>> {
  const dirs = await skillDirsUnder(root.dir);
  return dirs
    .map((relative) => ({ name: skillName(relative), relative }))
    .sort((a, b) => compareCodeUnits(a.name, b.name));
}

/** Every skill under `roots`, roots in order, each sorted by name; a name repeated
 * within one origin is listed once, first wins. */
export async function readPiSkills(roots: readonly PiSkillRoot[]): Promise<SkillRef[]> {
  const perRoot = await Promise.all(
    roots.map(async (root) =>
      (await skillsUnder(root)).map(({ name }): SkillRef => ({ name, origin: root.origin })),
    ),
  );
  const seen = new Set<string>();
  return perRoot.flat().filter(({ name, origin }) => {
    const key = `${origin}:${name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One skill's frontmatter `description`, from the first root of its origin that
 * lists it — null when none does. */
export async function readPiSkillDescription(
  roots: readonly PiSkillRoot[],
  skill: SkillRef,
): Promise<string | null> {
  for (const root of roots.filter((r) => r.origin === skill.origin)) {
    const hit = (await skillsUnder(root)).find((s) => s.name === skill.name);
    if (hit !== undefined) return readDescriptionUnder(root.dir, join(hit.relative, SKILL_FILE));
  }
  return null;
}
