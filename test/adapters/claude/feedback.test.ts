import { expect, test } from "bun:test";
import { denyOutput, toHookOutput } from "../../../src/adapters/claude/feedback.ts";

test("plain approve emits behavior=allow with no updatedPermissions", () => {
  const out = toHookOutput({ behavior: "allow" });
  expect(out).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  });
});

test("approve + acceptEdits emits a setMode updatedPermissions", () => {
  const out = toHookOutput({ behavior: "allow", acceptMode: "acceptEdits" });
  expect(out.hookSpecificOutput.decision).toEqual({
    behavior: "allow",
    updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
  });
});

test("approve + auto emits a setMode auto updatedPermissions", () => {
  const out = toHookOutput({ behavior: "allow", acceptMode: "auto" });
  expect(out.hookSpecificOutput.decision.updatedPermissions).toEqual([
    { type: "setMode", mode: "auto", destination: "session" },
  ]);
});

test("approve + default emits no updatedPermissions", () => {
  const out = toHookOutput({ behavior: "allow", acceptMode: "default" });
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
