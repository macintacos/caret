// What's new (EXC-1452): which releases or commits the modal describes, and when the
// daemon goes to GitHub for them.

import { expect, test } from "bun:test";

import {
  COMMIT_CAP,
  createUpdateChanges,
  prNumber,
  selectReleases,
  type UpdateChangesDeps,
} from "@/daemon/update-changes.ts";
import { updateReportFor } from "@/daemon/update-check.ts";
import { noopLogger } from "@/lib/log.ts";
import type { UpdateStatus } from "@/lib/types.ts";
import type { GitHubCommit, GitHubRelease } from "@/lib/upstream.ts";

const release = (tag_name: string, extra: Partial<GitHubRelease> = {}): GitHubRelease => ({
  tag_name,
  body: `notes ${tag_name}`,
  draft: false,
  prerelease: false,
  ...extra,
});

const sha = (n: number) => n.toString(16).padStart(40, "0");
const commit = (n: number, message = `change ${n}`): GitHubCommit => ({
  sha: sha(n),
  commit: { message },
});
/** `n` commits, oldest first, as the compare endpoint lists them. */
const oldestFirst = (n: number) => Array.from({ length: n }, (_, i) => commit(i + 1));

const BEHIND_RELEASE: UpdateStatus = { kind: "behind-release", available: "1.2.0", command: "c" };
const BEHIND_COMMIT: UpdateStatus = { kind: "behind-commit", aheadBy: 3, command: "c" };

/** Deps whose every read is counted; overrides replace any field. */
function deps(over: Partial<UpdateChangesDeps> = {}) {
  const calls = { releases: 0, compare: 0 };
  const d: UpdateChangesDeps = {
    install: "bundle",
    version: "1.0.0",
    commit: "abc1234",
    status: () => BEHIND_RELEASE,
    releases: async () => {
      calls.releases++;
      return [release("v1.2.0"), release("v1.1.0"), release("v1.0.0")];
    },
    compare: async () => {
      calls.compare++;
      return { total_commits: 3, commits: oldestFirst(3) };
    },
    log: noopLogger,
    ...over,
  };
  return {
    calls,
    get: createUpdateChanges(d),
    fetches: () => calls.releases + calls.compare,
  };
}

test("releases are those in (running, target], newest first, strict and published only", () => {
  const got = selectReleases(
    [
      release("v1.0.0"),
      release("1.1.0", { body: null }),
      release("v1.3.0"),
      release("v1.2.0"),
      release("v1.1.5", { draft: true }),
      release("v1.1.6", { prerelease: true }),
      release("v1.1.0-rc.1"),
    ],
    "1.0.0",
    "1.2.0",
  );
  expect(got).toEqual([
    { version: "1.2.0", body: "notes v1.2.0" },
    { version: "1.1.0", body: "" },
  ]);
});

test("a bundle behind a release gets the skipped release notes", async () => {
  expect(await deps().get()).toEqual({
    kind: "releases",
    releases: [
      { version: "1.2.0", body: "notes v1.2.0" },
      { version: "1.1.0", body: "notes v1.1.0" },
    ],
  });
});

test("a binary gets trunk's commits on either behind verdict, newest first", async () => {
  for (const status of [BEHIND_RELEASE, BEHIND_COMMIT]) {
    const got = await deps({ install: "binary", status: () => status }).get();
    expect(got).toEqual({
      kind: "commits",
      commits: [3, 2, 1].map((n) => ({ sha: sha(n), subject: `change ${n}`, pr: null })),
      more: 0,
    });
  }
});

test("commits are capped with the remainder counted in `more`", async () => {
  const { get } = deps({
    install: "binary",
    status: () => BEHIND_COMMIT,
    compare: async () => ({ total_commits: 60, commits: oldestFirst(60) }),
  });
  const got = await get();
  if (got?.kind !== "commits") throw new Error("expected commits");
  expect(got.commits).toHaveLength(COMMIT_CAP);
  expect(got.commits[0]?.sha).toBe(sha(60));
  expect(got.more).toBe(10);
});

test("a truncated compare (GitHub's newest 250) is listed newest first in one request", async () => {
  const newest250 = Array.from({ length: 250 }, (_, i) => commit(i + 51));
  let reads = 0;
  const { get } = deps({
    install: "binary",
    status: () => BEHIND_COMMIT,
    compare: async () => {
      reads++;
      return { total_commits: 300, commits: newest250 };
    },
  });
  const got = await get();
  if (got?.kind !== "commits") throw new Error("expected commits");
  expect(got.commits[0]?.sha).toBe(sha(300));
  expect(got.commits).toHaveLength(COMMIT_CAP);
  expect(got.more).toBe(300 - COMMIT_CAP);
  expect(reads).toBe(1);
});

test("a rejected read answers null and is retried on the next open", async () => {
  let reads = 0;
  const { get } = deps({
    releases: async () => {
      reads++;
      throw new Error("boom");
    },
  });
  expect(await get()).toBeNull();
  expect(await get()).toBeNull();
  expect(reads).toBe(2);
});

test("the real served verdict keeps its identity, so two opens make one fetch", async () => {
  const held: UpdateStatus = BEHIND_RELEASE;
  const id = { install: "bundle" as const, version: "1.0.0", commit: "abc1234" };
  const { get, fetches } = deps({ status: () => updateReportFor(id, held, true).status });
  await get();
  await get();
  expect(fetches()).toBe(1);
});

test("a squash subject's (#N) is its PR; the subject is the first line; bad shas drop", async () => {
  expect(prNumber("Fix it (#12)")).toBe(12);
  expect(prNumber("Fix it")).toBeNull();
  const { get } = deps({
    install: "binary",
    status: () => BEHIND_COMMIT,
    compare: async () => ({
      total_commits: 2,
      commits: [commit(1, "Fix it (#12)\n\nbody"), { sha: "nothex", commit: { message: "x" } }],
    }),
  });
  expect(await get()).toEqual({
    kind: "commits",
    commits: [{ sha: sha(1), subject: "Fix it (#12)", pr: 12 }],
    more: 1,
  });
});

test("nothing to describe makes zero fetches and answers null", async () => {
  const statuses: UpdateStatus[] = [
    { kind: "unavailable", reason: "dev" },
    { kind: "unavailable", reason: "disabled" },
    { kind: "current" },
    { kind: "unknown", reason: "x" },
  ];
  for (const install of ["bundle", "binary"] as const) {
    for (const status of statuses) {
      const d = deps({ install, status: () => status });
      expect(await d.get()).toBeNull();
      expect(d.fetches()).toBe(0);
    }
  }
  const noCommit = deps({ install: "binary", commit: "unknown" });
  expect(await noCommit.get()).toBeNull();
  expect(noCommit.fetches()).toBe(0);
});

test("a repeat call for the same status object makes no request", async () => {
  const d = deps();
  await d.get();
  await d.get();
  expect(d.fetches()).toBe(1);
});

test("concurrent calls share one request", async () => {
  const d = deps();
  await Promise.all([d.get(), d.get()]);
  expect(d.fetches()).toBe(1);
});

test("a failed read is not cached", async () => {
  let fail = true;
  const d = deps({ releases: async () => (fail ? null : [release("v1.2.0")]) });
  expect(await d.get()).toBeNull();
  fail = false;
  expect(await d.get()).not.toBeNull();
});

test("a re-settled check with equal JSON refetches", async () => {
  let status: UpdateStatus = { ...BEHIND_RELEASE };
  const d = deps({ status: () => status });
  await d.get();
  status = { ...BEHIND_RELEASE };
  await d.get();
  expect(d.fetches()).toBe(2);
});
