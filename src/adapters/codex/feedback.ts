// Maps a core Decision to the PermissionRequest hook output the OpenAI Codex CLI
// reads on stdout. The Codex PermissionRequest contract is modeled from docs and
// research (EXC-532), NOT verified against a live Codex session — treat the exact
// field names as provisional pending the live-contract follow-up (the same manual
// verification pattern EXC-549 uses for Claude). What the research establishes:
//
//   allow           -> { hookSpecificOutput:{ ...decision:{ behavior:"allow" } } }
//   request changes -> { hookSpecificOutput:{ ...decision:{ behavior:"deny",
//                                                            message:<feedback> } } }
//
// The decision envelope is documented as ~1:1 with Claude's PermissionRequest,
// down to the `message` deny channel the model receives and revises against.
//
// Provisional / docs-based, NOT live-verified:
//   1. The `hookEventName` token. Codex's docs label this hook "PermissionRequest";
//      caret emits that string. A live session may use a different event name.
//   2. Mode escalation on approve. Codex's advanced fields (updatedInput /
//      updatedPermissions / interrupt) are documented as reserved and "fail closed
//      today", so caret emits NO mode-escalation payload on an allow — even when a
//      reviewer picks an approve variant carrying an acceptMode. The variant is
//      accepted (the plan is approved); the mode escalation is simply dropped until
//      Codex's permission-escalation shape is stable and live-verified. See
//      approve.ts for the single-variant rationale.

import { denyMessage, type PermissionRequestOutput, permissionRequest } from "@/adapters/wire.ts";
import type { ApproveVariantId, Behavior } from "@/lib/types.ts";

export interface CodexDecision {
  behavior: Behavior;
  message?: string;
}

export type HookOutput = PermissionRequestOutput<CodexDecision>;

export interface DecisionInput {
  behavior: Behavior;
  feedback?: string;
  acceptMode?: ApproveVariantId;
}

export function toHookOutput(input: DecisionInput): HookOutput {
  if (input.behavior === "allow") {
    // No mode escalation and no reviewer notes: Codex's escalation fields are
    // reserved/fail-closed (see the file header), and its allow has no documented
    // agent-facing message channel (only deny does), so notes riding on
    // input.feedback (EXC-791) are dropped.
    return permissionRequest({ behavior: "allow" });
  }
  return permissionRequest({ behavior: "deny", message: denyMessage(input.feedback) });
}

/** Fail-safe deny: shipping an unreviewed plan is the one outcome we never allow. */
export function denyOutput(reason: string): HookOutput {
  return toHookOutput({ behavior: "deny", feedback: reason });
}
