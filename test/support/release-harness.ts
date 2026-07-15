// The release pipeline's in-memory test harness: builds a `Deps` whose git, gh,
// fs, and clock collaborators are fakes typed against their real
// interfaces, so each baseline/compute/prepare/finalize step runs with no live
// repo and no network. Every mutating call is recorded into `calls` so a test can
// assert exactly what would (or would not) run. It lives in test/support/ (not a
// *.test.ts file) so bun test never collects it as a suite; release-steps.test.ts
// and the per-step test files consume it.
import type { GitOps, RawCommit } from "../../scripts/tasks/release/git.ts";
import type { GitHubOps, PullRequestSummary } from "../../scripts/tasks/release/github.ts";
import type { NpmOps } from "../../scripts/tasks/release/npm.ts";
import type { Deps, FsOps } from "../../scripts/tasks/release/steps.ts";

/** A package.json / plugin.json body carrying just the version field tests assert on. */
export const pkg = (v: string) => `{\n  "name": "caret",\n  "version": "${v}"\n}\n`;
/** A marketplace.json body whose single plugin entry carries the version. */
export const market = (v: string) =>
  `{\n  "plugins": [\n    {\n      "version": "${v}"\n    }\n  ]\n}\n`;

/** A synthetic, fully-formed changelog with one released section the steps parse. */
export const CHANGELOG = `# Changelog

## [Unreleased]

## [0.1.0] - 2026-06-02 - The Foundations Release

### Added

- A thing.

[Unreleased]: https://github.com/macintacos/caret/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/macintacos/caret/compare/v0.0.1...v0.1.0
`;

/** A one-commit history the compute step parses for issue/PR refs. */
export const COMMITS: RawCommit[] = [
  { sha: "a".repeat(40), shortSha: "aaaaaaa", subject: "EXC-1 Did a thing (#2)" },
];

/** Controls for the git fake — repo state and ref/tag/branch existence. */
export interface GitOptions {
  branch?: string;
  porcelain?: string[];
  latestTag?: string | null;
  tags?: string[];
  remoteTags?: string[];
  localBranches?: string[];
  remoteBranches?: string[];
  refs?: Record<string, string>;
  filesAtRef?: Record<string, string>;
  commits?: RawCommit[];
  /** Drives `isAncestor`; defaults true (fast-forwardable). Set false to drive BRANCH_DIVERGED. */
  ancestor?: boolean;
}

/** Controls for the gh fake — availability and PR/release fixtures. */
export interface GitHubOptions {
  prs?: PullRequestSummary[];
  releases?: Record<string, { url: string }>;
  available?: boolean;
}

/** Controls for the npm fake — which versions are already on the registry. */
export interface NpmOptions {
  npmPublishedVersions?: string[];
}

/** Controls for the working-tree and clock seams. */
export interface IoOptions {
  files?: Record<string, string>;
  now?: string;
}

export type HarnessOptions = GitOptions & GitHubOptions & NpmOptions & IoOptions;

/** The fake git/fs mutable world a harness exposes for assertions. */
interface HarnessState {
  branch: string;
  head: string;
  root: string;
  porcelain: string[];
  latestTag: string | null;
  tags: Set<string>;
  remoteTags: Set<string>;
  localBranches: Set<string>;
  remoteBranches: Set<string>;
  refs: Map<string, string>;
  filesAtRef: Map<string, string>;
  commits: RawCommit[];
}

export interface ReleaseHarness {
  deps: Deps;
  calls: string[];
  files: Map<string, string>;
  state: HarnessState;
}

/** The default working tree: all three manifests synced at the baseline version. */
const defaultFiles = (): Record<string, string> => ({
  "package.json": pkg("0.0.1"),
  ".claude-plugin/plugin.json": pkg("0.0.1"),
  ".claude-plugin/marketplace.json": market("0.0.1"),
});

/**
 * Build a `Deps` backed by recording fakes plus the mutable `state`/`files` they
 * read and write. Each option group (`GitOptions`/`GitHubOptions`/`IoOptions`)
 * is optional, so a test states only what it cares about.
 */
