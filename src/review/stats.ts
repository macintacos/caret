// Counts over every review kept on disk, for the menubar app's card (GET /api/stats). Read
// from the files, not the store: the store holds only unresolved reviews, and an on-demand
// daemon's memory lasts one idle window.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { PLAN_REJECTED_MESSAGE } from "@/config/constants.ts";
import { readJsonFileSync } from "@/lib/json-file.ts";
import type { Behavior, ReviewStatus, Verdict } from "@/lib/types.ts";

export interface ReviewStats {
  /** Reviews whose plan was approved. */
  approved: number;
  /** Versions the review page's Reject closed. Request changes sends a plan back instead,
   * and its revisions count below. */
  rejected: number;
  /** Plan versions after each review's first. */
  revisions: number;
  /** Inline and general comments on the versions an approval or Request changes closed.
   * Reject sends none, so its drafted comments don't count. */
  comments: number;
}

/** The verdict a decision delivers: Reject is the deny carrying the one fixed message,
 * Request changes any other deny. */
export function verdictOf(decision: { behavior: Behavior; feedback?: string }): Verdict {
  if (decision.behavior === "allow") return "approve";
  return decision.feedback === PLAN_REJECTED_MESSAGE ? "reject" : "request-changes";
}

// Only the fields the tally reads, so a record from any caret since these fields existed
// counts.
const CountedReviewSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "expired"]) satisfies z.ZodType<ReviewStatus>,
  decision: z
    .object({ behavior: z.enum(["allow", "deny"]), feedback: z.string().optional() })
    .optional(),
  versions: z.array(
    z.object({
      annotations: z.array(z.unknown()),
      generalComment: z.string().optional(),
      verdict: z.enum(["approve", "request-changes", "reject"]).optional(),
    }),
  ),
});

type CountedReview = z.infer<typeof CountedReviewSchema>;

/** Each version's verdict: its stamp, else inferred for a record that predates the stamp.
 * A version a revision replaced was sent back; the last one carries the review's decision,
 * and none while pending or expired. */
function verdicts({ status, decision, versions }: CountedReview): (Verdict | undefined)[] {
  return versions.map((v, i) => {
    if (v.verdict) return v.verdict;
    if (i < versions.length - 1) return "request-changes";
    if (status === "approved") return "approve";
    return status === "rejected" && decision ? verdictOf(decision) : undefined;
  });
}

function tally(review: CountedReview): ReviewStats {
  const closed = verdicts(review);
  return {
    approved: review.status === "approved" ? 1 : 0,
    rejected: closed.filter((v) => v === "reject").length,
    revisions: Math.max(review.versions.length - 1, 0),
    comments: review.versions.reduce(
      (n, v, i) =>
        closed[i] === "approve" || closed[i] === "request-changes"
          ? n + v.annotations.length + (v.generalComment ? 1 : 0)
          : n,
      0,
    ),
  };
}

const NONE: ReviewStats = { approved: 0, rejected: 0, revisions: 0, comments: 0 };

/** One file's tally, or none when it doesn't parse as a review. Silently: this runs on
 * every menu open, so a log line would repeat on each one. */
function tallyFile(path: string): ReviewStats {
  const parsed = CountedReviewSchema.safeParse(readJsonFileSync(path));
  return parsed.success ? tally(parsed.data) : NONE;
}

/** The `.json` names in `dir`; none when `dir` doesn't exist yet. */
function reviewFileNames(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** A tally of every review kept in `dir`, re-parsing only the files new or changed since
 * the last call: decided reviews never change again, so a call costs a stat per file. */
export function createReviewStats(dir: string): () => ReviewStats {
  const cache = new Map<string, { mtimeMs: number; size: number; tally: ReviewStats }>();
  return () => {
    const names = reviewFileNames(dir);
    const present = new Set(names);
    for (const name of cache.keys()) if (!present.has(name)) cache.delete(name);

    const sum = { ...NONE };
    for (const name of names) {
      const path = join(dir, name);
      const { mtimeMs, size } = statSync(path);
      let entry = cache.get(name);
      if (!entry || entry.mtimeMs !== mtimeMs || entry.size !== size) {
        entry = { mtimeMs, size, tally: tallyFile(path) };
        cache.set(name, entry);
      }
      sum.approved += entry.tally.approved;
      sum.rejected += entry.tally.rejected;
      sum.revisions += entry.tally.revisions;
      sum.comments += entry.tally.comments;
    }
    return sum;
  };
}
