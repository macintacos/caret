import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PLAN_REJECTED_MESSAGE } from "@/config/constants.ts";
import type { Decision, PlanVersion, ReviewStatus } from "@/lib/types.ts";
import { readReviewStats } from "@/review/stats.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-stats-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A version carrying `inline` line comments, and a general comment when one is given. */
function version(n: number, inline: number, generalComment?: string): PlanVersion {
  const annotations = Array.from({ length: inline }, (_, i) => ({
    id: `a${n}-${i}`,
    startLine: 1,
    endLine: 1,
    comment: "why?",
  }));
  return { version: n, plan: "# Plan", annotations, generalComment, createdAt: n };
}

async function writeReview(
  id: string,
  status: ReviewStatus,
  versions: PlanVersion[],
  decision?: Decision,
) {
  const review = { id, sessionId: "s", cwd: "/p", title: "Plan", status, versions, decision };
  await writeFile(
    join(dir, `${id}.json`),
    JSON.stringify({ ...review, createdAt: 1, updatedAt: 1 }),
  );
}

const deny = (feedback: string): Decision => ({ behavior: "deny", feedback, decidedAt: 1 });

test("counts the reviews whose plan was approved", async () => {
  await writeReview("a", "approved", [version(1, 0)]);
  await writeReview("b", "approved", [version(1, 0)]);
  await writeReview("c", "rejected", [version(1, 0)]);
  await writeReview("d", "expired", [version(1, 0)]);
  expect(readReviewStats(dir).approved).toBe(2);
});

test("counts the plans the review page's Reject turned down, not those sent back with changes", async () => {
  await writeReview("a", "rejected", [version(1, 0)], deny(PLAN_REJECTED_MESSAGE));
  await writeReview("b", "rejected", [version(1, 1)], deny("Please split step 2."));
  await writeReview("c", "approved", [version(1, 0)]);
  expect(readReviewStats(dir).rejected).toBe(1);
});

test("counts every version after a plan's first as a revision", async () => {
  await writeReview("a", "approved", [version(1, 0), version(2, 0), version(3, 0)]);
  await writeReview("b", "pending", [version(1, 0), version(2, 0)]);
  await writeReview("c", "approved", [version(1, 0)]);
  expect(readReviewStats(dir).revisions).toBe(3);
});

test("counts every inline and general comment a decision sent", async () => {
  await writeReview("a", "approved", [version(1, 2, "rework"), version(2, 1)]);
  await writeReview("b", "rejected", [version(1, 1, "split this up")]);
  expect(readReviewStats(dir).comments).toBe(6);
});

test("leaves out the comments on a version no decision has closed", async () => {
  await writeReview("waiting", "pending", [version(1, 1, "rework"), version(2, 3)]);
  await writeReview("abandoned", "expired", [version(1, 4)]);
  expect(readReviewStats(dir).comments).toBe(2);
});

test("skips a file that isn't a review, as rehydrate does", async () => {
  await writeReview("a", "approved", [version(1, 1)]);
  await writeFile(join(dir, "partial.json"), '{"status": "approved", "vers');
  await writeFile(join(dir, "other.json"), JSON.stringify({ status: "approved" }));
  expect(readReviewStats(dir)).toEqual({ approved: 1, rejected: 0, revisions: 0, comments: 1 });
});

test("reads only the .json files, not an atomic write's temp", async () => {
  await writeReview("a", "approved", [version(1, 1)]);
  await writeReview("b", "approved", [version(1, 1)]);
  await rename(join(dir, "b.json"), join(dir, "b.json.tmp.123"));
  expect(readReviewStats(dir)).toEqual({ approved: 1, rejected: 0, revisions: 0, comments: 1 });
});

test("counts nothing before the first review writes the folder", () => {
  expect(readReviewStats(join(dir, "never-created"))).toEqual({
    approved: 0,
    rejected: 0,
    revisions: 0,
    comments: 0,
  });
});
