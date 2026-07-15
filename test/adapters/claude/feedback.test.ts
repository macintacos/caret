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

test("allow echoes the provided tool_input as decision.updatedInput", () => {
  // Claude Code >=2.1.199 discards an ExitPlanMode allow that lacks updatedInput
  // (EXC-683). Echoing the original tool_input keeps the allow alive.
  const out = toHookOutput({ behavior: "allow" }, { plan: "# P", planFilePath: "/x.md" });
  expect(out.hookSpecificOutput.decision).toEqual({
    behavior: "allow",
    updatedInput: { plan: "# P", planFilePath: "/x.md" },
  });
});

test("allow + acceptEdits carries both updatedInput and updatedPermissions", () => {
  const out = toHookOutput({ behavior: "allow", acceptMode: "acceptEdits" }, { plan: "# P" });
  expect(out.hookSpecificOutput.decision).toEqual({
    behavior: "allow",
    updatedInput: { plan: "# P" },
    updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
  });
});

test("allow with reviewer notes folds them into the echoed plan (EXC-791)", () => {
  const out = toHookOutput(
    { behavior: "allow", feedback: "use the retry helper" },
    { plan: "# P\n\nbody\n", planFilePath: "/x.md" },
  );
  const decision = out.hookSpecificOutput.decision;
  expect(decision.behavior).toBe("allow");
  const updated = decision.updatedInput as { plan: string; planFilePath: string };
  // The plan of record the agent proceeds with now carries the note, below the
  // original plan; planFilePath is preserved.
  expect(updated.plan.startsWith("# P\n\nbody\n")).toBe(true);
  expect(updated.plan).toContain("## Notes from the user");
  expect(updated.plan).toContain("use the retry helper");
  expect(updated.planFilePath).toBe("/x.md");
});

test("allow with a blank note leaves the echoed plan unchanged", () => {
  const out = toHookOutput({ behavior: "allow", feedback: "   " }, { plan: "# P" });
  expect(out.hookSpecificOutput.decision.updatedInput).toEqual({ plan: "# P" });
});

test("allow with notes but no echoed plan stays a bare allow", () => {
  // Nothing to fold into on the wire (the plan-file append is the other channel).
  const out = toHookOutput({ behavior: "allow", feedback: "note" });
  expect(out.hookSpecificOutput.decision).toEqual({ behavior: "allow" });
});

test("deny ignores any tool_input echo", () => {
  const out = toHookOutput({ behavior: "deny", feedback: "no" }, { plan: "# P" });
  expect(out.hookSpecificOutput.decision).toEqual({ behavior: "deny", message: "no" });
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
