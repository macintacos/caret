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
// The decision envelope is documented as ~1:1 with Claude's PermissionRequest:
// the same `hookSpecificOutput.decision.behavior = "allow" | "deny"` plus an
// optional `message` deny channel the model receives and revises against.
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

import type { ApproveVariantId, Behavior } from "../../lib/types.ts";

export interface CodexDecision {
  behavior: Behavior;
  message?: string;
}

export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: "PermissionRequest";
    decision: CodexDecision;
  };
}

export interface DecisionInput {
  behavior: Behavior;
  feedback?: string;
  acceptMode?: ApproveVariantId;
}

export function toHookOutput(input: DecisionInput): HookOutput {
  if (input.behavior === "allow") {
    // No mode escalation is emitted: Codex's permission-escalation fields are
    // reserved/fail-closed today (see the file header), so an approve — with or
    // without an acceptMode — renders a plain allow.
    return {
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "deny",
        message: input.feedback?.trim() || "Plan changes requested.",
      },
    },
  };
}

/** Fail-safe deny: shipping an unreviewed plan is the one outcome we never allow. */
export function denyOutput(reason: string): HookOutput {
  return toHookOutput({ behavior: "deny", feedback: reason });
}

/** Last-resort deny wire line for the CLI's fatal handler. Deliberately
 * dependency-free (literals + JSON.stringify only), so a bug anywhere else in
 * the adapter cannot take the fail-safe down with it. */
export function fatalDenyLine(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "deny", message: reason },
    },
  });
}
