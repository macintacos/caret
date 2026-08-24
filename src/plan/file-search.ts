// Tree-wide file search under a review's cwd, for the `@` completion the
// feedback editors offer (EXC-1175). The browser can't touch the filesystem, so
// the daemon walks it — and only path strings ever come back, never a byte of
// file content.
//
// The walk is `basenameSearch`'s (@/plan/excerpt.ts), which is the closest thing
// the codebase already had: breadth-first from the review's cwd, refusing the
// skip set and dotted directories, and reading dirent kinds WITHOUT following
// symlinks. It differs in three places — what it does with a hit (that one stops
// at the first exact name, this collects to a cap), the per-level sort that makes
// the caps cut deterministically, and the `.git`-by-name skip below.
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
 * without writing twenty thousand files — which is also why the query-length cap
 * is a flat constant beside this rather than a third field: a long query costs
 * nothing to write in a test. */
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
 *
 * ponytail: matches are collected in walk order and cut at `results` — a
 * subsequence FILTER, not a ranked finder. Subsequence matching is permissive, so
 * a short query can fill the cap with shallow near-misses before reaching the
 * obvious answer: measured on caret's own tree, `apits` returns 50 and puts
 * `ui/src/lib/api.ts` at index 36, while every specific query tried (`filesearch`,
 * `server`, `caretheme`) lands its target in the first two rows. Rank before
 * slicing — basename hit first, then shortest path — if the short-query case
 * proves to matter; that is a scoring design of its own and belongs to EXC-390
 * rather than here.
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

/** A level-relative name as a cwd-relative path. `dir` is "" for the cwd itself,
 * where a naive join would produce a leading slash. */
function relPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

/** One directory's dirents split into what the walk does with them. */
interface Level {
  /** Candidate file names, sorted, so the caps cut the same list every time
   * rather than a slice of whatever order readdir happened to give. */
  files: string[];
  /** Subdirectory names to descend into, sorted for the same reason. */
  dirs: string[];
  /** Dirents actually read — what the caller charges against its budget. */
  scanned: number;
  /** True when `allowance` ran out mid-level, so `files` and `dirs` are partial. */
  cut: boolean;
}

/**
 * Split one level's dirents into candidate files and directories to descend,
 * reading at most `allowance` of them.
 *
 * Two refusals are by name rather than by kind, and both are deliberate:
 *
 * - `.git` comes in two kinds — a directory in a plain checkout, which the dotted
 *   rule already refuses, and a FILE in a linked worktree, which it does not.
 *   Refusing the name makes both layouts offer the same list.
 * - Anything that is neither a file nor a directory — a symlink above all — is
 *   simply not a candidate, which is what keeps the walk inside `cwd` without a
 *   per-result containment check.
 */
function partition(dirents: readonly Dirent[], allowance: number): Level {
  const files: string[] = [];
  const dirs: string[] = [];
  let scanned = 0;
  for (const entry of dirents) {
    if (scanned >= allowance) return { files, dirs, scanned, cut: true };
    scanned++;
    if (entry.name === ".git") continue;
    if (entry.isFile()) files.push(entry.name);
    else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
      dirs.push(entry.name);
    }
  }
  files.sort();
  dirs.sort();
  return { files, dirs, scanned, cut: false };
}

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

  while (queue.length > 0) {
    const rel = queue.shift() as string;
    let dirents: Dirent[];
    try {
      dirents = await readdir(join(cwdReal, rel), { withFileTypes: true });
    } catch {
      continue;
    }

    const level = partition(dirents, budget.dirents - scanned);
    scanned += level.scanned;
    // A level the budget cut off is abandoned whole: its matches would be a
    // partial answer from a walk that has already given up.
    if (level.cut) return { paths, stoppedAt: "scan" };

    for (const name of level.files) {
      const path = relPath(rel, name);
      if (!subsequence(path.toLowerCase(), needle)) continue;
      // The cap trips on the match that would exceed it, so a result set landing
      // exactly on the cap is complete rather than stopped.
      if (paths.length === budget.results) return { paths, stoppedAt: "results" };
      paths.push(path);
    }
    for (const name of level.dirs) queue.push(relPath(rel, name));
  }

  return { paths, stoppedAt: null };
}
