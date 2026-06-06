// Maps a browser decision to the PermissionRequest hook output Claude Code reads
// on stdout. This is the spike-verified contract (matching EduardMaghakyan/ipe):
//
//   approve              -> { behavior: "allow" }
//   approve + acceptEdits-> { behavior: "allow", updatedPermissions:[setMode] }
//   approve + auto       -> { behavior: "allow", updatedPermissions:[setMode] }
//   request changes      -> { behavior: "deny", message: <feedback> }
//
// A `deny.message` is the documented, verified feedback channel — the model
// receives it and revises the plan.

import type { AcceptMode, Behavior } from "../../types.ts";

export interface PermissionDecision {
  behavior: Behavior;
  message?: string;
  updatedPermissions?: Array<{
    type: "setMode";
    mode: AcceptMode;
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
  acceptMode?: AcceptMode;
}

export function toHookOutput(input: DecisionInput): HookOutput {
  if (input.behavior === "allow") {
    const decision: PermissionDecision = { behavior: "allow" };
    if (input.acceptMode === "acceptEdits" || input.acceptMode === "auto") {
      decision.updatedPermissions = [
        { type: "setMode", mode: input.acceptMode, destination: "session" },
      ];
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
