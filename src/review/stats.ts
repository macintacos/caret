// Counts over every review kept on disk, for the menubar app's card (GET /api/stats). Read
// from the files, not the store: the store holds only unresolved reviews, and an on-demand
// daemon's memory lasts one idle window.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { PLAN_REJECTED_MESSAGE } from "@/config/constants.ts";
import { readJsonFileSync } from "@/lib/json-file.ts";

export interface ReviewStats {
  /** Reviews whose plan was approved. */
  approved: number;
  /** Reviews the review page's Reject turned down. Request changes sends a plan back
   * instead, and its revisions count below. */
  rejected: number;
  /** Plan versions after each review's first. */
  revisions: number;
  /** Inline and general comments on the versions a decision closed. */
  comments: number;
}

// Only the fields the tally reads, so a record from any caret since these fields existed
// counts.
const CountedReviewSchema = z.object({
  status: z.string(),
  decision: z.object({ feedback: z.string().optional() }).optional(),
  versions: z.array(
    z.object({ annotations: z.array(z.unknown()), generalComment: z.string().optional() }),
  ),
});

type CountedReview = z.infer<typeof CountedReviewSchema>;
type CountedVersion = CountedReview["versions"][number];

/** The versions whose comments reached the agent: each one a revision replaced, and the
 * last once the review is approved or rejected. A pending version's comments are still
 * drafts, and an expired one's were never sent. */
function decidedVersions({ status, versions }: CountedReview): CountedVersion[] {
  return status === "approved" || status === "rejected" ? versions : versions.slice(0, -1);
}

/** Whether Reject decided the review: the deny it sends carries the one fixed message,
 * where Request changes carries the reviewer's own feedback. */
function isRejected({ decision }: CountedReview): boolean {
  return decision?.feedback === PLAN_REJECTED_MESSAGE;
}

function commentCount(version: CountedVersion): number {
  return version.annotations.length + (version.generalComment ? 1 : 0);
}

/** Every review file in `dir`, skipping one that doesn't parse as a review as rehydrate
 * does; none when `dir` doesn't exist yet. */
function readCountedReviews(dir: string): CountedReview[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const parsed = CountedReviewSchema.safeParse(readJsonFileSync(join(dir, name)));
      return parsed.success ? [parsed.data] : [];
    });
}

/** Tally every review kept in `dir`. */
// ponytail: reads every file per call (~20 ms for 1,000 reviews); cache tallies by file once
// histories grow past that.
export function readReviewStats(dir: string): ReviewStats {
  const reviews = readCountedReviews(dir);
  return {
    approved: reviews.filter((review) => review.status === "approved").length,
    rejected: reviews.filter(isRejected).length,
    revisions: reviews.reduce((n, review) => n + Math.max(review.versions.length - 1, 0), 0),
    comments: reviews.flatMap(decidedVersions).reduce((n, v) => n + commentCount(v), 0),
  };
}
