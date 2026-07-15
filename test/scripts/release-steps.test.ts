// Drives the baseline/compute/prepare/finalize orchestration and its resume
// state machine through injected fakes — no live repo, no network. The fakes (and
// the synthetic manifest/changelog/commit fixtures) live in the typed builder
// `test/support/release-harness.ts`; each records mutating calls so we can assert
// exactly what would (or would not) run.
import { expect, test } from "bun:test";

import type { ErrorCode } from "../../scripts/tasks/release/contract.ts";
import {
  baseline,
  compute,
  finalize,
  GuardError,
  prepare,
} from "../../scripts/tasks/release/steps.ts";
import {
  CHANGELOG,
  type HarnessOptions,
  makeReleaseHarness,
  market,
  pkg,
} from "../support/release-harness.ts";

async function expectGuard(p: Promise<unknown>, code: ErrorCode) {
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
  const { deps } = makeReleaseHarness();
  const r = await compute(deps, { bump: "minor" });
  expect(r.ok).toBe(true);
  expect(r.currentVersion).toBe("0.0.1");
  expect(r.version).toBe("0.1.0");
  expect(r.tag).toBe("v0.1.0");
  expect(r.previousTag).toBe("v0.0.1");
  expect(r.releaseBranch).toBe("release/v0.1.0");
  expect(r.compareUrl).toBe("https://github.com/macintacos/caret/compare/v0.0.1...v0.1.0");
  expect(r.commits[0]?.issueRefs).toEqual(["EXC-1"]);
  expect(r.commits[0]?.prNumber).toBe(2);
});

test("compute surfaces the UTC date and the manifest paths", async () => {
  const { deps } = makeReleaseHarness();
  const r = await compute(deps, { bump: "minor" });
  expect(r.date).toBe("2026-06-02");
  expect(r.manifests).toEqual([
    "package.json",
    ".claude-plugin/marketplace.json",
    ".claude-plugin/plugin.json",
  ]);
});

test("compute rejects with NO_BASELINE when there are no tags", async () => {
  const { deps } = makeReleaseHarness({ latestTag: null });
  await expectGuard(compute(deps, { bump: "patch" }), "NO_BASELINE");
});

test("compute rejects a dirty tree", async () => {
  const { deps } = makeReleaseHarness({ porcelain: [" M src/x.ts"] });
  await expectGuard(compute(deps, { bump: "patch" }), "DIRTY_TREE");
});

test("compute rejects a non-default branch", async () => {
  const { deps } = makeReleaseHarness({ branch: "feature/x" });
  await expectGuard(compute(deps, { bump: "patch" }), "WRONG_BRANCH");
});

test("compute rejects a detached HEAD", async () => {
  const { deps } = makeReleaseHarness({ branch: "HEAD" });
  await expectGuard(compute(deps, { bump: "patch" }), "DETACHED_HEAD");
});

test("compute rejects manifest drift", async () => {
  const { deps } = makeReleaseHarness({
    files: {
      "package.json": pkg("0.0.1"),
      ".claude-plugin/plugin.json": pkg("0.0.2"),
      ".claude-plugin/marketplace.json": market("0.0.1"),
    },
  });
  await expectGuard(compute(deps, { bump: "patch" }), "MANIFEST_DRIFT");
});

test("compute rejects when the target tag already exists", async () => {
  const { deps } = makeReleaseHarness({ tags: ["v0.0.1", "v0.1.0"] });
  await expectGuard(compute(deps, { bump: "minor" }), "TAG_EXISTS");
});

// --- baseline --------------------------------------------------------------

test("baseline dry-run reports the root commit without tagging", async () => {
  const { deps, calls } = makeReleaseHarness({ tags: [], remoteTags: [], latestTag: null });
  const r = await baseline(deps, { dryRun: true });
  expect(r.tag).toBe("v0.0.1");
  expect(r.sha).toBe("rootsha");
  expect(r.created).toBe(false);
  expect(calls).not.toContain("pushTag:v0.0.1");
});

test("baseline creates and pushes the v0.0.1 tag on the root commit", async () => {
  const { deps, calls } = makeReleaseHarness({ tags: [], remoteTags: [], latestTag: null });
  const r = await baseline(deps, { dryRun: false });
  expect(r.created).toBe(true);
  expect(r.pushed).toBe(true);
  expect(calls).toContain("createTag:v0.0.1@rootsha");
  expect(calls).toContain("pushTag:v0.0.1");
});

