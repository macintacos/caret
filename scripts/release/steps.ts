// Orchestration for the release pipeline: baseline / compute / prepare /
// finalize, plus the resume state machine that makes every step safe to re-run
// after a partial failure. Effectful collaborators (git, gh, fs, preflight) are
// injected so this logic can be unit-tested with fakes; cli.ts wires the real
// ones. The version is always derived here from the latest tag — never from an
// agent-supplied value — so the "agent never invents the version" guarantee holds.

import { composeReleaseTitle, findSection, findTopReleasedVersion } from "./changelog.ts";
import {
  type CommitInfo,
  type ComputeResult,
  type ErrorCode,
  SCHEMA_VERSION,
  compareUrl,
  parseCommitMeta,
} from "./contract.ts";
import type { GitOps } from "./git.ts";
import type { GitHubOps } from "./github.ts";
import { assertInSync, editVersion, extractVersion } from "./manifest.ts";
import { type BumpLevel, nextVersion, tagName, versionFromTag } from "./version.ts";

/** Read/write/exists over the working tree; injected for testability. */
export interface FsOps {
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** Diagnostics sink (stderr in the real CLI; silent in tests). */
export interface Io {
  log(message: string): void;
}

export interface Deps {
  git: GitOps;
  github: GitHubOps;
  fs: FsOps;
  io: Io;
  preflight(): Promise<{ ok: boolean; output: string }>;
}

/** A guard rejection carrying the machine-readable ErrorCode for the contract. */
export class GuardError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

/** The baseline tag placed on the repository's initial commit. */
export const BASELINE_TAG = "v0.0.1";

const MANIFESTS = ["package.json", ".claude-plugin/marketplace.json", ".claude-plugin/plugin.json"];
const CHANGELOG_PATH = "CHANGELOG.md";

export interface BaselineResult {
  phase: "baseline";
  tag: string;
  sha: string;
  created: boolean;
  pushed: boolean;
  dryRun: boolean;
}

export interface PrepareResult {
  phase: "prepare";
  version: string;
  tag: string;
  releaseBranch: string;
  title: string;
  prNumber: number | null;
  prUrl: string | null;
  committed: boolean;
  pushed: boolean;
  dryRun: boolean;
}

export interface FinalizeResult {
  phase: "finalize";
  version: string;
  tag: string;
  title: string;
  taggedSha: string;
  releaseUrl: string | null;
  dryRun: boolean;
}

// --- shared guards ---------------------------------------------------------

async function assertRepoAndGh(deps: Deps): Promise<{ repoSlug: string; defaultBranch: string }> {
  if (!(await deps.git.isRepo())) {
    throw new GuardError("NOT_A_REPO", "Not inside a git repository.");
  }
  if (!(await deps.github.available())) {
    throw new GuardError("NO_GH", "The gh CLI is not available.");
  }
  return {
    repoSlug: await deps.github.repoSlug(),
    defaultBranch: await deps.github.defaultBranch(),
  };
}

async function assertBranch(
  deps: Deps,
  defaultBranch: string,
  opts: { allowPrefixes?: string[] } = {},
): Promise<string> {
  const branch = await deps.git.currentBranch();
  if (branch === "HEAD") {
    throw new GuardError("DETACHED_HEAD", "HEAD is detached; checkout a branch.");
  }
  const prefixes = opts.allowPrefixes ?? [];
  if (branch !== defaultBranch && !prefixes.some((p) => branch.startsWith(p))) {
    const allowed = [defaultBranch, ...prefixes.map((p) => `${p}*`)].join(" or ");
    throw new GuardError("WRONG_BRANCH", `On ${branch}; expected ${allowed}.`);
  }
  return branch;
}

async function assertCleanTree(deps: Deps, allowed: string[] = []): Promise<void> {
  const offending = (await deps.git.porcelainStatus())
    .map((line) => line.slice(3).trim())
    .filter((path) => path !== "" && !allowed.includes(path));
  if (offending.length > 0) {
    throw new GuardError("DIRTY_TREE", `Working tree has changes: ${offending.join(", ")}.`);
  }
}

/** assertInSync but raising the typed MANIFEST_DRIFT guard on disagreement. */
function syncedVersion(entries: { file: string; version: string }[]): string {
  try {
    return assertInSync(entries);
  } catch (e) {
    throw new GuardError("MANIFEST_DRIFT", (e as Error).message);
  }
}

async function readSyncedVersion(deps: Deps): Promise<string> {
  const entries: { file: string; version: string }[] = [];
  for (const file of MANIFESTS) {
    entries.push({ file, version: extractVersion(await deps.fs.read(file)) });
  }
  return syncedVersion(entries);
}

interface ReleaseContext {
  bump: BumpLevel;
  currentVersion: string;
  previousVersion: string;
  version: string;
  tag: string;
  previousTag: string;
  releaseBranch: string;
  repoSlug: string;
  defaultBranch: string;
  headSha: string;
}

async function gatherContext(
  deps: Deps,
  bump: BumpLevel,
  repoSlug: string,
  defaultBranch: string,
): Promise<ReleaseContext> {
  const previousTag = await deps.git.latestVersionTag();
  if (previousTag === null) {
    throw new GuardError(
      "NO_BASELINE",
      "No release tags yet. Run `mise run release baseline` to tag the initial commit as v0.0.1.",
    );
  }
  const previousVersion = versionFromTag(previousTag);
  const currentVersion = await readSyncedVersion(deps);
  const version = nextVersion(previousVersion, bump);
  const tag = tagName(version);
  if ((await deps.git.localTagExists(tag)) || (await deps.git.remoteTagExists(tag))) {
    throw new GuardError("TAG_EXISTS", `Tag ${tag} already exists.`);
  }
  const headSha = await deps.git.headSha();
  return {
    bump,
    currentVersion,
    previousVersion,
    version,
    tag,
    previousTag,
    releaseBranch: `release/${tag}`,
    repoSlug,
    defaultBranch,
    headSha,
  };
}

// --- compute ---------------------------------------------------------------

/** Read-only: computes the next version + commit range. Never mutates anything. */
export async function compute(deps: Deps, opts: { bump: BumpLevel }): Promise<ComputeResult> {
  const { repoSlug, defaultBranch } = await assertRepoAndGh(deps);
  await assertBranch(deps, defaultBranch);
  await assertCleanTree(deps);
  const ctx = await gatherContext(deps, opts.bump, repoSlug, defaultBranch);
  const commits: CommitInfo[] = (await deps.git.commitsBetween(`${ctx.previousTag}..HEAD`)).map(
    (c) => ({
      sha: c.sha,
      shortSha: c.shortSha,
      subject: c.subject,
      ...parseCommitMeta(c.subject),
    }),
  );
  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    bump: ctx.bump,
    currentVersion: ctx.currentVersion,
    previousVersion: ctx.previousVersion,
    version: ctx.version,
    tag: ctx.tag,
    previousTag: ctx.previousTag,
    headSha: ctx.headSha,
    repoSlug: ctx.repoSlug,
    defaultBranch: ctx.defaultBranch,
    releaseBranch: ctx.releaseBranch,
    compareUrl: compareUrl(repoSlug, ctx.previousTag, ctx.tag),
    unreleasedCompareUrl: compareUrl(repoSlug, ctx.tag, "HEAD"),
    commits,
    manifestsInSync: true,
  };
}

