// Read-only smoke test for the real git.ts shell-outs against this worktree.
// Mutating ops (commit/tag/push) are covered by the injected-fake steps tests,
// not here — this only proves the read commands parse correctly.
import { expect, test } from "bun:test";

import { createGit, splitPorcelain } from "@/tasks/release/git.ts";

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
  expect(pkg).toContain('"name": "@macintacos/caret"');
  expect(await git.tryFileAtRef("HEAD", "does/not/exist.txt")).toBeNull();
});

test("tryFileAtRef returns null at an unresolvable ref", async () => {
  // The `git show` shell-out exits non-zero when the ref itself is missing.
  expect(await git.tryFileAtRef("no-such-ref-xyz", "package.json")).toBeNull();
});

test("latestVersionTag returns a v-prefixed semver tag", async () => {
  // The worktree carries real release tags; the highest sorts first.
  const tag = await git.latestVersionTag();
  expect(tag).toMatch(/^v\d+\.\d+\.\d+$/);
});

test("commitsBetween yields an empty array for an empty range", async () => {
  // `git log HEAD..HEAD` prints nothing; the empty-output branch returns [].
  expect(await git.commitsBetween("HEAD..HEAD")).toEqual([]);
});

test("tryRevParse dereferences a tag to its commit via the ^{commit} peel", async () => {
  // finalize peels the local tag to compare against trunk's HEAD; the peel must
  // resolve to a real 40-char commit SHA, not the (annotated) tag object SHA.
  const sha = await git.tryRevParse("v0.0.1^{commit}");
  expect(sha).toMatch(SHA);
});

test("localTagExists is true for a real tag, false for a missing one", async () => {
  // `git rev-parse --verify --quiet refs/tags/<tag>` branches on its exit code.
  expect(await git.localTagExists("v0.0.1")).toBe(true);
  expect(await git.localTagExists("v999.999.999")).toBe(false);
});

test("localBranchExists is false for a missing branch", async () => {
  // The non-zero exit of the rev-parse verify maps to false, never a throw.
  expect(await git.localBranchExists("no-such-branch-xyz")).toBe(false);
});

test("isAncestor reports the merge-base relationship", async () => {
  // A commit is its own ancestor; a fabricated SHA is not (git exits non-zero).
  const head = await git.headSha();
  expect(await git.isAncestor(head, head)).toBe(true);
  expect(await git.isAncestor("0".repeat(40), head)).toBe(false);
});
