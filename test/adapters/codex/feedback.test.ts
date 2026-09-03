import { expect, test } from "bun:test";

import {
  expectBareAllow,
  expectDenyCarriesFeedback,
  expectDenyDefaultMessage,
  expectDenyOutputContract,
} from "@test/support/hook-output.ts";
import { denyOutput, toHookOutput } from "@/adapters/codex/feedback.ts";

test("plain approve emits behavior=allow with no escalation fields", () => {
  expectBareAllow(toHookOutput);
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
  expectDenyCarriesFeedback(toHookOutput);
});

test("deny with no feedback falls back to a default message", () => {
  expectDenyDefaultMessage(toHookOutput);
});

test("denyOutput produces a deny decision carrying the reason", () => {
  expectDenyOutputContract(denyOutput);
});
