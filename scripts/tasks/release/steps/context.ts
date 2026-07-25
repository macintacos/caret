// The release-pipeline constants, the per-step Result shapes, and the
// ReleaseContext the prepare/compute steps share. gatherContext resolves the
// version from the latest tag — never from an agent-supplied value — so the
// "agent never invents the version" guarantee holds; readSyncedVersion reads the
// manifests' current version, raising MANIFEST_DRIFT on disagreement.

import { extractVersion } from "@/tasks/release/manifest.ts";
import type { Deps } from "@/tasks/release/steps/deps.ts";
import { GuardError, syncedVersion } from "@/tasks/release/steps/guards.ts";
import { type BumpLevel, nextVersion, tagName, versionFromTag } from "@/tasks/release/version.ts";

/** The baseline tag placed on the repository's initial commit. */
export const BASELINE_TAG = "v0.0.1";

/** The version-bearing files prepare/finalize mutate, in mutation order. */
export const MANIFESTS = [
  "package.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
];

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
  /** Whether this run published the package to npm (false on dry runs and when
   * the version was already on the registry). */
  npmPublished: boolean;
  dryRun: boolean;
}

/** The current, synced version across all manifests; raises MANIFEST_DRIFT if they disagree. */
export async function readSyncedVersion(deps: Deps): Promise<string> {
  const entries: { file: string; version: string }[] = [];
  for (const file of MANIFESTS) {
    entries.push({ file, version: extractVersion(await deps.fs.read(file)) });
  }
  return syncedVersion(entries);
}

export interface ReleaseContext {
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

/**
 * Assemble the ReleaseContext for compute/prepare: resolve the previous/next
 * versions and tags from the latest release tag (never an agent-supplied value),
 * read the current synced manifest version, and reject if the target tag exists.
 */
export async function gatherContext(
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
