// finalize (phase 2): tag trunk's merged HEAD and publish the GitHub Release.
// It derives the version from trunk's three manifests and proves the bump
// actually merged by requiring that version to be ahead of the latest release
// tag, and is resume-aware — reusing an existing release and never moving an
// existing tag. The themed title and the release body are prose only the agent
// can write, so they arrive as `--title` and `--notes-file`; the body is
// reflowed to single-line paragraphs so it renders cleanly on GitHub.

import { extractVersion } from "@/tasks/release/manifest.ts";
import { type FinalizeResult, MANIFESTS } from "@/tasks/release/steps/context.ts";
import type { Deps } from "@/tasks/release/steps/deps.ts";
import {
  assertCleanTree,
  assertRepoAndGh,
  GuardError,
  syncedVersion,
} from "@/tasks/release/steps/guards.ts";
import { composeReleaseTitle, isNewer, tagName, versionFromTag } from "@/tasks/release/version.ts";

/** The finalized release derived from `origin/<defaultBranch>`: the merged HEAD to
 * tag plus the version/tag/title of the release being published. */
interface TrunkRelease {
  trunkSha: string;
  version: string;
  tag: string;
  title: string;
}

/**
 * Resolve the release to finalize from trunk's merged HEAD. The version comes
 * from trunk's three manifests (which must agree), and the bump counts as merged
 * only when that version is strictly ahead of the latest release tag — otherwise
 * `NOT_MERGED`. Never mutates; the tag/release creation is the caller's job.
 */
async function resolveTrunkRelease(
  deps: Deps,
  defaultBranch: string,
  title: string | undefined,
): Promise<TrunkRelease> {
  const trunkRef = `origin/${defaultBranch}`;
  const trunkSha = await deps.git.tryRevParse(trunkRef);
  if (trunkSha === null) {
    throw new GuardError("NOT_MERGED", `Cannot resolve ${trunkRef}.`);
  }

  const entries: { file: string; version: string }[] = [];
  for (const file of MANIFESTS) {
    const c = await deps.git.tryFileAtRef(trunkRef, file);
    if (c === null) throw new GuardError("NOT_MERGED", `${file} missing on trunk.`);
    entries.push({ file, version: extractVersion(c) });
  }
  const version = syncedVersion(entries);

  const latestTag = await deps.git.latestVersionTag();
  if (latestTag === null) {
    throw new GuardError(
      "NO_BASELINE",
      "No release tags yet. Run `mise run release baseline` to tag the initial commit as v0.0.1.",
    );
  }
  if (!isNewer(version, versionFromTag(latestTag))) {
    throw new GuardError(
      "NOT_MERGED",
      `Trunk manifests at ${version}, not ahead of ${latestTag}; bump not merged yet.`,
    );
  }

  return {
    trunkSha,
    version,
    tag: tagName(version),
    title: composeReleaseTitle(version, title?.trim() || null),
  };
}

/**
 * The GitHub Release body: the agent-composed notes file, reflowed to single-line
 * paragraphs (the source is hard-wrapped at ~90 chars, which renders as awkward
 * breaks on GitHub). Re-read from the same file on every call, so a resume
 * produces the same body — never a doubled one. No file, or a blank one, means
 * blank notes and no rumdl spawn.
 */
async function composeReleaseNotes(deps: Deps, notesFile: string | undefined): Promise<string> {
  if (notesFile === undefined) return "";
  if (!(await deps.fs.exists(notesFile))) {
    throw new GuardError("NOTES_MISSING", `Release notes file ${notesFile} does not exist.`);
  }
  const notes = await deps.fs.read(notesFile);
  return notes.trim() === "" ? "" : deps.rumdl.reflow(notes);
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
  opts: { dryRun: boolean; title?: string; notesFile?: string },
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

  const { trunkSha, version, tag, title } = await resolveTrunkRelease(
    deps,
    defaultBranch,
    opts.title,
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
    // Refresh the notes only when a notes file is supplied (idempotent — re-read
    // from that file, so re-running never stacks a body on itself). A notes-less
    // resume leaves the existing notes untouched, so an operator's prior body is
    // never clobbered.
    if (opts.notesFile !== undefined) {
      if (opts.dryRun) {
        deps.io.log(`Would refresh ${tag} release notes.`);
      } else {
        await deps.github.releaseEdit({
          tag,
          notes: await composeReleaseNotes(deps, opts.notesFile),
        });
        deps.io.log(`Refreshed ${tag} release notes.`);
      }
    }
  } else if (opts.dryRun) {
    deps.io.log(`Would tag ${trunkSha} as ${tag}, push it, and create "${title}".`);
    releaseUrl = null;
  } else {
    await ensureTag(deps, tag, trunkSha, title);
    const notes = await composeReleaseNotes(deps, opts.notesFile);
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
