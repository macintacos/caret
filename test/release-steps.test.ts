// Drives the baseline/compute/prepare/finalize orchestration and its resume
// state machine through injected fakes — no live repo, no network. Each fake
// records mutating calls so we can assert exactly what would (or would not) run.
import { expect, test } from "bun:test";
import type { GitOps, RawCommit } from "../scripts/release/git.ts";
import type {
  GitHubOps,
  PullRequestSummary,
} from "../scripts/release/github.ts";
import {
  type Deps,
  type FsOps,
  GuardError,
  baseline,
  compute,
  finalize,
  prepare,
} from "../scripts/release/steps.ts";

const pkg = (v: string) => `{\n  "name": "caret",\n  "version": "${v}"\n}\n`;
const market = (v: string) =>
  `{\n  "plugins": [\n    {\n      "version": "${v}"\n    }\n  ]\n}\n`;

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.1.0] - 2026-06-02 - The Foundations Release

### Added

- A thing.

[Unreleased]: https://github.com/macintacos/caret/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/macintacos/caret/compare/v0.0.1...v0.1.0
`;

const COMMITS: RawCommit[] = [
  { sha: "a".repeat(40), shortSha: "aaaaaaa", subject: "EXC-1 Did a thing (#2)" },
];

interface Options {
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
  files?: Record<string, string>;
  prs?: PullRequestSummary[];
  releases?: Record<string, { url: string }>;
  preflightOk?: boolean;
  available?: boolean;
}

function harness(opts: Options = {}) {
  const calls: string[] = [];
  const state = {
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

  const files = new Map(
    Object.entries(
      opts.files ?? {
        "package.json": pkg("0.0.1"),
        ".claude-plugin/plugin.json": pkg("0.0.1"),
        ".claude-plugin/marketplace.json": market("0.0.1"),
      },
    ),
  );

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
    async listTags() {
      return [...state.tags];
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
      return true;
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
    async prCreate({ base }) {
      calls.push("prCreate");
      const url = "https://github.com/macintacos/caret/pull/9";
      prs.push({ number: 9, url, state: base ? "OPEN" : "OPEN" });
      return { number: 9, url };
    },
    async prList({ state: st }) {
      if (st === "all") return prs;
      return prs.filter((p) => p.state === st.toUpperCase());
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

  const deps: Deps = {
    git,
    github,
    fs,
    io: { log: () => {} },
    preflight: async () => ({ ok: opts.preflightOk ?? true, output: "" }),
  };
  return { deps, calls, files, state };
}

async function expectGuard(p: Promise<unknown>, code: string) {
  try {
    await p;
    throw new Error(`expected GuardError ${code}, but it resolved`);
  } catch (e) {
    if (!(e instanceof GuardError)) throw e;
    expect(e.code).toBe(code);
  }
}

// --- compute ---------------------------------------------------------------

test("compute returns the next version, tag, and parsed commits", async () => {
  const { deps } = harness();
  const r = await compute(deps, { bump: "minor" });
  expect(r.ok).toBe(true);
  expect(r.currentVersion).toBe("0.0.1");
  expect(r.version).toBe("0.1.0");
  expect(r.tag).toBe("v0.1.0");
  expect(r.previousTag).toBe("v0.0.1");
  expect(r.releaseBranch).toBe("release/v0.1.0");
  expect(r.compareUrl).toBe(
    "https://github.com/macintacos/caret/compare/v0.0.1...v0.1.0",
  );
  expect(r.commits[0]?.issueRefs).toEqual(["EXC-1"]);
  expect(r.commits[0]?.prNumber).toBe(2);
});

test("compute rejects with NO_BASELINE when there are no tags", async () => {
  const { deps } = harness({ latestTag: null });
  await expectGuard(compute(deps, { bump: "patch" }), "NO_BASELINE");
});

test("compute rejects a dirty tree", async () => {
  const { deps } = harness({ porcelain: [" M src/x.ts"] });
  await expectGuard(compute(deps, { bump: "patch" }), "DIRTY_TREE");
});

test("compute rejects a non-default branch", async () => {
  const { deps } = harness({ branch: "feature/x" });
  await expectGuard(compute(deps, { bump: "patch" }), "WRONG_BRANCH");
});

test("compute rejects a detached HEAD", async () => {
  const { deps } = harness({ branch: "HEAD" });
  await expectGuard(compute(deps, { bump: "patch" }), "DETACHED_HEAD");
});

test("compute rejects manifest drift", async () => {
  const { deps } = harness({
    files: {
      "package.json": pkg("0.0.1"),
      ".claude-plugin/plugin.json": pkg("0.0.2"),
      ".claude-plugin/marketplace.json": market("0.0.1"),
    },
  });
  await expectGuard(compute(deps, { bump: "patch" }), "MANIFEST_DRIFT");
});

test("compute rejects when the target tag already exists", async () => {
  const { deps } = harness({ tags: ["v0.0.1", "v0.1.0"] });
  await expectGuard(compute(deps, { bump: "minor" }), "TAG_EXISTS");
});

// --- baseline --------------------------------------------------------------

test("baseline dry-run reports the root commit without tagging", async () => {
  const { deps, calls } = harness({ tags: [], remoteTags: [], latestTag: null });
  const r = await baseline(deps, { dryRun: true });
  expect(r.tag).toBe("v0.0.1");
  expect(r.sha).toBe("rootsha");
  expect(r.created).toBe(false);
  expect(calls).not.toContain("pushTag:v0.0.1");
});

test("baseline creates and pushes the v0.0.1 tag on the root commit", async () => {
  const { deps, calls } = harness({ tags: [], remoteTags: [], latestTag: null });
  const r = await baseline(deps, { dryRun: false });
  expect(r.created).toBe(true);
  expect(r.pushed).toBe(true);
  expect(calls).toContain("createTag:v0.0.1@rootsha");
  expect(calls).toContain("pushTag:v0.0.1");
});

test("baseline is a no-op when v0.0.1 already exists", async () => {
  const { deps, calls } = harness({ tags: ["v0.0.1"], remoteTags: ["v0.0.1"] });
  const r = await baseline(deps, { dryRun: false });
  expect(r.created).toBe(false);
  expect(calls).not.toContain("createTag:v0.0.1@rootsha");
});

// --- prepare ---------------------------------------------------------------

const PREPARE_OPTS: Options = {
  porcelain: ["?? CHANGELOG.md"],
  files: {
    "package.json": pkg("0.0.1"),
    ".claude-plugin/plugin.json": pkg("0.0.1"),
    ".claude-plugin/marketplace.json": market("0.0.1"),
    "CHANGELOG.md": CHANGELOG,
  },
};

test("prepare dry-run writes, commits, pushes, and PRs nothing", async () => {
  const { deps, calls } = harness(PREPARE_OPTS);
  const r = await prepare(deps, { bump: "minor", dryRun: true });
  expect(r.dryRun).toBe(true);
  expect(r.version).toBe("0.1.0");
  expect(r.title).toBe("v0.1.0 - The Foundations Release");
  expect(calls).toEqual([]);
});

test("prepare bumps manifests, commits, pushes, and opens a PR", async () => {
  const { deps, calls, files } = harness(PREPARE_OPTS);
  const r = await prepare(deps, { bump: "minor", dryRun: false });
  expect(files.get("package.json")).toContain('"version": "0.1.0"');
  expect(files.get(".claude-plugin/marketplace.json")).toContain(
    '"version": "0.1.0"',
  );
  expect(calls).toContain("checkoutNew:release/v0.1.0");
  expect(calls).toContain("prCreate");
  expect(r.committed).toBe(true);
  expect(r.pushed).toBe(true);
  expect(r.prUrl).toBe("https://github.com/macintacos/caret/pull/9");
  expect(r.title).toBe("v0.1.0 - The Foundations Release");
});

test("prepare reuses an already-open PR instead of opening a duplicate", async () => {
  const { deps, calls } = harness({
    ...PREPARE_OPTS,
    localBranches: ["release/v0.1.0"],
    remoteBranches: ["release/v0.1.0"],
    refs: { "origin/trunk": "trunksha", "origin/release/v0.1.0": "x" },
    prs: [
      {
        number: 3,
        url: "https://github.com/macintacos/caret/pull/3",
        state: "OPEN",
      },
    ],
  });
  const r = await prepare(deps, { bump: "minor", dryRun: false });
  expect(calls).not.toContain("prCreate");
  expect(r.prNumber).toBe(3);
  expect(r.prUrl).toBe("https://github.com/macintacos/caret/pull/3");
});

test("prepare resumes cleanly when the release branch is already bumped", async () => {
  const { deps, calls } = harness({
    branch: "release/v0.1.0",
    porcelain: [],
    localBranches: ["release/v0.1.0"],
    remoteBranches: ["release/v0.1.0"],
    refs: {
      "origin/trunk": "trunksha",
      "release/v0.1.0": "z",
      "origin/release/v0.1.0": "z",
    },
    files: {
      "package.json": pkg("0.1.0"),
      ".claude-plugin/plugin.json": pkg("0.1.0"),
      ".claude-plugin/marketplace.json": market("0.1.0"),
      "CHANGELOG.md": CHANGELOG,
    },
    prs: [
      {
        number: 3,
        url: "https://github.com/macintacos/caret/pull/3",
        state: "OPEN",
      },
    ],
  });
  const r = await prepare(deps, { bump: "minor", dryRun: false });
  expect(r.version).toBe("0.1.0");
  expect(r.prNumber).toBe(3);
  expect(calls).not.toContain("write:package.json"); // bump skipped, no crash
  expect(calls.filter((c) => c.startsWith("commit:"))).toEqual([]); // nothing to commit
  expect(calls).not.toContain("prCreate");
});

test("prepare fails loudly when the changelog section is missing", async () => {
  const { deps } = harness({
    ...PREPARE_OPTS,
    files: {
      "package.json": pkg("0.0.1"),
      ".claude-plugin/plugin.json": pkg("0.0.1"),
      ".claude-plugin/marketplace.json": market("0.0.1"),
      "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n",
    },
  });
  await expectGuard(
    prepare(deps, { bump: "minor", dryRun: false }),
    "CHANGELOG_MISSING",
  );
});

test("prepare aborts when preflight fails", async () => {
  const { deps } = harness({ ...PREPARE_OPTS, preflightOk: false });
  await expectGuard(
    prepare(deps, { bump: "minor", dryRun: false }),
    "PREFLIGHT_FAILED",
  );
});

// --- finalize --------------------------------------------------------------

const FINALIZE_OPTS: Options = {
  refs: { "origin/trunk": "mergedsha" },
  filesAtRef: {
    "origin/trunk:CHANGELOG.md": CHANGELOG,
    "origin/trunk:package.json": pkg("0.1.0"),
    "origin/trunk:.claude-plugin/plugin.json": pkg("0.1.0"),
    "origin/trunk:.claude-plugin/marketplace.json": market("0.1.0"),
  },
};

test("finalize tags trunk's merged HEAD and creates the release", async () => {
  const { deps, calls } = harness(FINALIZE_OPTS);
  const r = await finalize(deps, { dryRun: false });
  expect(r.version).toBe("0.1.0");
  expect(r.tag).toBe("v0.1.0");
  expect(r.taggedSha).toBe("mergedsha");
  expect(calls).toContain("createTag:v0.1.0@mergedsha");
  expect(calls).toContain("pushTag:v0.1.0");
  expect(calls).toContain("releaseCreate:v0.1.0");
  expect(r.releaseUrl).toBe(
    "https://github.com/macintacos/caret/releases/tag/v0.1.0",
  );
});

test("finalize succeeds from a release branch (working branch is irrelevant)", async () => {
  // Phase 1's `prepare` leaves the checkout on release/v0.1.0; finalize tags
  // origin/trunk's HEAD, so the local branch must not block it.
  const { deps, calls } = harness({ ...FINALIZE_OPTS, branch: "release/v0.1.0" });
  const r = await finalize(deps, { dryRun: false });
  expect(r.version).toBe("0.1.0");
  expect(r.tag).toBe("v0.1.0");
  expect(r.taggedSha).toBe("mergedsha");
  expect(calls).toContain("createTag:v0.1.0@mergedsha");
  expect(calls).toContain("releaseCreate:v0.1.0");
});

test("finalize dry-run mutates nothing", async () => {
  const { deps, calls } = harness(FINALIZE_OPTS);
  const r = await finalize(deps, { dryRun: true });
  expect(r.dryRun).toBe(true);
  expect(r.taggedSha).toBe("mergedsha");
  expect(calls).not.toContain("createTag:v0.1.0@mergedsha");
  expect(calls).not.toContain("releaseCreate:v0.1.0");
});

test("finalize rejects NOT_MERGED when trunk manifests lag the changelog", async () => {
  const { deps } = harness({
    refs: { "origin/trunk": "mergedsha" },
    filesAtRef: {
      "origin/trunk:CHANGELOG.md": CHANGELOG,
      "origin/trunk:package.json": pkg("0.0.1"),
      "origin/trunk:.claude-plugin/plugin.json": pkg("0.0.1"),
      "origin/trunk:.claude-plugin/marketplace.json": market("0.0.1"),
    },
  });
  await expectGuard(finalize(deps, { dryRun: false }), "NOT_MERGED");
});

test("finalize resumes a created-but-unpushed local tag without a false TAG_EXISTS", async () => {
  const { deps, calls } = harness({
    ...FINALIZE_OPTS,
    tags: ["v0.0.1", "v0.1.0"], // local tag exists
    remoteTags: ["v0.0.1"], // but was never pushed
  });
  const r = await finalize(deps, { dryRun: false });
  expect(calls).not.toContain("createTag:v0.1.0@mergedsha"); // tag already local
  expect(calls).toContain("pushTag:v0.1.0"); // push the existing tag
  expect(calls).toContain("releaseCreate:v0.1.0");
  expect(r.releaseUrl).toContain("v0.1.0");
});

test("finalize reuses an existing GitHub release", async () => {
  const { deps, calls } = harness({
    ...FINALIZE_OPTS,
    tags: ["v0.0.1", "v0.1.0"],
    remoteTags: ["v0.0.1", "v0.1.0"],
    releases: {
      "v0.1.0": { url: "https://github.com/macintacos/caret/releases/tag/v0.1.0" },
    },
  });
  const r = await finalize(deps, { dryRun: false });
  expect(calls).not.toContain("releaseCreate:v0.1.0");
  expect(r.releaseUrl).toBe(
    "https://github.com/macintacos/caret/releases/tag/v0.1.0",
  );
});
