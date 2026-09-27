// Thin `gh` CLI shell-outs behind the GitHubOps interface, mirroring git.ts: the
// interface lets steps.ts be driven by fakes in tests, while createGitHub() is
// the real implementation. The script never reads or passes tokens — it relies
// on the operator's existing `gh` auth.

import { $ } from "bun";

// Each must match .github/workflows/publish.yml; release-workflow.test.ts pins them.
export const PUBLISH_WORKFLOW = "publish.yml";
/** The stage job's id. The job must not set `name:`: `stageId` matches
 * `gh run view --json jobs` by display name. */
export const STAGE_JOB = "stage";
export const STAGE_ID_ANNOTATION = "npm-stage-id";

/** A publish workflow run as `gh run list` reports it. */
export interface PublishRun {
  id: number;
  url: string;
  status: string;
  /** `""` until `status` is `"completed"`. */
  conclusion: string;
  headSha: string;
}

/** The PR states gh reports, uppercase end to end. */
export type PrState = "OPEN" | "CLOSED" | "MERGED";

export interface PullRequestSummary {
  number: number;
  url: string;
  state: PrState;
}

export interface GitHubOps {
  available(): Promise<boolean>;
  repoSlug(): Promise<string>;
  defaultBranch(): Promise<string>;
  prCreate(opts: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<{ number: number; url: string }>;
  /** Every PR for a head branch, across all states; callers filter on `PrState`. */
  prList(opts: { head: string }): Promise<PullRequestSummary[]>;
  /** The release for a tag, or null if none exists. */
  releaseView(tag: string): Promise<{ url: string; isDraft: boolean } | null>;
  /** Create the release as a draft; `releasePublish` makes it public. */
  releaseCreate(opts: { tag: string; title: string; notes: string }): Promise<{ url: string }>;
  /** Replace the notes body of an existing release (leaves the title alone). */
  releaseEdit(opts: { tag: string; notes: string }): Promise<void>;
  /** Publish a draft release; returns its (post-publish) URL. */
  releasePublish(tag: string): Promise<string>;
  /** The latest push-triggered publish run for a commit, or null if none exists. */
  publishRun(sha: string): Promise<PublishRun | null>;
  /** The stage id the run's stage job annotated, or null if it has none. */
  stageId(runId: number): Promise<string | null>;
}

/** PR number from a `.../pull/<n>` URL, or 0 if it can't be parsed. */
function prNumberFromUrl(url: string): number {
  const m = /\/pull\/(\d+)/.exec(url);
  return m?.[1] !== undefined ? Number(m[1]) : 0;
}

/** Constructs the real, gh-backed GitHubOps. */
export function createGitHub(): GitHubOps {
  return {
    async available() {
      const r = await $`gh --version`.nothrow().quiet();
      return r.exitCode === 0;
    },

    async repoSlug() {
      return (await $`gh repo view --json nameWithOwner -q .nameWithOwner`.text()).trim();
    },

    async defaultBranch() {
      return (
        await $`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.text()
      ).trim();
    },

    async prCreate({ head, base, title, body }) {
      const url = (
        await $`gh pr create --head ${head} --base ${base} --title ${title} --body ${body}`.text()
      ).trim();
      return { number: prNumberFromUrl(url), url };
    },

    async prList({ head }) {
      const out = (
        await $`gh pr list --head ${head} --state all --json number,url,state`.text()
      ).trim();
      if (out === "") return [];
      return JSON.parse(out) as PullRequestSummary[];
    },

    async releaseView(tag) {
      const r = await $`gh release view ${tag} --json url,isDraft`.nothrow().quiet();
      if (r.exitCode !== 0) return null;
      return JSON.parse(r.text().trim()) as { url: string; isDraft: boolean };
    },

    async releaseCreate({ tag, title, notes }) {
      const url = (
        await $`gh release create ${tag} --draft --title ${title} --notes ${notes}`.text()
      ).trim();
      return { url };
    },

    async releaseEdit({ tag, notes }) {
      await $`gh release edit ${tag} --notes ${notes}`.quiet();
    },

    async releasePublish(tag) {
      await $`gh release edit ${tag} --draft=false`.quiet();
      // A draft's URL is an untagged-… placeholder; re-read for the public one.
      const view = await this.releaseView(tag);
      if (view === null) throw new Error(`Release ${tag} vanished after publishing.`);
      return view.url;
    },

    async publishRun(sha) {
      const out =
        await $`gh run list --workflow ${PUBLISH_WORKFLOW} --commit ${sha} --event push --json databaseId,url,status,conclusion,headSha --limit 1`.text();
      const [run] = JSON.parse(out) as (Omit<PublishRun, "id"> & { databaseId: number })[];
      if (run === undefined) return null;
      const { databaseId, ...rest } = run;
      return { id: databaseId, ...rest };
    },

    async stageId(runId) {
      const jobId = (
        await $`gh run view ${runId} --json jobs --jq ${`.jobs[] | select(.name=="${STAGE_JOB}") | .databaseId`}`.text()
      ).trim();
      if (jobId === "") return null;
      const id = (
        await $`gh api ${`repos/{owner}/{repo}/check-runs/${jobId}/annotations`} --jq ${`.[] | select(.title=="${STAGE_ID_ANNOTATION}") | .message`}`.text()
      ).trim();
      return id === "" ? null : id;
    },
  };
}
