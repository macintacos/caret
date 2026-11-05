// Maps a core Decision to the caret-defined OpenCode decision JSON the OpenCode
// plugin reads on `caret review`'s stdout. Unlike the Claude/Codex adapters, both
// ends of this wire are caret-owned: caret's OpenCode plugin builds the review
// envelope, pipes it to `caret review`, and reads the decision this module emits.
// There is no foreign agent's hook-output envelope to model, so the shape is a
// clean flat decision — the least speculative of the three adapters:
//
//   approve         -> { behavior: "allow" }
//   approve & build -> { behavior: "allow", acceptMode: "build" }
//   request changes -> { behavior: "deny", feedback: <text> }
//
// The plugin renders an allow into its approval text, switching a v2 session to the
// build agent on `acceptMode: "build"`, and a deny into
// the tool-result string the model revises against (see the opencode/ packaging).

import { BUILD_VARIANT } from "@/adapters/opencode/approve.ts";
import { denyMessage } from "@/adapters/wire.ts";
import type { ApproveVariantId, Behavior } from "@/lib/types.ts";

export interface OpencodeDecision {
  behavior: Behavior;
  feedback?: string;
  acceptMode?: ApproveVariantId;
}

export interface DecisionInput {
  behavior: Behavior;
  feedback?: string;
  acceptMode?: ApproveVariantId;
}

export function toWireDecision(input: DecisionInput): OpencodeDecision {
  if (input.behavior === "allow") {
    // Reviewer notes on an approval (EXC-791) ride the allow so the plugin can
    // surface them to the agent; a blank/absent note leaves a bare allow. Only the
    // build variant rides the wire, asking the v2 plugin to switch to the build agent;
    // any other acceptMode leaves a bare allow.
    const notes = input.feedback?.trim();
    const mode = input.acceptMode === BUILD_VARIANT.id ? input.acceptMode : undefined;
    return {
      behavior: "allow",
      ...(notes && { feedback: notes }),
      ...(mode && { acceptMode: mode }),
    };
  }
  return { behavior: "deny", feedback: denyMessage(input.feedback) };
}

/** Fail-safe deny: shipping an unreviewed plan is the one outcome we never allow. */
export function denyDecision(reason: string): OpencodeDecision {
  return toWireDecision({ behavior: "deny", feedback: reason });
}

/** Last-resort deny wire line for the CLI's fatal handler. Deliberately
 * dependency-free (literals + JSON.stringify only), so a bug anywhere else in the
 * adapter cannot take the fail-safe down with it. */
export function fatalDenyLine(reason: string): string {
  return JSON.stringify({ behavior: "deny", feedback: reason });
}
