// Shared assertions for the Claude/Codex PermissionRequest hook-output contract.
// Codex's decision envelope is modeled ~1:1 on Claude's, so the parts that don't
// vary — a bare allow and the whole deny path — are one contract, which each
// adapter's suite states through its own `toHookOutput`/`denyOutput`.
import { expect } from "bun:test";

interface DecisionInput {
  behavior: "allow" | "deny";
  feedback?: string;
}

interface HookOutput {
  hookSpecificOutput: {
    hookEventName: "PermissionRequest";
    decision: { behavior: string; message?: string };
  };
}

/** A plain approve emits `behavior=allow` with no other decision fields. */
export function expectBareAllow(toHookOutput: (input: DecisionInput) => HookOutput): void {
  expect(toHookOutput({ behavior: "allow" })).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  });
}

/** A deny carries the trimmed feedback verbatim as `decision.message`. */
export function expectDenyCarriesFeedback(
  toHookOutput: (input: DecisionInput) => HookOutput,
): void {
  expect(
    toHookOutput({ behavior: "deny", feedback: "Fix the bug" }).hookSpecificOutput.decision,
  ).toEqual({ behavior: "deny", message: "Fix the bug" });
}

/** A deny with no feedback falls back to a default message. */
export function expectDenyDefaultMessage(toHookOutput: (input: DecisionInput) => HookOutput): void {
  const decision = toHookOutput({ behavior: "deny" }).hookSpecificOutput.decision;
  expect(decision.behavior).toBe("deny");
  expect(decision.message).toBeTruthy();
}

/** `denyOutput` is `toHookOutput({ behavior: "deny", feedback: reason })` under the hood. */
export function expectDenyOutputContract(denyOutput: (reason: string) => HookOutput): void {
  const out = denyOutput("daemon unreachable");
  expect(out.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
  expect(out.hookSpecificOutput.decision.message).toContain("daemon unreachable");
}
