// Lists ONE level of a directory a plan referenced, for the folder preview's
// lazy expansion (EXC-917). Depth comes from the reader expanding, never from a
// recursive walk here: a plan is entitled to cite `node_modules/`, and one level
// of it is already thousands of entries.
//
// Containment is not re-decided here. The referenced root, the level being asked
// for, and every symlinked entry all go through `resolveInCwd`
// (@/plan/excerpt.ts), so a `../` escape, an absolute path, and a symlink whose
// target leaves the review's cwd are refused by exactly the code that refuses
// them for the file routes.

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import type { DirEntry, DirListing, FileRefKind } from "@/lib/types.ts";
import { resolveInCwd, SKIP_DIRS, safeRealpath } from "@/plan/excerpt.ts";

/** Entries returned for one level. A wider level is truncated to this, with the
 * true count reported separately so the UI can say how many it elided. */
export const MAX_DIR_ENTRIES = 500;

/** How far below the referenced root one level may sit — a cap on a single
 * expansion chain, not a property of any real tree. It counts from the caller's own
 * unverified `root`, so re-anchoring deeper restarts the count: a guard rail against a
 * runaway expansion, never a confidentiality boundary (containment in `cwd` is that). */
export const MAX_DIR_DEPTH = 10;

// Directories first, then by name — what a tree wants, and what makes the cap
// deterministic rather than a slice of whatever order readdir happened to give.
// Compared by code point rather than locale so the cut is the same everywhere.
function byKindThenName(a: DirEntry, b: DirEntry): number {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

// A dotted name joins the skip set for the same reason `basenameSearch` refuses
// it: `.git`/`.venv`-shaped trees are large and never what a plan means to show.
// The mark is advisory — see `DirEntry.skipped`.
function entryFor(name: string, kind: FileRefKind): DirEntry {
  if (kind === "file") return { name, kind };
  return SKIP_DIRS.has(name) || name.startsWith(".")
    ? { name, kind, skipped: true }
    : { name, kind };
}

/**
 * One level of `path` — or of `root` itself when `path` is empty — as `DirEntry`
 * rows, where `root` is the directory the plan referenced and both are resolved
 * against the review's `cwd`. Returns null when either fails to resolve to a real
 * contained directory, when `path` is not under `root`, or when it sits more than
 * `MAX_DIR_DEPTH` levels below it. Never throws.
 *
 * The single null answer is deliberate: the route turns it into one 404, so a
 * caller can't tell an escape from a miss.
 */
export async function listDirectory(
  cwd: string,
  root: string,
  path: string,
): Promise<DirListing | null> {
  const rootHit = await resolveInCwd(cwd, root);
  if (rootHit === null || rootHit.kind !== "directory") return null;

  const target = path === "" ? rootHit : await resolveInCwd(cwd, path);
  if (target === null || target.kind !== "directory") return null;

  // Both paths are canonical by now, so this is pure arithmetic on real paths —
  // no further filesystem question to get wrong.
  const rel = relative(rootHit.path, target.path);
  if (rel === ".." || rel.startsWith(`..${sep}`)) return null;
  if (rel !== "" && rel.split(sep).length > MAX_DIR_DEPTH) return null;

  let dirents: Dirent[];
  try {
    dirents = await readdir(target.path, { withFileTypes: true });
  } catch {
    return null;
  }

  // A symlink dirent describes the link, not its target, so its kind is the
  // target's — decided by the same resolver the routes use, which is what keeps
  // a link pointing out of cwd from becoming a row. Resolved together rather
  // than in sequence, since each costs a realpath.
  const entries: DirEntry[] = [];
  const links: Dirent[] = [];
  for (const d of dirents) {
    if (d.isFile()) entries.push(entryFor(d.name, "file"));
    else if (d.isDirectory()) entries.push(entryFor(d.name, "directory"));
    else if (d.isSymbolicLink()) links.push(d);
  }
  const targets = await Promise.all(links.map((d) => resolveInCwd(cwd, join(target.path, d.name))));
  targets.forEach((hit, i) => {
    const link = links[i];
    if (hit !== null && link !== undefined) entries.push(entryFor(link.name, hit.kind));
  });
  entries.sort(byKindThenName);

  // `total` counts the rows this level has, before the cap — so
  // `total - entries.length` is exactly what the cap elided.
  const cwdReal = (await safeRealpath(cwd)) ?? cwd;
  return {
    path: relative(cwdReal, target.path),
    entries: entries.slice(0, MAX_DIR_ENTRIES),
    total: entries.length,
  };
}
