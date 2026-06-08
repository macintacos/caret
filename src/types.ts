// Core domain types shared by the daemon, store, CLI, and the UI (imported
// directly through the @core/* alias). The single wire contract — pure TS with
// no node imports, so the browser bundle stays clean.

/** A thrown value as a string: an Error's message, or String() of anything else.
 * The one coercion used wherever a caught value is rendered into a log line,
 * deny reason, or degraded-section error. Lives here so the browser bundle can
 * import it (no node dependency). */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The browser's decision on a plan. Maps to the PermissionRequest hook output. */
export type Behavior = "allow" | "deny";

/**
 * An opaque approve-variant token. The core stores and transports it without
 * interpreting it: the adapter declares the set of valid ids (see
 * `ApproveVariant` / `AgentAdapter.approveVariants`), the UI renders them, and
 * only the adapter maps a token to its tool-specific approve semantics. A second
 * adapter declares its own ids without touching this module.
 */
export type ApproveVariantId = string;

/**
 * A post-approval approve variant offered to the reviewer — the wire shape the
 * daemon publishes (sourced from the active adapter) and the UI renders. `id` is
 * the opaque token carried on the decision; `label` is its button text;
 * `description` is the optional sub-label note.
 */
export interface ApproveVariant {
  id: ApproveVariantId;
  label: string;
  description?: string;
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

/**
 * A single inline annotation, anchored within a specific plan version.
 *
 * The durable anchor is the W3C TextQuoteSelector hybrid: `quote` plus its
 * surrounding `prefix`/`suffix` context. The offsets are only the fast path —
 * they re-resolve exactly when the block text is unchanged but drift on a
 * re-render. When they drift, `quote`+context locate the text again, and the
 * context disambiguates a quote that now occurs more than once.
 */
export interface Annotation {
  id: string;
  /** Structural (token-index) id of the block element, e.g. "b12". */
  blockId: string;
  /** Char offset into the block element's post-sanitize textContent. */
  startOffset: number;
  endOffset: number;
  /** The selected text, used as a re-resolve fallback when offsets drift. */
  quote: string;
  /** Up to ~32 chars of textContent immediately before the quote within the
   * block, used to disambiguate a non-unique quote on re-resolve. Optional:
   * on-disk annotations predating the hybrid anchor omit it and resolve via the
   * offset and unique-quote tiers unchanged. */
  prefix?: string;
  /** Up to ~32 chars of textContent immediately after the quote (see prefix). */
  suffix?: string;
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
  /** The chosen approve variant's opaque id; only meaningful when
   * behavior === "allow". The adapter interprets the token; the core stores and
   * transports it verbatim. */
  acceptMode?: ApproveVariantId;
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
  /** The chosen approve variant's opaque id (see Decision.acceptMode). */
  acceptMode?: ApproveVariantId;
}

/** Body of PUT /api/reviews/:id/draft (the reviewer's working-copy autosave).
 * Each field is independently optional so a draft-only write never wipes
 * annotations (and vice versa). */
export interface DraftBody {
  annotations?: Annotation[];
  generalCommentDraft?: string;
}

/**
 * GET /api/health identity body — the single wire shape for the daemon's
 * identity probe. Every field is optional: a pre-fix daemon or a non-caret
 * process squatting on the port may omit any of them, so consumers degrade
 * rather than assume. `stateDir` (world identity — an identifying path, NEVER
 * logged) and `instanceId` (per-boot opaque id) are the EXC-461 fields a hook
 * and the UI key on to tell daemons apart.
 */
export interface HealthIdentity {
  service?: string;
  version?: string;
  build?: string;
  commit?: string;
  stateDir?: string;
  instanceId?: string;
  /** True when the daemon runs from source rather than a compiled binary
   * (EXC-556). The UI shows a "local build" badge when set. Derived from
   * isCompiledBinary(): a real installed binary reports false; `mise run dev`,
   * the e2e harness, and a manual `bun src/cli.ts` report true. */
  isDev?: boolean;
  /** The active adapter's declared approve variants, in display order — the wire
   * channel that lets the UI render its approve split-button from the adapter's
   * capability instead of hard-coding tool mode names. Optional: a daemon that
   * predates this field omits it, and the UI falls back to its built-in set. */
  approveVariants?: ApproveVariant[];
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
