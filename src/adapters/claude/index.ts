// The Claude Code adapter: the first AgentAdapter implementation. It owns
// Claude's hook wire protocol — the PermissionRequest decision JSON on stdout —
// and is the composition point the CLI selects to talk to the agent.

import type { Decision, PlanInput } from "../../types.ts";
import type { AgentAdapter, ApproveVariant, InstallProbe } from "../adapter.ts";
import { toHookOutput } from "./feedback.ts";

/**
 * Claude's post-approval approve variants. The plain approve maps to no session
 * mode change; the two accept variants map to Claude's `setMode` permissions in
 * the decision emission.
 */
const APPROVE_VARIANTS: readonly ApproveVariant[] = [
  { id: "default", label: "Approve" },
  { id: "acceptEdits", label: "Approve & accept edits" },
  { id: "auto", label: "Approve & auto" },
];

/** The shape of the PermissionRequest/ExitPlanMode hook stdin Claude Code pipes
 * to `caret review`. Every field is optional: a payload missing any of them
 * still parses to a PlanInput, and the downstream guards (plan format, daemon
 * work) handle the gaps. */
interface HookStdin {
  session_id?: string;
  cwd?: string;
  tool_input?: { plan?: string };
}

/** Discovery's install probe is carved into this adapter by a later step; the
 * surface is declared here so callers bind against a stable shape. */
function notWired(member: string): never {
  throw new Error(`claude adapter: ${member} not wired`);
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
    return notWired("readInstallState");
  },
};
