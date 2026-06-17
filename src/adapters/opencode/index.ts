// The OpenCode adapter: caret's third AgentAdapter and its first plugin-shaped
// integration. OpenCode is NOT a command-hook agent — it loads an in-process JS
// plugin (see the opencode/ packaging) that registers a plan-review tool and
// bridges to `caret review` by piping a caret-defined envelope on stdin and
// reading the decision JSON this adapter emits on stdout. Because both ends of the
// wire are caret-owned, the envelope and decision shapes are caret's own — the
// least speculative of the three adapters (no foreign wire format to model).
// Selectable via CARET_AGENT=opencode; Claude stays the default.

import type { Decision, PlanInput } from "../../types.ts";
import type { AgentAdapter, InstallProbe } from "../adapter.ts";
import { APPROVE_VARIANTS } from "./approve.ts";
import { fatalDenyLine, toWireDecision } from "./feedback.ts";
import { readOpencodeInstallState } from "./install.ts";

/** The caret-defined review envelope the OpenCode plugin pipes to `caret review`.
 * Mirrors the snake_case session/cwd convention the Claude/Codex parsers use so the
 * three stay structurally parallel; the plugin builds this shape directly from its
 * tool args. Every field is optional — a payload missing any of them still parses
 * to a PlanInput, and the downstream guards handle the gaps. OpenCode has no
 * on-disk plan file to rewrite, so there is no planFilePath. */
interface HookStdin {
  session_id?: string;
  cwd?: string;
  tool_input?: { plan?: string; title?: string };
}

export const opencodeAdapter: AgentAdapter = {
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
      title: hook.tool_input?.title,
    };
  },

  emitDecision(decision: Decision): string {
    return JSON.stringify(toWireDecision(decision));
  },

  fatalDenyLine(reason: string): string {
    return fatalDenyLine(reason);
  },

  readInstallState(): InstallProbe {
    return readOpencodeInstallState();
  },
};
