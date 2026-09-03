// Maps a core Decision to the caret-defined OpenCode decision JSON the OpenCode
// plugin reads on `caret review`'s stdout. Unlike the Claude/Codex adapters, both
// ends of this wire are caret-owned: caret's OpenCode plugin builds the review
// envelope, pipes it to `caret review`, and reads the decision this module emits.
// There is no foreign agent's hook-output envelope to model, so the shape is a
// clean flat decision — the least speculative of the three adapters:
//
//   approve         -> { behavior: "allow" }
//   request changes -> { behavior: "deny", feedback: <text> }
//
// The plugin renders an allow into "proceed with the build agent" and a deny into
// the tool-result string the model revises against (see the opencode/ packaging).

import { denyMessage } from "@/adapters/wire.ts";
import type { ApproveVariantId, Behavior } from "@/lib/types.ts";

export interface OpencodeDecision {
  behavior: Behavior;
  feedback?: string;
}

export interface DecisionInput {
  behavior: Behavior;
  feedback?: string;
  acceptMode?: ApproveVariantId;
}

export function toWireDecision(input: DecisionInput): OpencodeDecision {
  if (input.behavior === "allow") {
    // Reviewer notes on an approval (EXC-791) ride the allow so the plugin can
    // surface them to the agent; a blank/absent note leaves a bare allow. An
    // acceptMode still escalates nothing (mirrors codex) — a plan-agent →
    // build-agent switch variant is a documented future addition.
    const notes = input.feedback?.trim();
    return notes ? { behavior: "allow", feedback: notes } : { behavior: "allow" };
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