// --- baseline --------------------------------------------------------------

/** One-time bootstrap: tag the repository's initial commit as v0.0.1. Idempotent. */
export async function baseline(deps: Deps, opts: { dryRun: boolean }): Promise<BaselineResult> {
  if (!(await deps.git.isRepo())) {
    throw new GuardError("NOT_A_REPO", "Not inside a git repository.");
  }
  const tag = BASELINE_TAG;
  const sha = await deps.git.rootCommit();
  const remoteExists = await deps.git.remoteTagExists(tag);
  if ((await deps.git.localTagExists(tag)) || remoteExists) {
    deps.io.log(`Baseline tag ${tag} already exists; nothing to do.`);
    return {
      phase: "baseline",
      tag,
      sha,
      created: false,
      pushed: remoteExists,
      dryRun: opts.dryRun,
    };
  }
  if (opts.dryRun) {
    deps.io.log(`Would tag ${sha} as ${tag} and push it.`);
    return { phase: "baseline", tag, sha, created: false, pushed: false, dryRun: true };
  }
  await deps.git.createAnnotatedTag(tag, sha, `caret ${tag} (baseline)`);
  await deps.git.pushTag(tag);
  deps.io.log(`Tagged ${sha} as ${tag} and pushed it.`);
  return { phase: "baseline", tag, sha, created: true, pushed: true, dryRun: false };
}

