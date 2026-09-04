// Codex's approve-variant vocabulary. Codex exposes a single plain approve: its
// permission-escalation fields (updatedInput / updatedPermissions / interrupt) are
// documented as reserved and "fail closed today" (EXC-532), so there is no stable
// session-mode token to map an escalating approve onto — unlike Claude's
// acceptEdits / auto. Deliberate, not a stub. When Codex's escalation shape
// stabilizes and is live-verified, additional variants get declared here and
// rendered as Codex modes in feedback.ts.

import type { ApproveVariant } from "@/lib/types.ts";

/**
 * Codex's declared approve variants, in display order — a single plain approve.
 * The label/description are the reviewer-facing button text the UI renders
 * verbatim from this declaration.
 */
export const APPROVE_VARIANTS: readonly ApproveVariant[] = [
  { id: "default", label: "Approve", description: "Approve this plan" },
];
