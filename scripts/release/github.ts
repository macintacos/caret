// Thin `gh` CLI shell-outs behind the GitHubOps interface, mirroring git.ts: the
// interface lets steps.ts be driven by fakes in tests, while createGitHub() is
// the real implementation. The script never reads or passes tokens — it relies
// on the operator's existing `gh` auth.

import { $ } from "bun";

export interface PullRequestSummary {
  number: number;
  url: string;
  /** gh reports "OPEN" | "CLOSED" | "MERGED". */
  state: string;
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
  prList(opts: {
    head: string;
    state: "open" | "closed" | "merged" | "all";
  }): Promise<PullRequestSummary[]>;
  /** The release for a tag, or null if none exists. */
  releaseView(tag: string): Promise<{ url: string } | null>;
  releaseCreate(opts: { tag: string; title: string; notes: string }): Promise<{ url: string }>;
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

    async prList({ head, state }) {
      const out = (
        await $`gh pr list --head ${head} --state ${state} --json number,url,state`.text()
      ).trim();
      if (out === "") return [];
      return JSON.parse(out) as PullRequestSummary[];
    },

    async releaseView(tag) {
      const r = await $`gh release view ${tag} --json url`.nothrow().quiet();
      if (r.exitCode !== 0) return null;
      return JSON.parse(r.text().trim()) as { url: string };
    },

    async releaseCreate({ tag, title, notes }) {
      const url = (
        await $`gh release create ${tag} --title ${title} --notes ${notes}`.text()
      ).trim();
      return { url };
    },
  };
}
