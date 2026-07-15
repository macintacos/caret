import { expect, test } from "bun:test";

import { denyDecision, fatalDenyLine, toWireDecision } from "@/adapters/opencode/feedback.ts";

test("plain approve emits behavior=allow with no extra fields", () => {
  expect(toWireDecision({ behavior: "allow" })).toEqual({ behavior: "allow" });
});

test("approve with an acceptMode still emits a plain allow (no escalation in v1)", () => {
  // OpenCode v1 exposes only a plain approve; an acceptMode never escalates on the
  // wire (mirrors the codex single-variant rationale).
  expect(toWireDecision({ behavior: "allow", acceptMode: "default" })).toEqual({
    behavior: "allow",
  });
});

test("approve with reviewer notes carries them on the allow (EXC-791)", () => {
  // Both ends of the wire are caret-owned, so the notes ride the allow for the
  // plugin to surface to the agent.
  expect(toWireDecision({ behavior: "allow", feedback: "use the retry helper" })).toEqual({
    behavior: "allow",
    feedback: "use the retry helper",
  });
});

test("approve with a blank note stays a bare allow", () => {
  expect(toWireDecision({ behavior: "allow", feedback: "   " })).toEqual({ behavior: "allow" });
});

test("deny carries the feedback verbatim", () => {
  expect(toWireDecision({ behavior: "deny", feedback: "Fix the bug" })).toEqual({
    behavior: "deny",
    feedback: "Fix the bug",
  });
});

test("deny with no feedback falls back to a default message", () => {
  const out = toWireDecision({ behavior: "deny" });
  expect(out.behavior).toBe("deny");
  expect(out.feedback).toBeTruthy();
});

test("deny with whitespace-only feedback falls back to the default", () => {
  expect(toWireDecision({ behavior: "deny", feedback: "   " }).feedback).toBe(
    "Plan changes requested.",
  );
});

test("denyDecision produces a deny decision carrying the reason", () => {
  const out = denyDecision("daemon unreachable");
  expect(out.behavior).toBe("deny");
  expect(out.feedback).toContain("daemon unreachable");
});

test("fatalDenyLine is a dependency-free deny wire line", () => {
  expect(JSON.parse(fatalDenyLine("boom"))).toEqual({ behavior: "deny", feedback: "boom" });
});