test("baseline is a no-op when v0.0.1 already exists", async () => {
  const { deps, calls } = makeReleaseHarness({ tags: ["v0.0.1"], remoteTags: ["v0.0.1"] });
  const r = await baseline(deps, { dryRun: false });
  expect(r.created).toBe(false);
  expect(calls).not.toContain("createTag:v0.0.1@rootsha");
});

// --- prepare ---------------------------------------------------------------

const PREPARE_OPTS: HarnessOptions = {
  porcelain: ["?? CHANGELOG.md"],
  files: {
    "package.json": pkg("0.0.1"),
    ".claude-plugin/plugin.json": pkg("0.0.1"),
    ".claude-plugin/marketplace.json": market("0.0.1"),
    "CHANGELOG.md": CHANGELOG,
  },
};

test("prepare dry-run writes, commits, pushes, and PRs nothing", async () => {
  const { deps, calls } = makeReleaseHarness(PREPARE_OPTS);
  const r = await prepare(deps, { bump: "minor", dryRun: true });
  expect(r.dryRun).toBe(true);
  expect(r.version).toBe("0.1.0");
  expect(r.title).toBe("v0.1.0 - The Foundations Release");
  expect(calls).toEqual([]);
});

test("prepare bumps manifests, commits, pushes, and opens a PR", async () => {
  const { deps, calls, files } = makeReleaseHarness(PREPARE_OPTS);
  const r = await prepare(deps, { bump: "minor", dryRun: false });
  expect(files.get("package.json")).toContain('"version": "0.1.0"');
  expect(files.get(".claude-plugin/marketplace.json")).toContain('"version": "0.1.0"');
  expect(calls).toContain("checkoutNew:release/v0.1.0");
  expect(calls).toContain("prCreate");
  expect(r.committed).toBe(true);
  expect(r.pushed).toBe(true);
  expect(r.prUrl).toBe("https://github.com/macintacos/caret/pull/9");
  expect(r.title).toBe("v0.1.0 - The Foundations Release");
});

test("prepare reuses an already-open PR instead of opening a duplicate", async () => {
  const { deps, calls } = makeReleaseHarness({
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
  const { deps, calls } = makeReleaseHarness({
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
  const { deps } = makeReleaseHarness({
    ...PREPARE_OPTS,
    files: {
      "package.json": pkg("0.0.1"),
      ".claude-plugin/plugin.json": pkg("0.0.1"),
      ".claude-plugin/marketplace.json": market("0.0.1"),
      "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n",
    },
  });
  await expectGuard(prepare(deps, { bump: "minor", dryRun: false }), "CHANGELOG_MISSING");
});

test("prepare rejects BRANCH_DIVERGED when the remote release branch is not an ancestor", async () => {
  // Local and remote release-branch SHAs differ and the remote is not an
  // ancestor of local, so pushing would need a force-push the script never does.
  const { deps, calls } = makeReleaseHarness({
    branch: "release/v0.1.0",
    porcelain: [],
    localBranches: ["release/v0.1.0"],
    remoteBranches: ["release/v0.1.0"],
    refs: {
      "origin/trunk": "trunksha",
      "release/v0.1.0": "localsha",
      "origin/release/v0.1.0": "remotesha", // diverged from local
    },
    ancestor: false, // remote is not an ancestor of local
    files: {
      "package.json": pkg("0.1.0"),
      ".claude-plugin/plugin.json": pkg("0.1.0"),
      ".claude-plugin/marketplace.json": market("0.1.0"),
      "CHANGELOG.md": CHANGELOG,
    },
  });
  await expectGuard(prepare(deps, { bump: "minor", dryRun: false }), "BRANCH_DIVERGED");
  expect(calls).not.toContain("pushBranch:release/v0.1.0:false"); // never pushed over the divergence
});

test("prepare rejects ALREADY_MERGED when the release PR is already merged", async () => {
  // The bump PR merged but the operator re-ran prepare; it must point them at
  // finalize rather than open a duplicate or push again.
  const { deps, calls } = makeReleaseHarness({
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
        state: "MERGED",
      },
    ],
  });
  await expectGuard(prepare(deps, { bump: "minor", dryRun: false }), "ALREADY_MERGED");
  expect(calls).not.toContain("prCreate");
});

test("prepare rejects PR_CLOSED when the release PR was closed unmerged", async () => {
  // A closed-unmerged PR means a human intervened; prepare refuses to silently
  // open a fresh PR over the same branch.
  const { deps, calls } = makeReleaseHarness({
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
        state: "CLOSED",
      },
    ],
  });
  await expectGuard(prepare(deps, { bump: "minor", dryRun: false }), "PR_CLOSED");
  expect(calls).not.toContain("prCreate");
});

