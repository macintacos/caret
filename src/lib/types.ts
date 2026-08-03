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
 * A line-anchored inline annotation: the anchor is a 1-based, inclusive line
 * range into the stored plan text of the version that contains it. Line
 * numbers reference the plan version's text verbatim, so the anchor is stable
 * for as long as that version exists (annotations are version-scoped and never
 * re-anchored across versions).
 */
export interface LineAnnotation {
  id: string;
  /** First annotated line (1-based, inclusive). */
  startLine: number;
  /** Last annotated line (1-based, inclusive; >= startLine). */
  endLine: number;
  comment: string;
  /** Per-comment lifecycle, drawn from the review's ReviewStatus vocabulary rather
   * than a parallel one: "pending"/"rejected" are the unresolved working states and
   * "approved"/"expired" are terminal. Optional — absent on a freshly-created working
   * draft and on every on-disk record that predates the field, and read as "pending"
   * by every consumer (see commentState). */
  state?: ReviewStatus;
}

/**
 * A selection-anchored annotation as persisted by earlier reviews. The anchor
 * is the W3C TextQuoteSelector hybrid: `quote` plus its surrounding
 * `prefix`/`suffix` context, with the char offsets as the fast path. On-disk
 * records in this shape load forever — they are never migrated or dropped.
 */
