// finalize (phase 2): tag trunk's merged HEAD and publish the GitHub Release.
// It derives the version from trunk's changelog, verifies the manifests on trunk
// match it (the bump is actually merged), and is resume-aware — reusing an
// existing release and never moving an existing tag. The release notes are an
// optional human summary above the changelog section, reflowed to single-line
// paragraphs so they render cleanly on GitHub.

import {
  composeReleaseTitle,
  findSection,
  findTopReleasedVersion,
} from "@/tasks/release/changelog.ts";
import { extractVersion } from "@/tasks/release/manifest.ts";
import { CHANGELOG_PATH, type FinalizeResult, MANIFESTS } from "@/tasks/release/steps/context.ts";
import type { Deps } from "@/tasks/release/steps/deps.ts";
import {
  assertCleanTree,
  assertRepoAndGh,
  GuardError,
  syncedVersion,
} from "@/tasks/release/steps/guards.ts";
import { tagName } from "@/tasks/release/version.ts";

/** The finalized release derived from `origin/<defaultBranch>`: the merged HEAD to
 * tag, the version/tag/title, and the changelog section body used as release notes. */
interface TrunkRelease {
  trunkSha: string;
  version: string;
  tag: string;
  title: string;
  changelogNotes: string;
}

/**
 * Resolve the release to finalize from trunk's merged HEAD. Derives the version
 * from trunk's changelog and triple-checks the bump actually landed (a fresh
 * `origin/<defaultBranch>`, its CHANGELOG.md, and all manifests agreeing on the
 * version), throwing `NOT_MERGED` otherwise. Never mutates — the tag/release
 * creation is the caller's job.
 */
async function resolveTrunkRelease(deps: Deps, defaultBranch: string): Promise<TrunkRelease> {
  const trunkRef = `origin/${defaultBranch}`;
  const trunkSha = await deps.git.tryRevParse(trunkRef);
  if (trunkSha === null) {
    throw new GuardError("NOT_MERGED", `Cannot resolve ${trunkRef}.`);
  }

  const changelog = await deps.git.tryFileAtRef(trunkRef, CHANGELOG_PATH);
  if (changelog === null) {
    throw new GuardError("NOT_MERGED", "No CHANGELOG.md on trunk yet.");
  }
  const version = findTopReleasedVersion(changelog);
  if (version === null) {
    throw new GuardError("NOT_MERGED", "No released section in trunk's changelog.");
  }

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
  return {
    trunkSha,
    version,
    tag: tagName(version),
    title: composeReleaseTitle(version, section?.heading.title ?? null),
    changelogNotes: section?.notes ?? "",
  };
}

/**
 * The GitHub Release body: an optional human summary stacked above the changelog
 * section, reflowed to single-line paragraphs (the changelog is hard-wrapped at
 * ~90 chars on disk, which renders as awkward breaks on GitHub). Regenerated from
 * source on every call, so a resume produces the same body — never a doubled
 * summary. Blank in, blank out (no rumdl spawn).
 */
async function composeReleaseNotes(
  deps: Deps,
  summary: string | undefined,
  changelogNotes: string,
): Promise<string> {
  const composed = summary ? `${summary}\n\n${changelogNotes}` : changelogNotes;
  return composed.trim() === "" ? "" : deps.rumdl.reflow(composed);
}

/** Tag trunk's merged HEAD (resume-aware; never moves an existing tag). */
async function ensureTag(deps: Deps, tag: string, trunkSha: string, title: string): Promise<void> {
  if (await deps.git.remoteTagExists(tag)) return;
  if (!(await deps.git.localTagExists(tag))) {
    await deps.git.createAnnotatedTag(tag, trunkSha, title);
  } else {
    // Dereference to the commit: an annotated tag's own object SHA differs from
    // the commit it points at.
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

/** Phase 2: tag trunk's merged HEAD and publish the GitHub Release. */
export async function finalize(
  deps: Deps,
  opts: { dryRun: boolean; summary?: string },
): Promise<FinalizeResult> {
  const { defaultBranch } = await assertRepoAndGh(deps);
  // No branch guard here: finalize tags origin/trunk's HEAD (derived after the
  // unconditional fetch below), so the local working branch is irrelevant. After
  // phase 1, `prepare` leaves the checkout on release/vX.Y.Z — guarding the branch
  // here would reject every phase-2 entry. The real publish-safety gates are the
  // clean-tree check and the NOT_MERGED triple-check in resolveTrunkRelease.
  await assertCleanTree(deps);

  // Fetch unconditionally (read-only): even a dry run must read a fresh
  // origin/trunk so phase detection and previews reflect a merged PR.
  await deps.git.fetch();

  const { trunkSha, version, tag, title, changelogNotes } = await resolveTrunkRelease(
    deps,
    defaultBranch,
  );

  // Resolve the GitHub release: reuse an existing one, preview it in a dry run,
  // or tag + create it. An existing release no longer returns early — finalize
  // falls through to the npm publish below, so a re-run after a
  // release-created-but-npm-publish-failed partial failure still completes.
  const existing = await deps.github.releaseView(tag);
  let releaseUrl: string | null;
  if (existing !== null) {
    deps.io.log(`Release ${tag} already exists; reusing it.`);
    releaseUrl = existing.url;
    // Refresh the notes only when a summary is supplied (idempotent — regenerated
    // from the changelog, so re-running never stacks the summary on itself). A
    // summary-less resume leaves the existing notes untouched, so an operator's
    // prior summary is never clobbered.
    if (opts.summary) {
      if (opts.dryRun) {
        deps.io.log(`Would refresh ${tag} release notes.`);
      } else {
        await deps.github.releaseEdit({
          tag,
          notes: await composeReleaseNotes(deps, opts.summary, changelogNotes),
        });
        deps.io.log(`Refreshed ${tag} release notes.`);
      }
    }
  } else if (opts.dryRun) {
    deps.io.log(`Would tag ${trunkSha} as ${tag}, push it, and create "${title}".`);
    releaseUrl = null;
  } else {
    await ensureTag(deps, tag, trunkSha, title);
    const notes = await composeReleaseNotes(deps, opts.summary, changelogNotes);
    const release = await deps.github.releaseCreate({ tag, title, notes });
    deps.io.log(`Created release ${tag}.`);
    releaseUrl = release.url;
  }

  // Publish the run-from-source bundle to npm so the marketplace's npm source
  // (`/plugin marketplace add macintacos/caret`) resolves this version (EXC-643).
  // Resume-aware: skip if already on the registry (npm rejects republishing a
  // version). A dry run previews without side effects, like the release dry run
  // above — it does not build or pack.
  let npmPublished = false;
  if (await deps.npm.isVersionPublished(version)) {
    deps.io.log(`npm package ${tag} is already published; skipping publish.`);
  } else if (opts.dryRun) {
    deps.io.log(`Would build the bundle and npm publish ${version}.`);
  } else {
    await deps.npm.publish();
    deps.io.log(`Published ${version} to npm.`);
    npmPublished = true;
  }

  return {
    phase: "finalize",
    version,
    tag,
    title,
    taggedSha: trunkSha,
    releaseUrl,
    npmPublished,
    dryRun: opts.dryRun,
  };
}
