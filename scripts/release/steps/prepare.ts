// prepare (phase 1): bump the manifests, commit with the changelog, push the
// release branch, and open the PR. Every sub-phase is resume-aware so the whole
// step is safe to re-run after a partial failure: it detects an existing branch,
// an already-bumped manifest, a committed bump, an up-to-date remote, and an open
// PR, skipping or no-oping rather than crashing. The body below sequences the
// sub-phases; each is a named helper so the flow reads as its phases.

import { composeReleaseTitle, findSection } from "../changelog.ts";
import type { PrState } from "../github.ts";
import { editVersion, extractVersion } from "../manifest.ts";
import type { BumpLevel } from "../version.ts";
import {
  CHANGELOG_PATH,
  gatherContext,
  MANIFESTS,
  type PrepareResult,
  type ReleaseContext,
} from "./context.ts";
import type { Deps } from "./deps.ts";
import {
  assertBranch,
  assertCleanTree,
  assertRepoAndGh,
  GuardError,
  offendingPaths,
} from "./guards.ts";

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

/** Read the changelog section for the version and compose the release title. */
async function composeTitle(deps: Deps, ctx: ReleaseContext): Promise<string> {
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
  return composeReleaseTitle(ctx.version, section.heading.title);
}

/** Ensure we are on the release branch, resuming onto an existing local/remote one. */
async function resolveReleaseBranch(
  deps: Deps,
  ctx: ReleaseContext,
  apply: boolean,
): Promise<void> {
  if ((await deps.git.currentBranch()) === ctx.releaseBranch) return;
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

/** Bump each manifest from previousVersion to version, skipping ones already bumped. */
async function bumpManifests(deps: Deps, ctx: ReleaseContext, apply: boolean): Promise<void> {
  // Read each file's actual version AFTER the checkout so a resume (release
  // branch already bumped) skips instead of crashing.
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
}

/** Gate on preflight (lint, tests, build — check-only, EXC-462) and reject any drift it left. */
async function gatePreflight(deps: Deps, apply: boolean): Promise<void> {
  if (!apply) {
    deps.io.log("Would gate on `mise run preflight`.");
    return;
  }
  const pf = await deps.preflight();
  if (!pf.ok) {
    throw new GuardError("PREFLIGHT_FAILED", pf.output.trim() || "mise run preflight failed.");
  }
  // Preflight is check-only (EXC-462) and must leave the tree untouched. If
  // any tracked file outside the release's manifest+changelog set drifted
  // anyway, committing only the release set would silently drop that change —
  // abort so a human sorts it out first.
  const drifted = await offendingPaths(deps, [...MANIFESTS, CHANGELOG_PATH]);
  if (drifted.length > 0) {
    throw new GuardError(
      "PREFLIGHT_DIRTY",
      `Working tree drifted outside the release set during preflight (${drifted.join(", ")}); resolve it on a normal PR before releasing.`,
    );
  }
}

/** Commit the release set (resume-aware: skip if nothing to commit). */
async function commitRelease(deps: Deps, title: string, apply: boolean): Promise<boolean> {
  const dirty = await deps.git.porcelainStatus();
  if (dirty.length === 0) {
    deps.io.log("Nothing to commit; bump already committed.");
    return false;
  }
  if (apply) {
    await deps.git.stage([...MANIFESTS, CHANGELOG_PATH]);
    await deps.git.commit(title);
    return true;
  }
  deps.io.log(`Would commit "${title}".`);
  return false;
}

/** Push the release branch (resume-aware: skip if up to date; never force-push). */
async function pushReleaseBranch(
  deps: Deps,
  ctx: ReleaseContext,
  apply: boolean,
): Promise<boolean> {
  if (!(await deps.git.remoteBranchExists(ctx.releaseBranch))) {
    if (apply) {
      await deps.git.pushBranch(ctx.releaseBranch, true);
      return true;
    }
    deps.io.log(`Would push -u ${ctx.releaseBranch}.`);
    return false;
  }
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
      return true;
    }
    deps.io.log(`Would push ${ctx.releaseBranch}.`);
    return false;
  }
  deps.io.log(`${ctx.releaseBranch} already pushed and up to date.`);
  return false;
}

const OPEN: PrState = "OPEN";
const MERGED: PrState = "MERGED";
const CLOSED: PrState = "CLOSED";

/** Open the PR (resume-aware: reuse an open one, refuse on a merged/closed one). */
async function ensurePr(
  deps: Deps,
  ctx: ReleaseContext,
  title: string,
  defaultBranch: string,
  apply: boolean,
): Promise<{ prNumber: number | null; prUrl: string | null }> {
  const prs = await deps.github.prList({ head: ctx.releaseBranch });
  const open = prs.find((p) => p.state === OPEN);
  const merged = prs.find((p) => p.state === MERGED);
  const closed = prs.find((p) => p.state === CLOSED);
  if (open) {
    deps.io.log(`Reusing open PR #${open.number}.`);
    return { prNumber: open.number, prUrl: open.url };
  }
  if (merged) {
    throw new GuardError("ALREADY_MERGED", "Release PR already merged; run `finalize`.");
  }
  if (closed) {
    throw new GuardError(
      "PR_CLOSED",
      "Release PR was closed unmerged; reopen or delete the branch.",
    );
  }
  if (apply) {
    const pr = await deps.github.prCreate({
      head: ctx.releaseBranch,
      base: defaultBranch,
      title,
      body: prBody(ctx.version, title),
    });
    return { prNumber: pr.number, prUrl: pr.url };
  }
  deps.io.log(`Would open a PR for ${ctx.releaseBranch}.`);
  return { prNumber: null, prUrl: null };
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

  const title = await composeTitle(deps, ctx);
  await resolveReleaseBranch(deps, ctx, apply);
  await bumpManifests(deps, ctx, apply);
  await gatePreflight(deps, apply);
  const committed = await commitRelease(deps, title, apply);
  const pushed = await pushReleaseBranch(deps, ctx, apply);
  const { prNumber, prUrl } = await ensurePr(deps, ctx, title, defaultBranch, apply);

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
