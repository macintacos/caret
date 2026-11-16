import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rename, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PLAN_REJECTED_MESSAGE } from "@/config/constants.ts";
import type { Decision, PlanVersion, ReviewStatus, Verdict } from "@/lib/types.ts";
import { createReviewStats } from "@/review/stats.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-stats-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const stats = (from = dir) => createReviewStats(from)();

/** A version carrying `inline` line comments, a general comment and a verdict when given. */
function version(n: number, inline: number, generalComment?: string, verdict?: Verdict) {
  const annotations = Array.from({ length: inline }, (_, i) => ({
    id: `a${n}-${i}`,
    startLine: 1,
    endLine: 1,
    comment: "why?",
  }));
  return {
    version: n,
    plan: "# Plan",
    annotations,
    generalComment,
    verdict,
    createdAt: n,
  } satisfies PlanVersion;
}

async function writeReview(
  id: string,
  status: ReviewStatus,
  versions: PlanVersion[],
  decision?: Decision,
  at = dir,
) {
  const review = { id, sessionId: "s", cwd: "/p", title: "Plan", status, versions, decision };
  await writeFile(
    join(at, `${id}.json`),
    JSON.stringify({ ...review, createdAt: 1, updatedAt: 1 }),
  );
}

const allow: Decision = { behavior: "allow", decidedAt: 1 };
const deny = (feedback: string): Decision => ({ behavior: "deny", feedback, decidedAt: 1 });
const reject = deny(PLAN_REJECTED_MESSAGE);

test("counts the reviews whose plan was approved", async () => {
  await writeReview("a", "approved", [version(1, 0, undefined, "approve")], allow);
  await writeReview("b", "approved", [version(1, 0, undefined, "approve")], allow);
  await writeReview("c", "rejected", [version(1, 0, undefined, "reject")], reject);
  await writeReview("d", "expired", [version(1, 0)]);
  expect(stats().approved).toBe(2);
});

test("counts each verdict stamped on a version", async () => {
  await writeReview(
    "a",
    "approved",
    [version(1, 2, "rework", "request-changes"), version(2, 1, "ship it", "approve")],
    allow,
  );
  await writeReview("b", "rejected", [version(1, 3, undefined, "reject")], reject);
  expect(stats()).toEqual({ approved: 1, rejected: 1, revisions: 1, comments: 5 });
});

test("keeps counting a Reject after the session's next plan clears the decision", async () => {
  await writeReview("a", "pending", [version(1, 0, undefined, "reject"), version(2, 0)]);
  expect(stats()).toMatchObject({ rejected: 1, revisions: 1 });
});

test("counts none of the comments drafted on a version Reject closed", async () => {
  await writeReview("a", "rejected", [version(1, 2, undefined, "reject")], reject);
  expect(stats().comments).toBe(0);
});

test("infers the verdicts of a record that predates the stamp", async () => {
  await writeReview("approved", "approved", [version(1, 1), version(2, 1, "ok")], allow);
  await writeReview("rejected", "rejected", [version(1, 4)], reject);
  await writeReview("changes", "rejected", [version(1, 1, "split")], deny("split\n\n…"));
  expect(stats()).toEqual({ approved: 1, rejected: 1, revisions: 1, comments: 5 });
});

test("leaves out the comments on a version no decision has closed", async () => {
  await writeReview("waiting", "pending", [version(1, 1, "rework"), version(2, 3)]);
  await writeReview("abandoned", "expired", [version(1, 4)]);
  expect(stats().comments).toBe(2);
});

test("recognizes a Reject recorded before versions carried a verdict", async () => {
  expect(stats(join(import.meta.dir, "fixtures"))).toMatchObject({ rejected: 1 });
});

test("skips a file that isn't a review", async () => {
  await writeReview("a", "approved", [version(1, 1)], allow);
  await writeFile(join(dir, "partial.json"), '{"status": "approved", "vers');
  await writeFile(join(dir, "other.json"), JSON.stringify({ status: "approved" }));
  expect(stats()).toEqual({ approved: 1, rejected: 0, revisions: 0, comments: 1 });
});

test("reads only the .json files, not an atomic write's temp", async () => {
  await writeReview("a", "approved", [version(1, 1)], allow);
  await writeReview("b", "approved", [version(1, 1)], allow);
  await rename(join(dir, "b.json"), join(dir, "b.json.tmp.123"));
  expect(stats()).toEqual({ approved: 1, rejected: 0, revisions: 0, comments: 1 });
});

test("counts nothing before the first review writes the folder", () => {
  expect(stats(join(dir, "never-created"))).toEqual({
    approved: 0,
    rejected: 0,
    revisions: 0,
    comments: 0,
  });
});

test("follows files rewritten, removed and added between calls", async () => {
  const read = createReviewStats(dir);
  await writeReview("a", "pending", [version(1, 0)]);
  await writeReview("b", "approved", [version(1, 0)], allow);
  expect(read()).toMatchObject({ approved: 1, revisions: 0 });

  await writeReview("a", "pending", [version(1, 0), version(2, 0)]);
  await utimes(join(dir, "a.json"), 1, 1);
  await rm(join(dir, "b.json"));
  await writeReview("c", "approved", [version(1, 0), version(2, 0)], allow);
  expect(read()).toMatchObject({ approved: 1, revisions: 2 });
});
