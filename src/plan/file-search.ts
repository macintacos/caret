// Tree-wide file search under a review's cwd, for the `@` completion the
// feedback editors offer (EXC-1175). The browser can't touch the filesystem, so
// the daemon walks it — and only path strings ever come back, never a byte of
// file content.
//
// The walk is `basenameSearch`'s (@/plan/excerpt.ts), which is the closest thing
// the codebase already had: breadth-first from the review's cwd, refusing the
// skip set and dotted directories, and reading dirent kinds WITHOUT following
// symlinks. The one difference is what it does with a hit — that one stops at
// the first exact name, this collects matches to a cap.
//
// Containment is therefore not re-decided per result the way `listDirectory`
// re-decides it through `resolveInCwd`. It does not need to be: the walk is
// rooted at the cwd's own realpath and never follows a link, so every path it
// can produce is a real descendant. That is strictly stronger than checking each
// result afterwards, and it is why a symlink is not a row at all — including one
// pointing back inside the tree, which is the price of the stronger guarantee.

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type { FileSearchResponse } from "@/lib/types.ts";
import { SKIP_DIRS, safeRealpath } from "@/plan/excerpt.ts";

/** How much work one search may do. Injectable so the caps are exercisable
 * without writing twenty thousand files; production passes nothing and gets
 * `SEARCH_BUDGET`. */
export interface SearchBudget {
  /** Dirents the walk may read before it gives up. */
  dirents: number;
  /** Paths one search may return. */
  results: number;
}

/**
 * The production budget.
 *
 * `results` is a completion list nobody scrolls past, so a larger number would
 * only cost the browser rows it never paints. `dirents` is what bounds the
 * expensive case — a query matching nothing cannot stop early on results, so
 * only this ends it. It is deliberately far above `basenameSearch`'s own
 * MAX_SCAN_ENTRIES: that one resolves a single known name and can afford to give
 * up, whereas a completion list that gave up after 5000 dirents would report
 * itself truncated on any repository worth completing in.
 *
 * ponytail: a fresh walk per query, not a cached index. A query is one
 * debounced keystroke against a warm page cache on loopback, and the alternative
 * is an index plus its invalidation. Cache the walk per review if a monorepo
 * ever makes the list feel slow.
 */
export const SEARCH_BUDGET: SearchBudget = { dirents: 20_000, results: 50 };

/** Query characters the search reads. The body is untrusted, so the matcher is
 * never handed an unbounded string; past this a query is cut rather than
 * rejected, keeping the route's degrade-don't-reject posture. */
export const MAX_SEARCH_QUERY_CHARS = 128;

// Whether every character of `needle` appears in `haystack` in order — the
// subsequence match that lets `srlbfoo` find `src/lib/foo.ts`. Both sides
// arrive lowercased. Compared by code unit on both sides rather than by code
// point, so a surrogate pair matches as its two units in order and no
// per-candidate array allocation is needed.
function subsequence(haystack: string, needle: string): boolean {
  let i = 0;
  for (let h = 0; h < haystack.length && i < needle.length; h++) {
    if (haystack[h] === needle[i]) i++;
  }
  return i === needle.length;
}

const GIT_DIR = ".git";

const under = (dir: string, name: string): string => (dir === "" ? name : `${dir}/${name}`);

/**
 * The files under `cwd` whose cwd-relative path subsequence-matches `query`,
 * shallowest first and in name order within a level — so the caps cut a
 * deterministic list rather than a slice of whatever order readdir gave.
 *
 * An empty query matches every file, which is what makes a bare `@` open a list.
 * Returns null when `cwd` is not an absolute path that resolves, so the route
 * can answer that with one 404 the way the directory listing does. Never throws.
 */
export async function searchFiles(
  cwd: string,
  query: string,
  budget: SearchBudget = SEARCH_BUDGET,
): Promise<FileSearchResponse | null> {
  if (cwd === "" || !isAbsolute(cwd)) return null;
  const cwdReal = await safeRealpath(cwd);
  if (cwdReal === null) return null;

  const needle = query.slice(0, MAX_SEARCH_QUERY_CHARS).toLowerCase();
  const paths: string[] = [];
  const queue: string[] = [""]; // cwd-relative directories, "" being the cwd
  let scanned = 0;
  let truncated = false;
  let done = false;

  while (queue.length > 0 && !done) {
    const rel = queue.shift() as string;
    let dirents: Dirent[];
    try {
      dirents = await readdir(join(cwdReal, rel), { withFileTypes: true });
    } catch {
      continue;
    }

    const files: string[] = [];
    const dirs: string[] = [];
    for (const entry of dirents) {
      if (++scanned > budget.dirents) {
        truncated = true;
        done = true;
        break;
      }
      // By name rather than by kind, because `.git` has two of them: a directory
      // in a plain checkout, which the dotted rule below already refuses, and a
      // FILE in a linked worktree, which it does not. Skipping the name makes
      // the two layouts offer the same list.
      if (entry.name === GIT_DIR) continue;
      if (entry.isFile()) files.push(entry.name);
      else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        dirs.push(entry.name);
      }
    }
    // A level the budget cut off is abandoned whole: its matches would be a
    // partial answer from a walk that already gave up.
    if (done) break;

    files.sort();
    for (const name of files) {
      const path = under(rel, name);
      if (!subsequence(path.toLowerCase(), needle)) continue;
      // The cap trips on the match that would exceed it, so a result set landing
      // exactly on the cap is complete rather than truncated.
      if (paths.length === budget.results) {
        truncated = true;
        done = true;
        break;
      }
      paths.push(path);
    }
    if (done) break;

    dirs.sort();
    for (const name of dirs) queue.push(under(rel, name));
  }

  return { paths, truncated };
}
