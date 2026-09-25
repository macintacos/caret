// What the caret the user is behind would bring (EXC-1452): the skipped releases for a
// bundle, the trunk commits since the build for a binary. Pure selection over GitHub's
// bodies, plus a runner that fetches only when asked — the What's new modal opening —
// and holds the last good answer for as long as the served verdict is the same object.

import type { CaretLogger } from "@/lib/log.ts";
import { isNewer } from "@/lib/semver.ts";
import type {
  BuildKind,
  ReleaseNote,
  TrunkCommit,
  UpdateChanges,
  UpdateStatus,
} from "@/lib/types.ts";
import type { GitHubCommit, GitHubRelease, TrunkComparison } from "@/lib/upstream.ts";

/** The most commits the modal lists; the rest are counted in `more`. */
export const COMMIT_CAP = 50;

/** Strict, so a `-rc` tag can never pass for a release. */
const RELEASE_TAG = /^v?\d+\.\d+\.\d+$/;
/** The sha keys the UI's commit list, so only a validated GitHub value reaches the page. */
const FULL_SHA = /^[0-9a-f]{40}$/;
const COMPARABLE_COMMIT = /^[0-9a-f]{7,40}$/;

/** Every effect createUpdateChanges performs, injected so tests run without GitHub. */
export interface UpdateChangesDeps {
  install: BuildKind;
  version: string;
  commit: string;
  /** The served verdict — `updateReportFor(...).status`, so the opt-out reads `disabled`. */
  status: () => UpdateStatus;
  releases: () => Promise<GitHubRelease[] | null>;
  /** At most 250 commits — the newest when truncated — oldest first, plus `total_commits`. */
  compare: (commit: string) => Promise<TrunkComparison | null>;
  log: CaretLogger;
}

/** The published releases in (running, target], newest first. */
export function selectReleases(
  releases: readonly GitHubRelease[],
  running: string,
  target: string,
): ReleaseNote[] {
  return releases
    .filter((r) => !r.draft && !r.prerelease && RELEASE_TAG.test(r.tag_name))
    .map((r) => ({ version: r.tag_name.replace(/^v/, ""), body: r.body ?? "" }))
    .filter((r) => isNewer(r.version, running) && !isNewer(r.version, target))
    .sort((a, b) => (isNewer(a.version, b.version) ? -1 : isNewer(b.version, a.version) ? 1 : 0));
}

/** The newest `cap` well-formed commits, and how many of `total` go unshown. */
export function selectCommits(
  newestFirst: readonly GitHubCommit[],
  total: number,
  cap: number,
): { kind: "commits"; commits: TrunkCommit[]; more: number } {
  const commits = newestFirst
    .filter((c) => FULL_SHA.test(c.sha))
    .slice(0, cap)
    .map((c) => {
      const subject = c.commit.message.split("\n", 1)[0] ?? "";
      return { sha: c.sha, subject, pr: prNumber(subject) };
    });
  return { kind: "commits", commits, more: Math.max(0, total - commits.length) };
}

/** The PR a squash-merge subject ends with — `Fix thing (#123)` → 123. */
export function prNumber(subject: string): number | null {
  const match = /\(#(\d+)\)$/.exec(subject);
  return match ? Number(match[1]) : null;
}

/** A thunk answering GET /api/update/changes. One slot, keyed by the identity of the
 * served status object: a settled check assigns a fresh object, so it always misses,
 * even when its JSON is unchanged (a binary's trunk target moves under the same
 * verdict). That relies on `updateReportFor` returning the held status by reference.
 * The promise is stored so concurrent opens share one fetch; a null, or a rejection
 * mapped to null, clears the slot so the next open retries.
 *
 * ponytail: memory only, so an idle-exit costs one fetch on the next open; persist
 * beside update-check.json if the 60/h rate limit ever strains. */
export function createUpdateChanges(deps: UpdateChangesDeps): () => Promise<UpdateChanges | null> {
  let slot: { status: UpdateStatus; promise: Promise<UpdateChanges | null> } | null = null;
  return () => {
    const status = deps.status();
    if (slot?.status === status) return slot.promise;
    const promise = changesFor(deps, status)
      .catch(() => failed(deps.log))
      .then((changes) => {
        if (changes === null && slot?.promise === promise) slot = null;
        return changes;
      });
    slot = { status, promise };
    return promise;
  };
}

async function changesFor(
  deps: UpdateChangesDeps,
  status: UpdateStatus,
): Promise<UpdateChanges | null> {
  if (deps.install === "bundle" && status.kind === "behind-release") {
    const releases = await deps.releases();
    if (!releases) return failed(deps.log);
    return { kind: "releases", releases: selectReleases(releases, deps.version, status.available) };
  }
  const behind = status.kind === "behind-release" || status.kind === "behind-commit";
  if (deps.install !== "binary" || !behind || !COMPARABLE_COMMIT.test(deps.commit)) return null;

  const comparison = await deps.compare(deps.commit);
  if (!comparison) return failed(deps.log);
  return selectCommits([...comparison.commits].reverse(), comparison.total_commits, COMMIT_CAP);
}

function failed(log: CaretLogger): null {
  log.warn("update", "update changes read failed");
  return null;
}
