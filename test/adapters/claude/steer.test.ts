// planTitleSteer: the hook stdout `caret steer` prints on EnterPlanMode's PostToolUse and on
// a UserPromptSubmit sent in plan mode, telling the model to open its plan with a title heading.

import { expect, test } from "bun:test";
import { join } from "node:path";

import { PLAN_TITLE_INSTRUCTION } from "@opencode/review-bridge.ts";
import { runCaretCli } from "@test/support/cli-process.ts";
import { planTitleSteer } from "@/adapters/claude/steer.ts";

const steer = (stdin: object) => planTitleSteer(JSON.stringify(stdin));

test("EnterPlanMode's PostToolUse adds the title instruction as context", () => {
  const out = steer({ hook_event_name: "PostToolUse", tool_name: "EnterPlanMode" });
  expect(JSON.parse(out ?? "")).toEqual({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: PLAN_TITLE_INSTRUCTION },
  });
});

test("another tool's PostToolUse prints nothing", async () => {
  const fixture = join(import.meta.dir, "fixtures", "exit-plan-mode-posttooluse-stdin.json");
  expect(planTitleSteer(await Bun.file(fixture).text())).toBeUndefined();
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

// A failure reaching the CLI's fatal handler would print a deny on every prompt.
test("caret steer exits 0 and prints nothing on unparseable stdin", async () => {
  const { exitCode, stdout } = await runCaretCli(["steer"], {
    env: process.env,
    stdin: new TextEncoder().encode("not json"),
  });
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "" });
});
