// compute: the read-only version oracle. Computes the next version and the
// commit range since the last release, mutating nothing. The /release-caret
// skill parses its JSON to compose the release notes and detect the phase.

import {
  type CommitInfo,
  type ComputeResult,
  compareUrl,
  parseCommitMeta,
  SCHEMA_VERSION,
} from "@/tasks/release/contract.ts";
import { gatherContext, MANIFESTS } from "@/tasks/release/steps/context.ts";
import type { Deps } from "@/tasks/release/steps/deps.ts";
import { assertBranch, assertCleanTree, assertRepoAndGh } from "@/tasks/release/steps/guards.ts";
import type { BumpLevel } from "@/tasks/release/version.ts";

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
    date: deps.now().toISOString().slice(0, 10),
    commits,
    manifests: MANIFESTS,
  };
}
