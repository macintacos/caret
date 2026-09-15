// The plan-title steer for EnterPlanMode's PostToolUse and UserPromptSubmit. Entering plan mode
// with Shift+Tab fires no EnterPlanMode, so a prompt sent in plan mode is the only signal.

import { PLAN_TITLE_INSTRUCTION } from "@opencode/review-bridge.ts";
import { parseHookStdin } from "@/adapters/wire.ts";

interface SteerHookStdin {
  hook_event_name?: string;
  tool_name?: string;
  permission_mode?: string;
}

/** The hook stdout that tells the model to open its plan with a title, or undefined when
 * this event should not steer. Throws on unparseable stdin. */
export function planTitleSteer(stdin: string): string | undefined {
  const {
    hook_event_name: event,
    tool_name: tool,
    permission_mode: mode,
  } = parseHookStdin<SteerHookStdin>(stdin);
  const steers =
    (event === "PostToolUse" && tool === "EnterPlanMode") ||
    (event === "UserPromptSubmit" && mode === "plan");
  if (!steers) return undefined;
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: PLAN_TITLE_INSTRUCTION },
  });
}
