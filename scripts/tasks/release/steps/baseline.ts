// baseline: the one-time bootstrap that tags the repository's initial commit as
// v0.0.1 so the first real release has a range to bump from. Idempotent — a
// no-op once the tag exists locally or on the remote.

import { BASELINE_TAG, type BaselineResult } from "@/tasks/release/steps/context.ts";
import type { Deps } from "@/tasks/release/steps/deps.ts";
import { GuardError } from "@/tasks/release/steps/guards.ts";

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