// --- prepare (phase 1) -----------------------------------------------------

function prBody(version: string, title: string): string {
  return [
    "## What changed",
    "",
    `Release ${title}: bumps the version to ${version} across package.json and the two .claude-plugin manifests, and moves the Unreleased changelog entries under the new section.`,
    "",
    "## What to test",
    "",
    "- `mise run preflight` passes on the release branch.",
    "- The three manifests and CHANGELOG.md all reflect the new version.",
  ].join("\n");
}

/** Phase 1: bump manifests, commit with the changelog, push the branch, open a PR. */
export async function prepare(
  deps: Deps,
  opts: { bump: BumpLevel; dryRun: boolean },
): Promise<PrepareResult> {
  const apply = !opts.dryRun;
  const { repoSlug, defaultBranch } = await assertRepoAndGh(deps);
  await assertBranch(deps, defaultBranch, { allowPrefixes: ["release/"] });
  await assertCleanTree(deps, [...MANIFESTS, CHANGELOG_PATH]);
  const ctx = await gatherContext(deps, opts.bump, repoSlug, defaultBranch);

  // The agent authors the changelog (with the theme) before this runs.
  if (!(await deps.fs.exists(CHANGELOG_PATH))) {
    throw new GuardError("CHANGELOG_MISSING", "CHANGELOG.md does not exist yet.");
  }
  const changelog = await deps.fs.read(CHANGELOG_PATH);
  const section = findSection(changelog, ctx.version);
  if (section === null) {
    throw new GuardError(
      "CHANGELOG_MISSING",
      `CHANGELOG.md has no [${ctx.version}] section; author it first.`,
    );
  }
  const title = composeReleaseTitle(ctx.version, section.heading.title);

  // Ensure we are on the release branch (resume-aware).
  if ((await deps.git.currentBranch()) !== ctx.releaseBranch) {
    if (await deps.git.localBranchExists(ctx.releaseBranch)) {
      if (apply) await deps.git.checkoutExistingBranch(ctx.releaseBranch);
      else deps.io.log(`Would checkout existing branch ${ctx.releaseBranch}.`);
    } else if (await deps.git.remoteBranchExists(ctx.releaseBranch)) {
      if (apply) {
        await deps.git.fetch();
        await deps.git.checkoutExistingBranch(ctx.releaseBranch);
      } else deps.io.log(`Would fetch and checkout ${ctx.releaseBranch}.`);
    } else {
      if (apply) await deps.git.checkoutNewBranch(ctx.releaseBranch);
      else deps.io.log(`Would create branch ${ctx.releaseBranch}.`);
    }
  }

  // Bump the manifests, reading each file's actual version AFTER the checkout
  // so a resume (release branch already bumped) skips instead of crashing.
  for (const file of MANIFESTS) {
    const content = await deps.fs.read(file);
    const fileVersion = extractVersion(content);
    if (fileVersion === ctx.version) {
      deps.io.log(`${file} already at ${ctx.version}; skipping.`);
      continue;
    }
    if (fileVersion !== ctx.previousVersion) {
      throw new GuardError(
        "MANIFEST_DRIFT",
        `${file} at ${fileVersion}; expected ${ctx.previousVersion} or ${ctx.version}.`,
      );
    }
    if (apply) {
      await deps.fs.write(file, editVersion(content, ctx.previousVersion, ctx.version));
    } else {
      deps.io.log(`Would bump ${file} ${ctx.previousVersion} -> ${ctx.version}.`);
    }
  }

  // Gate on preflight (format, lint, test, build).
  if (apply) {
    const pf = await deps.preflight();
    if (!pf.ok) {
      throw new GuardError("PREFLIGHT_FAILED", pf.output.trim() || "mise run preflight failed.");
    }
  } else {
    deps.io.log("Would gate on `mise run preflight`.");
  }

  // Commit (resume-aware: skip if nothing to commit).
  let committed = false;
  const dirty = await deps.git.porcelainStatus();
  if (dirty.length > 0) {
    if (apply) {
      await deps.git.stage([...MANIFESTS, CHANGELOG_PATH]);
      await deps.git.commit(title);
      committed = true;
    } else deps.io.log(`Would commit "${title}".`);
  } else {
    deps.io.log("Nothing to commit; bump already committed.");
  }

  // Push (resume-aware: skip if already up to date; never force-push).
  let pushed = false;
  if (!(await deps.git.remoteBranchExists(ctx.releaseBranch))) {
    if (apply) {
      await deps.git.pushBranch(ctx.releaseBranch, true);
      pushed = true;
    } else deps.io.log(`Would push -u ${ctx.releaseBranch}.`);
  } else {
    const localSha = await deps.git.tryRevParse(ctx.releaseBranch);
    const remoteSha = await deps.git.tryRevParse(`origin/${ctx.releaseBranch}`);
    if (localSha !== null && remoteSha !== null && localSha !== remoteSha) {
      if (!(await deps.git.isAncestor(remoteSha, localSha))) {
        throw new GuardError(
          "BRANCH_DIVERGED",
          `${ctx.releaseBranch} diverged from origin; resolve manually (never force-pushed).`,
        );
      }
    }
    if (localSha === null || remoteSha === null || localSha !== remoteSha) {
      if (apply) {
        await deps.git.pushBranch(ctx.releaseBranch, false);
        pushed = true;
      } else deps.io.log(`Would push ${ctx.releaseBranch}.`);
    } else {
      deps.io.log(`${ctx.releaseBranch} already pushed and up to date.`);
    }
  }

  // Open the PR (resume-aware: reuse open, refuse on merged/closed).
  let prNumber: number | null = null;
  let prUrl: string | null = null;
  const prs = await deps.github.prList({ head: ctx.releaseBranch, state: "all" });
  const open = prs.find((p) => p.state === "OPEN");
  const merged = prs.find((p) => p.state === "MERGED");
  const closed = prs.find((p) => p.state === "CLOSED");
  if (open) {
    prNumber = open.number;
    prUrl = open.url;
    deps.io.log(`Reusing open PR #${open.number}.`);
  } else if (merged) {
    throw new GuardError("ALREADY_MERGED", "Release PR already merged; run `finalize`.");
  } else if (closed) {
    throw new GuardError(
      "PR_CLOSED",
      "Release PR was closed unmerged; reopen or delete the branch.",
    );
  } else if (apply) {
    const pr = await deps.github.prCreate({
      head: ctx.releaseBranch,
      base: defaultBranch,
      title,
      body: prBody(ctx.version, title),
    });
    prNumber = pr.number;
    prUrl = pr.url;
  } else {
    deps.io.log(`Would open a PR for ${ctx.releaseBranch}.`);
  }

  return {
    phase: "prepare",
    version: ctx.version,
    tag: ctx.tag,
    releaseBranch: ctx.releaseBranch,
    title,
    prNumber,
    prUrl,
    committed,
    pushed,
    dryRun: opts.dryRun,
  };
}

