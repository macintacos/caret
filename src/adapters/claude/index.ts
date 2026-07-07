// The Claude Code adapter: the first AgentAdapter implementation. It owns
// Claude's hook wire protocol — the PermissionRequest decision JSON on stdout —
// and is the composition point the CLI selects to talk to the agent.

import type { Decision, PlanInput } from "../../types.ts";
import type { AgentAdapter, InstallProbe } from "../adapter.ts";
import { APPROVE_VARIANTS } from "./approve.ts";
import { fatalDenyLine, toHookOutput } from "./feedback.ts";
import { readClaudeInstallState } from "./install.ts";

/** The shape of the PermissionRequest/ExitPlanMode hook stdin Claude Code pipes
 * to `caret review`. Every field is optional: a payload missing any of them
 * still parses to a PlanInput, and the downstream guards (plan format, daemon
 * work) handle the gaps. */
interface HookStdin {
  session_id?: string;
  cwd?: string;
  // planFilePath is the path Claude Code injects for the on-disk plan file it
  // read the plan from (it lives alongside `plan` in tool_input); caret rewrites
  // that file with the canonical plan so the agent's copy matches the review.
  tool_input?: { plan?: string; planFilePath?: string };
}

/** Reconstruct Claude's ExitPlanMode `tool_input` from the parsed PlanInput, to
 * echo back as `decision.updatedInput` on an allow (EXC-683 — see feedback.ts).
 * Undefined fields are omitted; returns undefined when there is no plan payload to
 * echo (the signal-path decision, which is a deny and needs no echo). */
function toolInputEcho(input: PlanInput | undefined): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const echo: Record<string, unknown> = {};
  if (input.plan !== undefined) echo.plan = input.plan;
  if (input.planFilePath !== undefined) echo.planFilePath = input.planFilePath;
  return Object.keys(echo).length > 0 ? echo : undefined;
}

export const claudeAdapter: AgentAdapter = {
  approveVariants: APPROVE_VARIANTS,

  parseHookInput(stdin: string): PlanInput {
    let hook: HookStdin;
    try {
      hook = JSON.parse(stdin);
    } catch {
      // Malformed stdin → the caller turns this throw into a fail-safe deny.
      throw new Error("could not parse hook stdin JSON");
    }
    return {
      sessionId: hook.session_id,
      cwd: hook.cwd,
      plan: hook.tool_input?.plan,
      planFilePath: hook.tool_input?.planFilePath,
    };
  },

  emitDecision(decision: Decision, input?: PlanInput): string {
    return JSON.stringify(toHookOutput(decision, toolInputEcho(input)));
  },

  fatalDenyLine(reason: string): string {
    return fatalDenyLine(reason);
  },

  readInstallState(): InstallProbe {
    return readClaudeInstallState();
  },
};
