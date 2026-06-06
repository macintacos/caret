// Read-only smoke test for the real git.ts shell-outs against this worktree.
// Mutating ops (commit/tag/push) are covered by the injected-fake steps tests,
// not here — this only proves the read commands parse correctly.
import { expect, test } from "bun:test";
import { createGit, splitPorcelain } from "../scripts/release/git.ts";

const git = createGit();
const SHA = /^[0-9a-f]{40}$/;

test("isRepo is true inside the worktree", async () => {
  expect(await git.isRepo()).toBe(true);
});

test("currentBranch returns a non-empty branch name", async () => {
  expect((await git.currentBranch()).length).toBeGreaterThan(0);
});

test("headSha and rootCommit are full SHAs", async () => {
  expect(await git.headSha()).toMatch(SHA);
  expect(await git.rootCommit()).toMatch(SHA);
});

test("tryRevParse resolves HEAD and returns null for a missing ref", async () => {
  expect(await git.tryRevParse("HEAD")).toBe(await git.headSha());
  expect(await git.tryRevParse("no-such-ref-xyz")).toBeNull();
});

test("porcelainStatus returns an array", async () => {
  expect(Array.isArray(await git.porcelainStatus())).toBe(true);
});

test("splitPorcelain preserves a leading-space status prefix", () => {
  // A worktree-only modification prints " M path"; the leading space must
  // survive so a downstream slice(3) recovers the path intact.
  expect(splitPorcelain(" M CHANGELOG.md\n")).toEqual([" M CHANGELOG.md"]);
  expect(splitPorcelain("M  staged.ts\n D gone.ts\n")).toEqual(["M  staged.ts", " D gone.ts"]);
  expect(splitPorcelain("")).toEqual([]);
  expect(splitPorcelain("\n")).toEqual([]);
});

test("commitsBetween rootCommit..HEAD yields populated commits", async () => {
  const root = await git.rootCommit();
  const commits = await git.commitsBetween(`${root}..HEAD`);
  expect(commits.length).toBeGreaterThan(0);
  const first = commits[0];
  expect(first?.sha).toMatch(SHA);
  expect((first?.subject ?? "").length).toBeGreaterThan(0);
});

test("tryFileAtRef reads a committed file and null for an absent path", async () => {
  const pkg = await git.tryFileAtRef("HEAD", "package.json");
  expect(pkg).toContain('"name": "caret"');
  expect(await git.tryFileAtRef("HEAD", "does/not/exist.txt")).toBeNull();
});