// --- finalize --------------------------------------------------------------

const FINALIZE_OPTS: HarnessOptions = {
  refs: { "origin/trunk": "mergedsha" },
  filesAtRef: {
    "origin/trunk:CHANGELOG.md": CHANGELOG,
    "origin/trunk:package.json": pkg("0.1.0"),
    "origin/trunk:.claude-plugin/plugin.json": pkg("0.1.0"),
    "origin/trunk:.claude-plugin/marketplace.json": market("0.1.0"),
  },
};

test("finalize tags trunk's merged HEAD, creates the release, and publishes to npm", async () => {
  const { deps, calls } = makeReleaseHarness(FINALIZE_OPTS);
  const r = await finalize(deps, { dryRun: false });
  expect(r.version).toBe("0.1.0");
  expect(r.tag).toBe("v0.1.0");
  expect(r.taggedSha).toBe("mergedsha");
  expect(calls).toContain("createTag:v0.1.0@mergedsha");
  expect(calls).toContain("pushTag:v0.1.0");
  expect(calls).toContain("releaseCreate:v0.1.0");
  expect(calls).toContain("npmPublish");
  expect(r.npmPublished).toBe(true);
  expect(r.releaseUrl).toBe("https://github.com/macintacos/caret/releases/tag/v0.1.0");
});

test("finalize succeeds from a release branch (working branch is irrelevant)", async () => {
  // Phase 1's `prepare` leaves the checkout on release/v0.1.0; finalize tags
  // origin/trunk's HEAD, so the local branch must not block it.
  const { deps, calls } = makeReleaseHarness({ ...FINALIZE_OPTS, branch: "release/v0.1.0" });
  const r = await finalize(deps, { dryRun: false });
  expect(r.version).toBe("0.1.0");
  expect(r.tag).toBe("v0.1.0");
  expect(r.taggedSha).toBe("mergedsha");
  expect(calls).toContain("createTag:v0.1.0@mergedsha");
  expect(calls).toContain("releaseCreate:v0.1.0");
});

test("finalize dry-run mutates nothing", async () => {
  const { deps, calls } = makeReleaseHarness(FINALIZE_OPTS);
  const r = await finalize(deps, { dryRun: true });
  expect(r.dryRun).toBe(true);
  expect(r.taggedSha).toBe("mergedsha");
  expect(calls).not.toContain("createTag:v0.1.0@mergedsha");
  expect(calls).not.toContain("releaseCreate:v0.1.0");
  expect(calls).not.toContain("npmPublish");
  expect(r.npmPublished).toBe(false);
});

test("finalize skips npm publish when the version is already on the registry", async () => {
  const { deps, calls } = makeReleaseHarness({ ...FINALIZE_OPTS, npmPublishedVersions: ["0.1.0"] });
  const r = await finalize(deps, { dryRun: false });
  expect(calls).toContain("releaseCreate:v0.1.0"); // the GitHub release still happens
  expect(calls).not.toContain("npmPublish"); // but npm publish is skipped
  expect(r.npmPublished).toBe(false);
});

test("finalize still publishes to npm when the GitHub release already exists (resume)", async () => {
  // A prior run created the release but its npm publish failed; the re-run must
  // reuse the release AND complete the npm publish rather than no-op.
  const { deps, calls } = makeReleaseHarness({
    ...FINALIZE_OPTS,
    tags: ["v0.0.1", "v0.1.0"],
    remoteTags: ["v0.0.1", "v0.1.0"],
    releases: {
      "v0.1.0": { url: "https://github.com/macintacos/caret/releases/tag/v0.1.0" },
    },
  });
  const r = await finalize(deps, { dryRun: false });
  expect(calls).not.toContain("releaseCreate:v0.1.0"); // release reused
  expect(calls).toContain("npmPublish"); // npm publish still runs
  expect(r.npmPublished).toBe(true);
});

