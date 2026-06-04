// Core domain types shared by the daemon, store, CLI, and (mirrored in) the UI.

/** The browser's decision on a plan. Maps to the PermissionRequest hook output. */
export type Behavior = "allow" | "deny";

/**
 * Post-approval session mode, mirroring the native plan-approval dialog's
 * approve variants. Emitted as `updatedPermissions:[{type:"setMode",mode}]`:
 * - "default"     → manual edit approval (no updatedPermissions)
 * - "acceptEdits" → auto-accept edits
 * - "auto"        → auto mode
 */
export type AcceptMode = "default" | "acceptEdits" | "auto";

const ACCEPT_MODES: readonly AcceptMode[] = ["default", "acceptEdits", "auto"];

/** Runtime guard: is `x` a recognized AcceptMode token? */
export function isAcceptMode(x: unknown): x is AcceptMode {
  return typeof x === "string" && (ACCEPT_MODES as readonly string[]).includes(x);
}

/**
 * Lifecycle of a review thread:
 * - "pending"  → awaiting a browser decision (shown in the switcher)
 * - "rejected" → changes requested; awaiting a revised plan (still active)
 * - "approved" → plan accepted; terminal success
 * - "expired"  → abandoned by its hook (timeout or supersede); terminal (EXC-454)
 * "Unresolved" means pending or rejected (see isUnresolved).
 */
export type ReviewStatus = "pending" | "approved" | "rejected" | "expired";

/** A review is unresolved while it can still receive activity (pending/rejected). */
export function isUnresolved(status: ReviewStatus): boolean {
  return status === "pending" || status === "rejected";
}

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
  /** 1-based version number. */
  version: number;
  plan: string;
  annotations: Annotation[];
  createdAt: number;
}

/** The decision recorded when a review resolves. */
export interface Decision {
  behavior: Behavior;
  /** Formatted feedback (annotations + general comment) on a deny. */
  feedback?: string;
  /** Approve variant; only meaningful when behavior === "allow". */
  acceptMode?: AcceptMode;
  decidedAt: number;
}

/**
 * Canonical review record. `versions` is the source of truth; the "current"
 * plan/annotations are always the last entry (see currentVersion()).
 */
export interface Review {
  id: string;
  sessionId: string;
  cwd: string;
  title: string;
  status: ReviewStatus;
  /** Bumps on each approval for the session; drives revision threading. */
  planEpoch: number;
  versions: PlanVersion[];
  /** Unsent "general comment" draft for the Request Changes dialog. Review-scoped
   * (not version-scoped like annotations): it has no anchor in a specific plan
   * text. Optional because pre-existing on-disk reviews predate the field. */
  generalCommentDraft?: string;
  createdAt: number;
  updatedAt: number;
  decision?: Decision;
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
  /** Always a string (coerced from the optional Review field in toClientReview). */
  generalCommentDraft: string;
  createdAt: number;
  updatedAt: number;
  decision?: Decision;
}

/** Body of POST /api/reviews (an incoming plan from the hook). */
export interface PlanInput {
  sessionId?: string;
  cwd?: string;
  title?: string;
  plan?: string;
}

/** Result of routing an incoming plan through the threading state machine. */
export interface RouteResult {
  id: string;
  action: "new" | "append";
  version: number;
  planEpoch: number;
  /** Stale pending reviews of the same session this routing expired (EXC-454). */
  expired: string[];
}

/** Body of POST /api/reviews/:id/resolve. */
export interface ResolveBody {
  behavior: Behavior;
  feedback?: string;
  acceptMode?: AcceptMode;
}

/** Returns the current (latest) version of a review. */
export function currentVersion(review: Review): PlanVersion {
  const v = review.versions[review.versions.length - 1];
  if (!v) throw new Error(`review ${review.id} has no versions`);
  return v;
}

/** Flattens a Review into the client-facing shape. */
export function toClientReview(review: Review): ClientReview {
  const cur = currentVersion(review);
  return {
    id: review.id,
    sessionId: review.sessionId,
    cwd: review.cwd,
    title: review.title,
    status: review.status,
    planEpoch: review.planEpoch,
    version: cur.version,
    currentPlan: cur.plan,
    annotations: cur.annotations,
    versions: review.versions,
    generalCommentDraft: review.generalCommentDraft ?? "",
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    decision: review.decision,
  };
}
