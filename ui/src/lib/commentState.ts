// The per-comment state affordance: maps a comment's ReviewStatus onto the quiet
// dot+label the SourceAnnotationCard shows, so the card stays presentational and the
// mapping is unit-testable without mounting. The vocabulary IS ReviewStatus — there
// is no parallel comment-state set — and an absent state reads as "pending" (a
// freshly-created working draft, or an on-disk record predating the field).

import type { ReviewStatus } from "@core/lib/types";

/** The display tone of a comment state, keyed to the card's CSS:
 * - "draft"    → an unsubmitted/unresolved working comment (amber, brand-active)
 * - "accepted" → an accepted comment (quiet --ok green, terminal)
 * - "expired"  → an abandoned comment (quiet neutral --ink-faint, terminal) */
export type CommentTone = "draft" | "accepted" | "expired";

/** The presentation for one comment state: a short label and a tone the CSS colors. */
export interface CommentStateView {
  /** The ReviewStatus this view was derived from (absent → "pending"). */
  status: ReviewStatus;
  /** Quiet text label shown beside the dot. */
  label: string;
  /** Drives the dot color via a class on the card. */
  tone: CommentTone;
  /** True while the comment can still change (pending/rejected) — drives the amber,
   * brand-active dot. Mirrors isUnresolved(status). */
  unresolved: boolean;
}

/** Resolves a comment's (optionally absent) state into its card presentation. The
 * unresolved working states (pending/rejected) share the amber draft tone; the
 * terminal states split into accepted (--ok) and expired (--ink-faint). */
export function commentState(state: ReviewStatus | undefined): CommentStateView {
  const status = state ?? "pending";
  switch (status) {
    case "rejected":
      return { status, label: "Requested", tone: "draft", unresolved: true };
    case "approved":
      return { status, label: "Accepted", tone: "accepted", unresolved: false };
    case "expired":
      return { status, label: "Expired", tone: "expired", unresolved: false };
    default:
      return { status: "pending", label: "Draft", tone: "draft", unresolved: true };
  }
}