// --- finalize (phase 2) ----------------------------------------------------

/** Phase 2: tag trunk's merged HEAD and publish the GitHub Release. */
export async function finalize(deps: Deps, opts: { dryRun: boolean }): Promise<FinalizeResult> {
  const { defaultBranch } = await assertRepoAndGh(deps);
  await assertBranch(deps, defaultBranch);
  await assertCleanTree(deps);

  // Fetch unconditionally (read-only): even a dry run must read a fresh
  // origin/trunk so phase detection and previews reflect a merged PR.
  await deps.git.fetch();

  const trunkRef = `origin/${defaultBranch}`;
  const trunkSha = await deps.git.tryRevParse(trunkRef);
  if (trunkSha === null) {
    throw new GuardError("NOT_MERGED", `Cannot resolve ${trunkRef}.`);
  }

  // Derive the version from trunk's changelog and verify the bump is on trunk.
  const changelog = await deps.git.tryFileAtRef(trunkRef, CHANGELOG_PATH);
  if (changelog === null) {
    throw new GuardError("NOT_MERGED", "No CHANGELOG.md on trunk yet.");
  }
  const version = findTopReleasedVersion(changelog);
  if (version === null) {
    throw new GuardError("NOT_MERGED", "No released section in trunk's changelog.");
  }
  const tag = tagName(version);

  const entries: { file: string; version: string }[] = [];
  for (const file of MANIFESTS) {
    const c = await deps.git.tryFileAtRef(trunkRef, file);
    if (c === null) throw new GuardError("NOT_MERGED", `${file} missing on trunk.`);
    entries.push({ file, version: extractVersion(c) });
  }
  const trunkVersion = syncedVersion(entries);
  if (trunkVersion !== version) {
    throw new GuardError(
      "NOT_MERGED",
      `Trunk manifests at ${trunkVersion}, changelog at ${version}; bump not merged yet.`,
    );
  }

  const section = findSection(changelog, version);
  const title = composeReleaseTitle(version, section?.heading.title ?? null);
  const notes = section?.notes ?? "";

  // Resume: a release already exists.
  const existing = await deps.github.releaseView(tag);
  if (existing !== null) {
    deps.io.log(`Release ${tag} already exists; nothing to do.`);
    return {
      phase: "finalize",
      version,
      tag,
      title,
      taggedSha: trunkSha,
      releaseUrl: existing.url,
      dryRun: opts.dryRun,
    };
  }

  if (opts.dryRun) {
    deps.io.log(`Would tag ${trunkSha} as ${tag}, push it, and create "${title}".`);
    return {
      phase: "finalize",
      version,
      tag,
      title,
      taggedSha: trunkSha,
      releaseUrl: null,
      dryRun: true,
    };
  }

  // Tag trunk's merged HEAD (resume-aware; never move an existing tag).
  if (!(await deps.git.remoteTagExists(tag))) {
    if (!(await deps.git.localTagExists(tag))) {
      await deps.git.createAnnotatedTag(tag, trunkSha, title);
    } else {
      // Dereference to the commit: an annotated tag's own object SHA differs
      // from the commit it points at.
      const localTagSha = await deps.git.tryRevParse(`${tag}^{commit}`);
      if (localTagSha !== null && localTagSha !== trunkSha) {
        throw new GuardError(
          "TAG_EXISTS",
          `Local tag ${tag} points at ${localTagSha}, not ${trunkSha}.`,
        );
      }
    }
    await deps.git.pushTag(tag);
  }

  const release = await deps.github.releaseCreate({ tag, title, notes });
  deps.io.log(`Created release ${tag}.`);
  return {
    phase: "finalize",
    version,
    tag,
    title,
    taggedSha: trunkSha,
    releaseUrl: release.url,
    dryRun: false,
  };
}
