// The OpenCode adapter: caret's first plugin-shaped integration. OpenCode is NOT a
// command-hook agent — it loads an in-process JS plugin (see the opencode/
// packaging) that registers a plan-review tool and bridges to `caret review` by
// piping a caret-defined envelope on stdin and reading the decision JSON this
// adapter emits on stdout. Because both ends of the wire are caret-owned, the
// envelope and decision shapes are caret's own. Selectable via
// CARET_AGENT=opencode; Claude stays the default.

import type { AgentAdapter, InstallProbe } from "@/adapters/adapter.ts";
import { APPROVE_VARIANTS } from "@/adapters/opencode/approve.ts";
import { fatalDenyLine, toWireDecision } from "@/adapters/opencode/feedback.ts";
import { readOpencodeInstallState } from "@/adapters/opencode/install.ts";
import {
  readOpencodeCommandDescription,
  readOpencodeCommands,
} from "@/adapters/opencode/skills.ts";
import { parseHookStdin } from "@/adapters/wire.ts";
import type { Decision, PlanInput, SkillRef } from "@/lib/types.ts";

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
  id: "opencode",
  approveVariants: APPROVE_VARIANTS,

  parseHookInput(stdin: string): PlanInput {
    const hook = parseHookStdin<HookStdin>(stdin);
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

  fatalDenyLine,

  readInstallState(): InstallProbe {
    return readOpencodeInstallState();
  },

  // OpenCode's `/` menu is its commands, and they are config-dir-rooted — the
  // review's cwd plays no part, so this drops the parameter the interface offers.
  listSkills(): Promise<SkillRef[]> {
    return readOpencodeCommands();
  },

  // Config-dir-rooted for the same reason, so the cwd goes unread here too. Every
  // command carries the one origin this adapter has, which is why only the name
  // travels on from the row.
  readSkillDescription(_cwd: string, skill: SkillRef): Promise<string | null> {
    return readOpencodeCommandDescription(skill.name);
  },
};
