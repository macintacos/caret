// Maps a browser decision to the PermissionRequest hook output Claude Code reads
// on stdout. This is the spike-verified contract (matching EduardMaghakyan/ipe):
//
//   approve              -> { behavior: "allow" }
//   approve + acceptEdits-> { behavior: "allow", updatedPermissions:[setMode] }
//   approve + auto       -> { behavior: "allow", updatedPermissions:[setMode] }
//   request changes      -> { behavior: "deny", message: <feedback> }
//
// A `deny.message` is the documented, verified feedback channel — the model
// receives it and revises the plan. test/adapters/claude/wire-contract.test.ts
// pins this exact wire JSON by driving a realistic PermissionRequest payload
// through the real parse → runReview → emit path.
//
// Two parts of the contract are empirically-working but not pinned by Anthropic
// docs (EXC-531); EXC-549 is the manual follow-up that verifies them against a
// live Claude session and feeds findings back to Anthropic:
//   1. The exact `updatedPermissions` shape — caret emits the object-array form
//      `[{ type: "setMode", mode, destination: "session" }]`, the live shape; a
//      top-level `setMode` is NOT what the documentation mandates.
//   2. Whether a per-hook `timeout` override above the documented 600s default is
//      honored or silently clamped. hooks/hooks.json declares 3900s; the review
//      timeout ceiling stays strictly below it (see HOOK_TIMEOUT_S, with the
//      coupling pinned by test/adapters/claude/hooks-timeout.test.ts) so caret's
//      own fail-safe deny always emits before Claude could kill the hook.

import type { ApproveVariantId, Behavior } from "../../types.ts";
import { type SetModeName, setModeFor } from "./approve.ts";

export interface PermissionDecision {
  behavior: Behavior;
  message?: string;
  updatedPermissions?: Array<{
    type: "setMode";
    mode: SetModeName;
    destination: "session";
  }>;
}

export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: "PermissionRequest";
    decision: PermissionDecision;
  };
}

export interface DecisionInput {
  behavior: Behavior;
  feedback?: string;
  acceptMode?: ApproveVariantId;
}

export function toHookOutput(input: DecisionInput): HookOutput {
  if (input.behavior === "allow") {
    const decision: PermissionDecision = { behavior: "allow" };
    const mode = setModeFor(input.acceptMode);
    if (mode) {
      decision.updatedPermissions = [{ type: "setMode", mode, destination: "session" }];
    }
    return {
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision },
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
