// Thin git shell-outs behind the GitOps interface. Each method is one git
// command. The interface exists so the orchestration in steps.ts can be driven
// by fakes in tests without a live repository; createGit() is the real,
// Bun.$-backed implementation used by the CLI. Bun.$ shell-escapes every
// interpolated value, so branch names / tags / messages are injection-safe.

import { $ } from "bun";

/** A commit as read from `git log`, before metadata parsing. */
export interface RawCommit {
  sha: string;
  shortSha: string;
  subject: string;
}

export interface GitOps {
  isRepo(): Promise<boolean>;
  /** Current branch, or "HEAD" when detached. */
  currentBranch(): Promise<string>;
  /** Porcelain status lines; empty array means a clean tree. */
  porcelainStatus(): Promise<string[]>;
  headSha(): Promise<string>;
  /** The repository's earliest root commit (for the v0.0.1 baseline tag). */
  rootCommit(): Promise<string>;
  /** Highest `vX.Y.Z` tag by semver order, or null if there are none. */
  latestVersionTag(): Promise<string | null>;
  /** Resolve a ref to a SHA, or null if it does not exist. */
  tryRevParse(ref: string): Promise<string | null>;
  commitsBetween(range: string): Promise<RawCommit[]>;
  /** File contents at a ref (`git show ref:path`), or null if absent. */
  tryFileAtRef(ref: string, path: string): Promise<string | null>;
  localBranchExists(branch: string): Promise<boolean>;
  remoteBranchExists(branch: string): Promise<boolean>;
  localTagExists(tag: string): Promise<boolean>;
  remoteTagExists(tag: string): Promise<boolean>;
  /** Whether `ancestor` is an ancestor of `descendant` (fast-forward check). */
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;
  fetch(): Promise<void>;
  checkoutNewBranch(branch: string): Promise<void>;
  checkoutExistingBranch(branch: string): Promise<void>;
  stage(paths: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  pushBranch(branch: string, setUpstream: boolean): Promise<void>;
  createAnnotatedTag(tag: string, sha: string, message: string): Promise<void>;
  pushTag(tag: string): Promise<void>;
}

const FIELD = "\x1f"; // unit separator: safe field delimiter for `git log`

/**
 * Split `git status --porcelain` output into lines, preserving each line's
 * two-char `XY ` status prefix. Trimming the whole blob would strip the leading
 * space off a worktree-only change (` M path`), shifting the path left so a
 * downstream `slice(3)` eats its first character — turning `CHANGELOG.md` into
 * `HANGELOG.md` and tripping a false DIRTY_TREE.
 */
export function splitPorcelain(out: string): string[] {
  return out.split("\n").filter((line) => line !== "");
}

/** Constructs the real, git-backed GitOps for a given remote (default origin). */
export function createGit(remote = "origin"): GitOps {
  return {
    async isRepo() {
      const r = await $`git rev-parse --is-inside-work-tree`.nothrow().quiet();
      return r.exitCode === 0;
    },

    async currentBranch() {
      return (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
    },

    async porcelainStatus() {
      return splitPorcelain(await $`git status --porcelain`.text());
    },

    async headSha() {
      return (await $`git rev-parse HEAD`.text()).trim();
    },

    async rootCommit() {
      const out = (await $`git rev-list --max-parents=0 HEAD`.text()).trim();
      const lines = out.split("\n").filter((l) => l !== "");
      const earliest = lines[lines.length - 1];
      if (earliest === undefined) throw new Error("repository has no commits");
      return earliest;
    },

    async latestVersionTag() {
      // Interpolate the glob so Bun.$ passes it literally to git instead of
      // glob-expanding it against the cwd (which errors when nothing matches).
      const pattern = "v*.*.*";
      const out = (await $`git tag --list ${pattern} --sort=-v:refname`.text()).trim();
      if (out === "") return null;
      return out.split("\n")[0] ?? null;
    },

    async tryRevParse(ref) {
      const r = await $`git rev-parse --verify --quiet ${ref}`.nothrow().quiet();
      if (r.exitCode !== 0) return null;
      return r.text().trim();
    },

    async commitsBetween(range) {
      const fmt = `%H${FIELD}%h${FIELD}%s`;
      const out = (await $`git log --format=${fmt} ${range}`.text()).trim();
      if (out === "") return [];
      return out.split("\n").map((line) => {
        const parts = line.split(FIELD);
        return {
          sha: parts[0] ?? "",
          shortSha: parts[1] ?? "",
          // Re-join in case a subject itself contains the separator byte.
          subject: parts.slice(2).join(FIELD),
        };
      });
    },

    async tryFileAtRef(ref, path) {
      const r = await $`git show ${`${ref}:${path}`}`.nothrow().quiet();
      if (r.exitCode !== 0) return null;
      return r.text();
    },

    async localBranchExists(branch) {
      const r = await $`git rev-parse --verify --quiet ${`refs/heads/${branch}`}`.nothrow().quiet();
      return r.exitCode === 0;
    },

    async remoteBranchExists(branch) {
      const out = (await $`git ls-remote --heads ${remote} ${branch}`.text()).trim();
      return out !== "";
    },

    async localTagExists(tag) {
      const r = await $`git rev-parse --verify --quiet ${`refs/tags/${tag}`}`.nothrow().quiet();
      return r.exitCode === 0;
    },

    async remoteTagExists(tag) {
      const out = (await $`git ls-remote --tags ${remote} ${tag}`.text()).trim();
      return out !== "";
    },

    async isAncestor(ancestor, descendant) {
      const r = await $`git merge-base --is-ancestor ${ancestor} ${descendant}`.nothrow().quiet();
      return r.exitCode === 0;
    },

    async fetch() {
      await $`git fetch ${remote} --tags`.quiet();
    },

    async checkoutNewBranch(branch) {
      await $`git checkout -b ${branch}`.quiet();
    },

    async checkoutExistingBranch(branch) {
      await $`git checkout ${branch}`.quiet();
    },

    async stage(paths) {
      await $`git add ${paths}`.quiet();
    },

    async commit(message) {
      // Bun.$ shell-escapes the message into a single argv, so multi-paragraph
      // messages with backticks pass through `-m` safely.
      await $`git commit -m ${message}`.quiet();
    },

    async pushBranch(branch, setUpstream) {
      if (setUpstream) await $`git push -u ${remote} ${branch}`.quiet();
      else await $`git push ${remote} ${branch}`.quiet();
    },

    async createAnnotatedTag(tag, sha, message) {
      await $`git tag -a ${tag} ${sha} -m ${message}`.quiet();
    },

    async pushTag(tag) {
      await $`git push ${remote} ${tag}`.quiet();
    },
  };
}
