// Mirror of the daemon's client-facing contract (src/types.ts). Kept in sync by
// hand: the UI only ever sees ClientReview and posts ResolveBody / annotations.

export type Behavior = "allow" | "deny";

/** Post-approval session mode, mirroring the native plan-approval dialog. */
export type AcceptMode = "default" | "acceptEdits" | "auto";

export type ReviewStatus = "pending" | "approved" | "rejected";

/** A single inline annotation, anchored within a specific plan version. */
export interface Annotation {
  id: string;
  /** Structural (token-index) id of the block element, e.g. "b12". */
  blockId: string;
  /** Char offset into the block element's post-sanitize textContent. */
  startOffset: number;
  endOffset: number;
  /** The selected text, used as a re-resolve fallback when offsets drift. */
  quote: string;
  comment: string;
}

/** One revision of a plan within a review thread. Annotations are version-scoped. */
export interface PlanVersion {
  version: number;
  plan: string;
  annotations: Annotation[];
  createdAt: number;
}

/** Flattened review shape sent to the browser (adds derived current fields). */
export interface ClientReview {
  id: string;
  sessionId: string;
  cwd: string;
  title: string;
  status: ReviewStatus;
  planEpoch: number;
  version: number;
  currentPlan: string;
  annotations: Annotation[];
  versions: PlanVersion[];
  /** Unsent Request Changes "general comment" draft, review-scoped. */
  generalCommentDraft: string;
  createdAt: number;
  updatedAt: number;
  decision?: unknown;
}

/** Body of POST /api/reviews/:id/resolve. */
export interface ResolveBody {
  behavior: Behavior;
  feedback?: string;
  acceptMode?: AcceptMode;
}

export interface Health {
  service: "caret";
  version: string;
}
