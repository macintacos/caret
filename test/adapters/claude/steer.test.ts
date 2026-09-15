// planTitleSteer: the hook stdout `caret steer` prints on EnterPlanMode's PostToolUse and on
// every UserPromptSubmit, telling the model to open its plan with a title heading.

import { expect, test } from "bun:test";

import { PLAN_TITLE_INSTRUCTION } from "@opencode/review-bridge.ts";
import { planTitleSteer } from "@/adapters/claude/steer.ts";

const steer = (stdin: object) => planTitleSteer(JSON.stringify(stdin));

test("EnterPlanMode's PostToolUse adds the title instruction as context", () => {
  expect(JSON.parse(steer({ hook_event_name: "PostToolUse" }) ?? "")).toEqual({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: PLAN_TITLE_INSTRUCTION },
  });
});

test("a prompt submitted in plan mode adds the title instruction as context", () => {
  const out = steer({ hook_event_name: "UserPromptSubmit", permission_mode: "plan" });
  expect(JSON.parse(out ?? "")).toEqual({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: PLAN_TITLE_INSTRUCTION,
    },
  });
});

test("a prompt submitted outside plan mode prints nothing", () => {
  expect(
    steer({ hook_event_name: "UserPromptSubmit", permission_mode: "default" }),
  ).toBeUndefined();
});

test("unparseable stdin throws", () => {
  expect(() => planTitleSteer("not json")).toThrow("could not parse hook stdin JSON");
});
