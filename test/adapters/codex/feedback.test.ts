import { expect, test } from "bun:test";

import { denyOutput, toHookOutput } from "@/adapters/codex/feedback.ts";

test("plain approve emits behavior=allow with no escalation fields", () => {
  const out = toHookOutput({ behavior: "allow" });
  expect(out).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  });
});

test("approve with an acceptMode still emits a plain allow (escalation dropped)", () => {
  // Codex's permission-escalation fields are reserved/fail-closed today, so an
  // acceptMode never produces an escalation payload on the wire.
  const out = toHookOutput({ behavior: "allow", acceptMode: "auto" });
  expect(out.hookSpecificOutput.decision).toEqual({ behavior: "allow" });
});

test("allow drops reviewer notes — Codex has no allow-side agent channel (EXC-791)", () => {
  const out = toHookOutput({ behavior: "allow", feedback: "use the retry helper" });
  expect(out.hookSpecificOutput.decision).toEqual({ behavior: "allow" });
});

test("deny carries the feedback in decision.message", () => {
  const out = toHookOutput({ behavior: "deny", feedback: "Fix the bug" });
  expect(out.hookSpecificOutput.decision).toEqual({
    behavior: "deny",
    message: "Fix the bug",
  });
});

test("deny with no feedback falls back to a default message", () => {
  const out = toHookOutput({ behavior: "deny" });
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
  expect(out.hookSpecificOutput.decision.message).toBeTruthy();
});

test("denyOutput produces a deny decision carrying the reason", () => {
  const out = denyOutput("daemon unreachable");
  expect(out.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
  expect(out.hookSpecificOutput.decision.message).toContain("daemon unreachable");
});