test("finalize rejects NOT_MERGED when trunk manifests lag the changelog", async () => {
  const { deps } = makeReleaseHarness({
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
  const { deps, calls } = makeReleaseHarness({
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

test("finalize rejects TAG_EXISTS when the local tag points at another commit", async () => {
  // The local tag exists but was created on a different commit than trunk's
  // merged HEAD; finalize must refuse to move it (never re-tags).
  const { deps, calls } = makeReleaseHarness({
    ...FINALIZE_OPTS,
    tags: ["v0.0.1", "v0.1.0"], // local tag exists
    remoteTags: ["v0.0.1"], // but was never pushed
    refs: {
      "origin/trunk": "mergedsha",
      "v0.1.0^{commit}": "stalesha", // local tag points elsewhere
    },
  });
  await expectGuard(finalize(deps, { dryRun: false }), "TAG_EXISTS");
  expect(calls).not.toContain("createTag:v0.1.0@mergedsha"); // never re-tagged
  expect(calls).not.toContain("pushTag:v0.1.0"); // never pushed the stale tag
});

test("finalize reuses an existing GitHub release", async () => {
  const { deps, calls } = makeReleaseHarness({
    ...FINALIZE_OPTS,
    tags: ["v0.0.1", "v0.1.0"],
    remoteTags: ["v0.0.1", "v0.1.0"],
    releases: {
      "v0.1.0": { url: "https://github.com/macintacos/caret/releases/tag/v0.1.0" },
    },
  });
  const r = await finalize(deps, { dryRun: false });
  expect(calls).not.toContain("releaseCreate:v0.1.0");
  expect(r.releaseUrl).toBe("https://github.com/macintacos/caret/releases/tag/v0.1.0");
});

// --- finalize: summary + reflow ---------------------------------------------

test("finalize prepends the --summary above the reflowed changelog notes", async () => {
  const { deps, calls, releases } = makeReleaseHarness(FINALIZE_OPTS);
  await finalize(deps, { dryRun: false, summary: "Ships the widget." });
  expect(calls).toContain("releaseCreate:v0.1.0");
  expect(calls).toContain("reflow"); // the body went through rumdl
  const notes = releases.get("v0.1.0")?.notes ?? "";
  expect(notes).toContain("Ships the widget."); // summary at the top
  expect(notes).toContain("- A thing."); // changelog-scraped content remains
  expect(notes.indexOf("Ships the widget.")).toBeLessThan(notes.indexOf("- A thing."));
});

test("finalize reflows the changelog notes even without a summary", async () => {
  const { deps, calls, releases } = makeReleaseHarness(FINALIZE_OPTS);
  await finalize(deps, { dryRun: false });
  expect(calls).toContain("reflow");
  const notes = releases.get("v0.1.0")?.notes ?? "";
  expect(notes).toContain("- A thing.");
  expect(notes).not.toContain("Ships"); // no summary was supplied
});

test("finalize with a summary refreshes the notes of a reused release", async () => {
  const { deps, calls, releases } = makeReleaseHarness({
    ...FINALIZE_OPTS,
    tags: ["v0.0.1", "v0.1.0"],
    remoteTags: ["v0.0.1", "v0.1.0"],
    releases: { "v0.1.0": { url: "https://github.com/macintacos/caret/releases/tag/v0.1.0" } },
  });
  await finalize(deps, { dryRun: false, summary: "Resumed and summarized." });
  expect(calls).not.toContain("releaseCreate:v0.1.0"); // reused, not recreated
  expect(calls).toContain("releaseEdit:v0.1.0"); // notes refreshed in place
  expect(releases.get("v0.1.0")?.notes).toContain("Resumed and summarized.");
});

test("finalize dry-run with a summary edits nothing", async () => {
  const { deps, calls } = makeReleaseHarness(FINALIZE_OPTS);
  await finalize(deps, { dryRun: true, summary: "Would-be summary." });
  expect(calls).not.toContain("releaseCreate:v0.1.0");
  expect(calls).not.toContain("releaseEdit:v0.1.0");
  expect(calls).not.toContain("reflow");
});

test("finalize without a summary leaves a reused release's notes untouched", async () => {
  // The no-clobber invariant: a summary-less resume must never rewrite the notes,
  // so a summary a prior run published survives. Dropping the summary guard in
  // finalize would fail this (reuse would releaseEdit with the bare changelog).
  const { deps, calls, releases } = makeReleaseHarness({
    ...FINALIZE_OPTS,
    tags: ["v0.0.1", "v0.1.0"],
    remoteTags: ["v0.0.1", "v0.1.0"],
    releases: {
      "v0.1.0": {
        url: "https://github.com/macintacos/caret/releases/tag/v0.1.0",
        notes: "Prior summary the operator published.",
      },
    },
  });
  await finalize(deps, { dryRun: false }); // no summary
  expect(calls).not.toContain("releaseEdit:v0.1.0");
  expect(releases.get("v0.1.0")?.notes).toBe("Prior summary the operator published.");
});