export interface LegacyAnnotation {
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

/**
 * A single inline annotation within a specific plan version. The union is
 * permanent: both shapes co-exist on disk and over the wire, and every
 * consumer narrows via the guards below.
 */
export type Annotation = LineAnnotation | LegacyAnnotation;

/** Narrows to the line-anchored shape. */
export function isLineAnnotation(a: Annotation): a is LineAnnotation {
  return "startLine" in a;
}

/** Narrows to the selection-anchored legacy shape. */
export function isLegacyAnnotation(a: Annotation): a is LegacyAnnotation {
  return "blockId" in a;
}

/** One revision of a plan within a review thread. Annotations and the unsent
 * composer scratches are version-scoped — both anchor to this version's plan text,
 * so a new version starts with neither. */
export interface PlanVersion {
  /** 1-based version number. */
  version: number;
  plan: string;
  annotations: Annotation[];
  /** Persisted, unsent composer scratches — the line-anchored drafts the reviewer
   * typed but did not submit against this version's text. Optional because
   * pre-existing on-disk versions predate the field. */
  composerScratches?: PersistedScratch[];
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
 * The on-disk form of an unsent composer "scratch" — the in-memory
 * `ComposerScratch` (ui/src/lib/diffview/commenting.ts) reduced to its persistable
 * fields: the 1-based, inclusive line range it anchors to plus the retained text.
 * The UI type's `key` ("startLine:endLine") is intentionally omitted — it is
 * derivable from the range, so persisting it would only invite the stored key and
 * its own range to drift apart.
 */
export interface PersistedScratch {
  /** First anchored line (1-based, inclusive). */
  startLine: number;
  /** Last anchored line (1-based, inclusive; >= startLine). */
  endLine: number;
  /** The retained, unsubmitted composer text. */
  text: string;
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
  /** The cmux pane the latest version was submitted from (see CmuxPane).
   * Deliberately absent from ClientReview — the browser never needs the ids. */
  cmux?: CmuxPane;
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
  /** The current version's unsent composer scratches (coerced to [] from the
   * optional PlanVersion field in toClientReview). Served on every GET so the
   * source view rehydrates the reviewer's line-anchored drafts on load. */
  composerScratches: PersistedScratch[];
  createdAt: number;
  updatedAt: number;
  decision?: Decision;
}

/**
 * The cmux terminal pane an agent submitted a plan from, captured from the hook
 * process's CMUX_WORKSPACE_ID / CMUX_SURFACE_ID. Rides on the review record
 * because the daemon is long-lived and shared across sessions, so it never
 * inherits any one agent's cmux environment.
 */
export interface CmuxPane {
  workspaceId: string;
  surfaceId: string;
}

/** Body of POST /api/reviews (an incoming plan from the hook). */
export interface PlanInput {
  sessionId?: string;
  cwd?: string;
  title?: string;
  plan?: string;
  /** The cmux pane this plan was submitted from, when the hook ran under cmux.
   * Absent otherwise — the integration is silently inert outside cmux. */
  cmux?: CmuxPane;
  /** Absolute path to the on-disk plan file the agent reads its plan from
   * (Claude Code's `~/.claude/plans/<name>.md`, surfaced as `tool_input.planFilePath`).
   * caret rewrites this file with the canonical formatted plan so the agent's
   * plan of record matches the reviewed text. Absent for agents without a plan
   * file (e.g. Codex). */
  planFilePath?: string;
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

/** Response of POST /api/reviews/:id/file-refs — the subset of the requested
 * candidate paths that resolve to a real file inside the review's cwd. The UI
 * shows the filename icon + hover only for these (EXC-687). */
export interface FileRefsResponse {
  resolved: string[];
}

/** A bounded, line-aware read excerpt of a plan-referenced file, served by GET
 * /api/reviews/:id/file for the hover preview (EXC-687). */
export interface FileExcerpt {
  /** The file's path relative to the review cwd (display + de-dup key). */
  path: string;
  /** Inferred shiki grammar name for highlighting, or "text" when unknown. */
  language: string;
  /** 1-based first line of the excerpt (inclusive). */
  startLine: number;
  /** 1-based last line of the excerpt (inclusive). */
  endLine: number;
  /** The excerpt's lines, in order. */
  lines: string[];
  /** Total line count of the file, so the UI can show "lines a–b of N". */
  totalLines: number;
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
  composerScratches?: PersistedScratch[];
  /** The plan version the version-scoped fields were composed against. When
   * present and stale (≠ the review's current version), the daemon drops the
   * scratch write, so a draft whose debounce raced a newly-arrived version can't
   * land its stale line anchors on the new version's text. */
  version?: number;
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
  /** True when the daemon runs from `bun run` dev source rather than a
   * production install (EXC-556). The UI shows a "local build" badge when set.
   * Derived from isCompiledBinary(): a production install — a compiled binary or
   * the npm bundle — reports false; `mise run dev`, the e2e harness, and a manual
   * `bun src/cli.ts` report true. */
  isDev?: boolean;
  /** True when the daemon was launched by `mise run dev --fresh` (EXC-781): the
   * UI resets its saved preferences (theme, onboarding) on boot to reproduce a
   * brand-new-user session. Present only in that dev mode; a production daemon
   * (CARET_FRESH unset) omits it entirely. */
  fresh?: boolean;
  /** The active adapter's declared approve variants, in display order — the wire
   * channel that lets the UI render its approve split-button from the adapter's
   * capability instead of hard-coding tool mode names. Optional: a daemon that
   * predates this field omits it, and the UI falls back to its built-in set. */
  approveVariants?: ApproveVariant[];
  /** The active adapter's id — "claude" | "opencode" | "codex" — the "source"
   * the UI adapts to (EXC-791): e.g. an OpenCode session, whose single approve
   * variant renders a plain button rather than a split-button. Optional: a
   * daemon that predates the field, or declares none, omits it. */
  source?: string;
}

/**
 * GET /api/diagnostics body — the daemon self-diagnostics the settings Advanced
 * pane renders (EXC-842): system/runtime identity, uptime, the live parsed
 * config.toml settings (scrubbed through redact/core.ts's DENY_KEYS walk), and
 * the config file path plus the CARET_* env overrides in effect. Distinct from
 * GET /api/health, which is a cross-daemon identity probe — this is the local
 * daemon describing itself to its own UI.
 */
export interface DaemonDiagnostics {
  /** OS platform, CPU architecture, and runtime version (e.g. "bun 1.3.14"). */
  system: { platform: string; arch: string; runtime: string };
  /** Milliseconds the daemon has been running (now − boot). */
  uptimeMs: number;
  /** The live, hot-reloaded parsed settings, scrubbed through the shared
   * redact/core.ts DENY_KEYS walk (never a second redaction path). An opaque
   * graph — the pane narrows it. */
  settings: Record<string, unknown>;
  config: {
    /** Resolved config.toml path (configFile()). */
    path: string;
    exists: boolean;
    /** The CARET_* tunables currently set in the environment, in effect over the
     * file. Empty when none are set. */
    env: EnvOverride[];
  };
}

/** One CARET_* environment override in effect (EXC-842): its name and raw string
 * value, or a null value when it is set but invalid (ignored — the accessor
 * falls through to the file value, then the default). */
export interface EnvOverride {
  name: string;
  value: string | null;
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
    composerScratches: cur.composerScratches ?? [],
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    decision: review.decision,
  };
}
