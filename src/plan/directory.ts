// Lists ONE level of a directory a plan referenced, for the folder preview's
// lazy expansion (EXC-917). Depth comes from the reader expanding, never from a
// recursive walk here: a plan is entitled to cite `node_modules/`, and one level
// of it is already thousands of entries.
//
// Containment is not re-decided here. Both the referenced root and the level
// being asked for go through `resolveInCwd` (@/plan/excerpt.ts), so a `../`
// escape, an absolute path, and a symlinked directory whose target leaves the
// review's cwd are refused by exactly the code that refuses them for the file
// routes. What this module adds on top is the descent guard: a level must sit
// under the referenced root and no more than MAX_DIR_DEPTH below it, so a client
// that keeps asking for the next level down eventually hits a floor.

import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { relative, sep } from "node:path";

import type { DirEntry, DirListing } from "@/lib/types.ts";
import { resolveInCwd, SKIP_DIRS } from "@/plan/excerpt.ts";

/** Entries returned for one level. A wider level is truncated to this, with the
 * true count reported separately so the UI can say how many it elided. */
export const MAX_DIR_ENTRIES = 500;

/** How far below the referenced root a level may sit. A guard rail on the
 * client's descent, not a property of any real tree. */
export const MAX_DIR_DEPTH = 10;

// Directories first, then by name — what a tree wants, and what makes the cap
// deterministic rather than a slice of whatever order readdir happened to give.
// Compared by code point rather than locale so the cut is the same everywhere.
function byKindThenName(a: DirEntry, b: DirEntry): number {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function toEntry(dirent: Dirent): DirEntry {
  if (!dirent.isDirectory()) return { name: dirent.name, kind: "file" };
  const skipped = SKIP_DIRS.has(dirent.name) || dirent.name.startsWith(".");
  return skipped
    ? { name: dirent.name, kind: "directory", skipped: true }
    : { name: dirent.name, kind: "directory" };
}

/**
 * One level of `path` — defaulting to `root` itself — as `DirEntry` rows, where
 * `root` is the directory the plan referenced and both are resolved against the
 * review's `cwd`. Returns null when either fails to resolve to a real contained
 * directory, when `path` is not under `root`, or when it sits more than
 * `MAX_DIR_DEPTH` levels below it. Never throws.
 *
 * The single null answer is deliberate: the route turns it into one 404, so a
 * caller can't tell an escape from a miss.
 */
export async function listDirectory(
  cwd: string,
  root: string,
  path?: string,
): Promise<DirListing | null> {
  const rootHit = await resolveInCwd(cwd, root);
  if (rootHit === null || rootHit.kind !== "directory") return null;

  const target = path === undefined || path === "" ? rootHit : await resolveInCwd(cwd, path);
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

  // Only files and directories become rows. A symlink dirent reports as neither
  // (withFileTypes describes the link, not its target), so links, sockets and
  // devices are dropped rather than reported as some third kind — the same
  // refusal `resolveInCwd` makes. `total` counts what survives that filter, so
  // `total - entries.length` is exactly what the cap elided.
  const entries = dirents.filter((d) => d.isFile() || d.isDirectory()).map(toEntry);
  entries.sort(byKindThenName);

  const cwdReal = await realpath(cwd).catch(() => cwd);
  return {
    path: relative(cwdReal, target.path),
    entries: entries.slice(0, MAX_DIR_ENTRIES),
    total: entries.length,
  };
}
