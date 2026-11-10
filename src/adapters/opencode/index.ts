// The OpenCode adapter: caret's first plugin-shaped integration. OpenCode is NOT a
// command-hook agent — it loads an in-process JS plugin (see the opencode/
// packaging) that registers a plan-review tool and bridges to `caret review` by
// piping the caret-owned envelope (its shape lives in src/adapters/wire.ts) on stdin
// and reading the decision JSON this adapter emits on stdout. Only the v2 plugin
// declares approve variants. Selectable via CARET_AGENT=opencode; Claude stays the
// default.

import type { AgentAdapter, InstallProbe } from "@/adapters/adapter.ts";
import { APPROVE_VARIANTS, declaredApproveVariants } from "@/adapters/opencode/approve.ts";
import { toWireDecision } from "@/adapters/opencode/feedback.ts";
import { readOpencodeInstallState } from "@/adapters/opencode/install.ts";
import {
  readOpencodeCommandDescription,
  readOpencodeCommands,
} from "@/adapters/opencode/skills.ts";
import { flatDenyLine, parseCaretEnvelope } from "@/adapters/wire.ts";
import type { Decision, PlanInput, SkillRef } from "@/lib/types.ts";

export const opencodeAdapter: AgentAdapter = {
  id: "opencode",
  approveVariants: APPROVE_VARIANTS,
  approveCarriesNotes: true,
  restartHint: "Then restart OpenCode.",

  parseHookInput(stdin: string): PlanInput {
    return parseCaretEnvelope(stdin, declaredApproveVariants);
  },

  emitDecision(decision: Decision): string {
    return JSON.stringify(toWireDecision(decision));
  },

  fatalDenyLine: flatDenyLine,

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