export function makeReleaseHarness(opts: HarnessOptions = {}): ReleaseHarness {
  const calls: string[] = [];
  const state: HarnessState = {
    branch: opts.branch ?? "trunk",
    head: "headsha",
    root: "rootsha",
    porcelain: opts.porcelain ?? [],
    latestTag: opts.latestTag === undefined ? "v0.0.1" : opts.latestTag,
    tags: new Set(opts.tags ?? ["v0.0.1"]),
    remoteTags: new Set(opts.remoteTags ?? ["v0.0.1"]),
    localBranches: new Set(opts.localBranches ?? []),
    remoteBranches: new Set(opts.remoteBranches ?? []),
    refs: new Map(Object.entries(opts.refs ?? { "origin/trunk": "trunksha" })),
    filesAtRef: new Map(Object.entries(opts.filesAtRef ?? {})),
    commits: opts.commits ?? COMMITS,
  };

  const files = new Map(Object.entries(opts.files ?? defaultFiles()));

  const fs: FsOps = {
    async read(path) {
      const c = files.get(path);
      if (c === undefined) throw new Error(`ENOENT ${path}`);
      return c;
    },
    async write(path, contents) {
      files.set(path, contents);
      calls.push(`write:${path}`);
    },
    async exists(path) {
      return files.has(path);
    },
  };

  const git: GitOps = {
    async isRepo() {
      return true;
    },
    async currentBranch() {
      return state.branch;
    },
    async porcelainStatus() {
      return state.porcelain;
    },
    async headSha() {
      return state.head;
    },
    async rootCommit() {
      return state.root;
    },
    async latestVersionTag() {
      return state.latestTag;
    },
    async tryRevParse(ref) {
      return state.refs.get(ref) ?? null;
    },
    async commitsBetween() {
      return state.commits;
    },
    async tryFileAtRef(ref, path) {
      return state.filesAtRef.get(`${ref}:${path}`) ?? null;
    },
    async localBranchExists(b) {
      return state.localBranches.has(b);
    },
    async remoteBranchExists(b) {
      return state.remoteBranches.has(b);
    },
    async localTagExists(t) {
      return state.tags.has(t);
    },
    async remoteTagExists(t) {
      return state.remoteTags.has(t);
    },
    async isAncestor() {
      return opts.ancestor ?? true;
    },
    async fetch() {
      calls.push("fetch");
    },
    async checkoutNewBranch(b) {
      calls.push(`checkoutNew:${b}`);
      state.branch = b;
      state.localBranches.add(b);
    },
    async checkoutExistingBranch(b) {
      calls.push(`checkout:${b}`);
      state.branch = b;
    },
    async stage(paths) {
      calls.push(`stage:${paths.join(",")}`);
    },
    async commit(message) {
      calls.push(`commit:${message.split("\n")[0]}`);
      state.porcelain = [];
    },
    async pushBranch(b, up) {
      calls.push(`pushBranch:${b}:${up}`);
      state.remoteBranches.add(b);
    },
    async createAnnotatedTag(tag, sha) {
      calls.push(`createTag:${tag}@${sha}`);
      state.tags.add(tag);
      state.refs.set(tag, sha);
    },
    async pushTag(tag) {
      calls.push(`pushTag:${tag}`);
      state.remoteTags.add(tag);
    },
  };

  const prs = opts.prs ?? [];
  const releases = new Map(Object.entries(opts.releases ?? {}));
  const github: GitHubOps = {
    async available() {
      return opts.available ?? true;
    },
    async repoSlug() {
      return "macintacos/caret";
    },
    async defaultBranch() {
      return "trunk";
    },
    async prCreate() {
      calls.push("prCreate");
      const url = "https://github.com/macintacos/caret/pull/9";
      prs.push({ number: 9, url, state: "OPEN" });
      return { number: 9, url };
    },
    async prList() {
      return prs;
    },
    async releaseView(tag) {
      return releases.get(tag) ?? null;
    },
    async releaseCreate({ tag }) {
      calls.push(`releaseCreate:${tag}`);
      const url = `https://github.com/macintacos/caret/releases/tag/${tag}`;
      releases.set(tag, { url });
      return { url };
    },
  };

  const npmPublishedVersions = new Set(opts.npmPublishedVersions ?? []);
  const npm: NpmOps = {
    async isVersionPublished(version) {
      return npmPublishedVersions.has(version);
    },
    async publish() {
      calls.push("npmPublish");
    },
  };

  const deps: Deps = {
    git,
    github,
    npm,
    fs,
    io: { log: () => {} },
    now: () => new Date(opts.now ?? "2026-06-02T00:00:00Z"),
  };
  return { deps, calls, files, state };
}
