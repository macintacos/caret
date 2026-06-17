// OpenCode's approve-variant vocabulary: a single plain approve for v1. OpenCode's
// post-approval escalation differs from Claude's session setMode (acceptEdits /
// auto) — the natural OpenCode escalation is a plan-agent → build-agent switch,
// which is a documented future variant, not built here. The single `default`
// variant is deliberate, mirroring the codex rationale (see codex/approve.ts).

import type { ApproveVariant } from "../../types.ts";

/**
 * OpenCode's declared approve variants, in display order — a single plain approve.
 * The label/description are the reviewer-facing button text the UI renders
 * verbatim from this declaration (reaching the UI over the daemon's /api/health
 * `approveVariants`).
 */
export const APPROVE_VARIANTS: readonly ApproveVariant[] = [
  { id: "default", label: "Approve", description: "Approve this plan" },
];
