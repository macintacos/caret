// The per-comment state affordance behind SourceAnnotationCard's stamp. The
// vocabulary IS ReviewStatus — there is no parallel comment-state set — and an
// absent state reads as "pending" (a fresh working draft, or an on-disk record
// predating the field).

import type { ReviewStatus } from "@core/lib/types";
import type { IconName } from "$lib/icons.ts";

/** The presentation for one comment state: the glyph and word its stamp shows. The
 * stamp's hue keys on the status, through the card's data-state. */
export interface CommentStateView {
  /** The ReviewStatus this view was derived from (absent → "pending"). */
  status: ReviewStatus;
  /** The stamp's word. */
  label: string;
  /** The stamp's glyph, so the state reads by shape as well as hue. */
  icon: IconName;
  /** True while the comment can still change (pending/rejected). Mirrors
   * isUnresolved(status). */
  unresolved: boolean;
}

/** Resolves a comment's (optionally absent) state into its card presentation. */
export function commentState(state: ReviewStatus | undefined): CommentStateView {
  const status = state ?? "pending";
  switch (status) {
    case "rejected":
      return { status, label: "Requested", icon: "corner-up-left", unresolved: true };
    case "approved":
      return { status, label: "Accepted", icon: "check", unresolved: false };
    case "expired":
      return { status, label: "Expired", icon: "circle-dashed", unresolved: false };
    default:
      return { status: "pending", label: "Draft", icon: "pencil-line", unresolved: true };
  }
}
