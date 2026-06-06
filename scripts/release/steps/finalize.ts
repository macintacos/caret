// finalize (phase 2): tag trunk's merged HEAD and publish the GitHub Release.
// It derives the version from trunk's changelog, verifies the manifests on trunk
// match it (the bump is actually merged), and is resume-aware — reusing an
// existing release and never moving an existing tag.

import { composeReleaseTitle, findSection, findTopReleasedVersion } from "../changelog.ts";
import { extractVersion } from "../manifest.ts";
import { tagName } from "../version.ts";
import { CHANGELOG_PATH, type FinalizeResult, MANIFESTS } from "./context.ts";
import type { Deps } from "./deps.ts";
import { assertCleanTree, assertRepoAndGh, GuardError, syncedVersion } from "./guards.ts";

/** Phase 2: tag trunk's merged HEAD and publish the GitHub Release. */
export async function finalize(deps: Deps, opts: { dryRun: boolean }): Promise<FinalizeResult> {
  const { defaultBranch } = await assertRepoAndGh(deps);
  // No branch guard here: finalize tags origin/trunk's HEAD (derived after the
  // unconditional fetch below), so the local working branch is irrelevant. After
  // phase 1, `prepare` leaves the checkout on release/vX.Y.Z — guarding the branch
  // here would reject every phase-2 entry. The real publish-safety gates are the
  // clean-tree check and the NOT_MERGED triple-check below.
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
