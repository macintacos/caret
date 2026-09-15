// `caret steer`: the EnterPlanMode PostToolUse and UserPromptSubmit hook that tells the
// model to open its plan with a title heading. It gates nothing, so any failure is a
// silent no-op: it must never reach the CLI's fatal handler, which would emit a deny.
// UserPromptSubmit fires on every prompt, so it skips logging and the config read.

import { planTitleSteer } from "@/adapters/claude/steer.ts";

export async function runSteerSubcommand(): Promise<void> {
  try {
    const out = planTitleSteer(await Bun.stdin.text());
    if (out) process.stdout.write(`${out}\n`);
  } catch {
    // Unparseable stdin: nothing to steer.
  }
  process.exit(0);
}
