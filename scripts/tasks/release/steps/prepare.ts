// prepare (phase 1): bump the manifests, regenerate the changelog page with the
// new release's notes, commit them, push the release branch, and open the PR. Every
// sub-phase is resume-aware so the whole step is safe to re-run after a partial
// failure: it detects an existing branch, an already-bumped manifest, a committed
// bump, an up-to-date remote, and an open PR, skipping or no-oping rather than
// crashing. The body below sequences the sub-phases; each is a named helper so the
// flow reads as its phases.

import { CHANGELOG_PAGE, renderChangelog } from "@/tasks/release/changelog.ts";
import type { PrState } from "@/tasks/release/github.ts";
import { editVersion, extractVersion } from "@/tasks/release/manifest.ts";
import {
  gatherContext,
  MANIFESTS,
  type PrepareResult,
  type ReleaseContext,
} from "@/tasks/release/steps/context.ts";
import type { Deps } from "@/tasks/release/steps/deps.ts";
import {
  assertBranch,
  assertCleanTree,
  assertNotesFile,
  assertRepoAndGh,
  GuardError,
} from "@/tasks/release/steps/guards.ts";
import type { BumpLevel } from "@/tasks/release/version.ts";

/** The paths a release commit carries. */
const RELEASE_SET = [...MANIFESTS, CHANGELOG_PAGE];

/** The release PR body: a "What changed" summary and a "What to test" checklist. */
function prBody(version: string): string {
  return [
    "## What changed",
    "",
    `Bumps the version to ${version} across package.json and the two .claude-plugin manifests, and adds its notes to the docs site's changelog page.`,
    "",
    "## What to test",
    "",
    "- `mise run preflight` passes on the release branch.",
    "- All three manifests reflect the new version.",
    `- \`${CHANGELOG_PAGE}\` opens with ${version}'s notes.`,
  ].join("\n");
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

/** Regenerate the changelog page from the published releases plus this one, so the
 * page reaches main before the tag push that deploys the site. Rewriting the whole page
 * keeps it a mirror of the Releases and a re-run byte-identical. */
async function writeChangelog(
  deps: Deps,
  ctx: ReleaseContext,
  notesFile: string,
  apply: boolean,
): Promise<void> {
  if (!apply) {
    deps.io.log(`Would add ${ctx.tag} to ${CHANGELOG_PAGE}.`);
    return;
  }
  const release = { tag: ctx.tag, publishedAt: deps.now(), notes: await deps.fs.read(notesFile) };
  const page = renderChangelog(ctx.repoSlug, [release, ...(await deps.github.publishedReleases())]);
  await deps.fs.write(CHANGELOG_PAGE, await deps.rumdl.formatPage(page, CHANGELOG_PAGE));
}

/** Commit the release set (resume-aware: skip if nothing to commit). */
async function commitRelease(deps: Deps, title: string, apply: boolean): Promise<boolean> {
  const dirty = await deps.git.porcelainStatus();
  if (dirty.length === 0) {
    deps.io.log("Nothing to commit; bump already committed.");
    return false;
  }
  if (apply) {
    await deps.git.stage(RELEASE_SET);
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
      body: prBody(ctx.version),
    });
    return { prNumber: pr.number, prUrl: pr.url };
  }
  deps.io.log(`Would open a PR for ${ctx.releaseBranch}.`);
  return { prNumber: null, prUrl: null };
}

/** Phase 1: bump the manifests, add the release to the changelog page, commit them,
 * push the branch, open a PR. */
export async function prepare(
  deps: Deps,
  opts: { bump: BumpLevel; dryRun: boolean; notesFile: string },
): Promise<PrepareResult> {
  const apply = !opts.dryRun;
  const { repoSlug, defaultBranch } = await assertRepoAndGh(deps);
  await assertBranch(deps, defaultBranch, { allowPrefixes: ["release/"] });
  await assertCleanTree(deps, RELEASE_SET);
  await assertNotesFile(deps, opts.notesFile);
  const ctx = await gatherContext(deps, opts.bump, repoSlug, defaultBranch);

  const title = ctx.tag;
  await resolveReleaseBranch(deps, ctx, apply);
  await bumpManifests(deps, ctx, apply);
  await writeChangelog(deps, ctx, opts.notesFile, apply);
  // No preflight gate here: release deliberately does not run `mise run preflight`
  // (verify locally before releasing). Don't re-add it — flaky-test churn was
  // blocking releases for no gain the operator can't get by running it themselves.
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
