import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_SEARCH_QUERY_CHARS, SEARCH_BUDGET, searchFiles } from "@/plan/file-search.ts";

// The tree-wide file search behind the feedback editors' `@` completion
// (EXC-1175): which files under a review's cwd a typed query matches, in what
// order, and where the walk stops. Everything here is the module's own — the
// matching, the ordering, the two caps, and the containment the walk gets by
// construction. The route wrapper's claims (status codes, wire body, log
// records) live in test/core/daemon/file-search.test.ts.

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "caret-search-cwd-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function write(rel: string, content = "x"): void {
  const abs = join(cwd, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

test("an empty query offers every file, shallowest first", async () => {
  write("readme.md");
  write("src/app.ts");
  write("src/lib/util.ts");
  expect(await searchFiles(cwd, "")).toEqual({
    paths: ["readme.md", "src/app.ts", "src/lib/util.ts"],
    stoppedAt: null,
  });
});

test("a level's files are offered in name order, so the caps cut deterministically", async () => {
  write("zebra.ts");
  write("apple.ts");
  write("middle.ts");
  expect((await searchFiles(cwd, ""))?.paths).toEqual(["apple.ts", "middle.ts", "zebra.ts"]);
});

test("a query matches by subsequence over the whole cwd-relative path", async () => {
  write("src/lib/foo.ts");
  write("src/lib/bar.ts");
  expect((await searchFiles(cwd, "srlbfoo"))?.paths).toEqual(["src/lib/foo.ts"]);
});

test("a subsequence query matches where a prefix query could not", async () => {
  write("src/lib/foo.ts");
  // "oo" appears nowhere at the start of the path or of any of its segments.
  expect((await searchFiles(cwd, "oo"))?.paths).toEqual(["src/lib/foo.ts"]);
});

test("matching folds case in both directions", async () => {
  write("src/ReadMe.md");
  expect((await searchFiles(cwd, "readme"))?.paths).toEqual(["src/ReadMe.md"]);
  expect((await searchFiles(cwd, "SRCREADME"))?.paths).toEqual(["src/ReadMe.md"]);
});

test("a query whose characters are out of order matches nothing", async () => {
  write("src/lib/foo.ts");
  expect(await searchFiles(cwd, "foosrc")).toEqual({ paths: [], stoppedAt: null });
});

test("the skip set and dotted directories are never descended", async () => {
  write("node_modules/pkg/index.ts");
  write("dist/bundle.ts");
  write("build/out.ts");
  write("coverage/report.ts");
  write("out/thing.ts");
  write(".git/HEAD.ts");
  write("keep.ts");
  expect((await searchFiles(cwd, ""))?.paths).toEqual(["keep.ts"]);
});

test("a dotted file is still offered — only dotted directories are skipped", async () => {
  write(".gitignore");
  expect((await searchFiles(cwd, "gitignore"))?.paths).toEqual([".gitignore"]);
});

test("a worktree's .git file is skipped, so both checkout layouts offer the same list", async () => {
  // In a linked worktree `.git` is a FILE pointing at the common dir, so the
  // dotted-DIRECTORY rule above misses it and it would sit second in the list
  // of every bare `@`. Nobody cites it either way.
  write(".git", "gitdir: /elsewhere/.bare/worktrees/x\n");
  write(".gitignore");
  expect((await searchFiles(cwd, ""))?.paths).toEqual([".gitignore"]);
});

test("a symlink is never a row, so nothing outside the cwd can be offered", async () => {
  const outside = mkdtempSync(join(tmpdir(), "caret-search-outside-"));
  try {
    writeFileSync(join(outside, "secret.ts"), "x");
    write("real.ts");
    symlinkSync(join(outside, "secret.ts"), join(cwd, "to-secret.ts"));
    symlinkSync(outside, join(cwd, "to-outside"));
    symlinkSync(join(cwd, "real.ts"), join(cwd, "to-real.ts"));
    // The walk is rooted at the cwd's realpath and reads dirent kinds without
    // following links, so an escape is refused by construction rather than by a
    // per-result check — and a link pointing back INSIDE is refused too, which
    // is the price of that stronger guarantee.
    expect((await searchFiles(cwd, ""))?.paths).toEqual(["real.ts"]);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("the result cap truncates and says so", async () => {
  for (let i = 0; i < SEARCH_BUDGET.results + 7; i++) {
    write(`f${String(i).padStart(4, "0")}.ts`);
  }
  const found = await searchFiles(cwd, "");
  expect(found?.paths).toHaveLength(SEARCH_BUDGET.results);
  expect(found?.stoppedAt).toBe("results");
  // The cap keeps the ordering's head, so the reader sees the list's start.
  expect(found?.paths[0]).toBe("f0000.ts");
});

test("a result set exactly at the cap is not reported as stopped", async () => {
  for (let i = 0; i < SEARCH_BUDGET.results; i++) write(`f${String(i).padStart(4, "0")}.ts`);
  expect((await searchFiles(cwd, ""))?.stoppedAt).toBeNull();
});

test("the dirent budget stops a walk that would otherwise sweep the tree", async () => {
  for (let i = 0; i < 20; i++) write(`d${String(i).padStart(2, "0")}/leaf.ts`);
  // A query matching nothing is the expensive case the budget exists for: it
  // cannot stop early on results, so only the scan bound ends it.
  const found = await searchFiles(cwd, "zzzz", { dirents: 5, results: 50 });
  expect(found).toEqual({ paths: [], stoppedAt: "scan" });
});

test("a walk inside the dirent budget is not reported as stopped", async () => {
  write("only.ts");
  expect((await searchFiles(cwd, "zzzz", { dirents: 5, results: 50 }))?.stoppedAt).toBeNull();
});

test("a query longer than the cap is cut rather than matched in full", async () => {
  // Exactly as many 'a's as the cap allows, so the cut is what decides the
  // answer: the capped query matches this path and the raw one is too long to.
  const name = `${"a".repeat(MAX_SEARCH_QUERY_CHARS)}.ts`;
  write(name);
  expect((await searchFiles(cwd, "a".repeat(MAX_SEARCH_QUERY_CHARS + 50)))?.paths).toEqual([name]);
});

test("a cwd that is not an absolute real directory yields null", async () => {
  expect(await searchFiles("", "")).toBeNull();
  expect(await searchFiles("relative/path", "")).toBeNull();
  expect(await searchFiles(join(cwd, "ghost"), "")).toBeNull();
});
