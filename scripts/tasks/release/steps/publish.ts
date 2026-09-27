// publish: make the draft GitHub Release public once npm serves its version, so
// the OpenCode update toast (which reads `releases/latest`) never announces a
// version OpenCode can't install. It targets the newest tag — the one finalize
// pushed — rather than trunk's manifests, which move past the tag.

import { NO_BASELINE_MESSAGE, type PublishResult } from "@/tasks/release/steps/context.ts";
import type { Deps } from "@/tasks/release/steps/deps.ts";
import { assertRepoAndGh, GuardError } from "@/tasks/release/steps/guards.ts";
import { RELEASE_POLL, waitFor } from "@/tasks/release/steps/wait.ts";
import { versionFromTag } from "@/tasks/release/version.ts";

/** Un-draft the newest tag's Release once its version is live on npm. */
export async function publish(deps: Deps, opts: { dryRun: boolean }): Promise<PublishResult> {
  await assertRepoAndGh(deps);
  await deps.git.fetch();
  const tag = await deps.git.latestVersionTag();
  if (tag === null) throw new GuardError("NO_BASELINE", NO_BASELINE_MESSAGE);
  const version = versionFromTag(tag);
  const result = (releaseUrl: string | null): PublishResult => ({
    phase: "publish",
    version,
    tag,
    releaseUrl,
    dryRun: opts.dryRun,
  });

  const release = await deps.github.releaseView(tag);
  if (release === null) {
    throw new GuardError("NO_RELEASE", `No GitHub Release for ${tag}; run \`finalize\` first.`);
  }
  if (!release.isDraft) {
    deps.io.log(`Release ${tag} is already published.`);
    return result(release.url);
  }

  if (opts.dryRun) {
    const live = await deps.npm.isVersionPublished(version);
    deps.io.log(
      `Would wait up to ~7.5 min for npm to serve ${version} ` +
        `(live now: ${live}), then publish the ${tag} Release.`,
    );
    return result(null);
  }

  const { done } = await waitFor({ ...RELEASE_POLL, sleep: deps.sleep }, async () => ({
    done: await deps.npm.isVersionPublished(version),
    value: undefined,
  }));
  if (!done) {
    throw new GuardError("NOT_LIVE", `npm still does not serve ${version}; ${tag} stays a draft.`);
  }
  const url = await deps.github.releasePublish(tag);
  deps.io.log(`Published release ${tag}.`);
  return result(url);
}
