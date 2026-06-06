// The Claude Code adapter: the first AgentAdapter implementation. It owns
// Claude's hook wire protocol — the PermissionRequest decision JSON on stdout —
// and is the composition point the CLI selects to talk to the agent.

import type { Decision, PlanInput } from "../../types.ts";
import type { AgentAdapter, InstallProbe } from "../adapter.ts";
import { APPROVE_VARIANTS } from "./approve.ts";
import { toHookOutput } from "./feedback.ts";
import { readClaudeInstallState } from "./install.ts";

/** The shape of the PermissionRequest/ExitPlanMode hook stdin Claude Code pipes
 * to `caret review`. Every field is optional: a payload missing any of them
 * still parses to a PlanInput, and the downstream guards (plan format, daemon
 * work) handle the gaps. */
interface HookStdin {
  session_id?: string;
  cwd?: string;
  tool_input?: { plan?: string };
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
    return { sessionId: hook.session_id, cwd: hook.cwd, plan: hook.tool_input?.plan };
  },

  emitDecision(decision: Decision): string {
    return JSON.stringify(toHookOutput(decision));
  },

  readInstallState(): InstallProbe {
    return readClaudeInstallState();
  },
};
