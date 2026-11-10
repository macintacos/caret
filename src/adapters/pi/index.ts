// The pi adapter: pi integrates through caret's extension (EXC-2315, not yet shipped),
// which will bridge to `caret review` over the caret-owned envelope
// (src/adapters/wire.ts). Default-off, selectable via CARET_AGENT=pi; until the
// extension lands nothing sets it.

import { homedir } from "node:os";

import type { AgentAdapter } from "@/adapters/adapter.ts";
import { piAgentDir, readPiInstallState } from "@/adapters/pi/install.ts";
import { piSkillRoots, readPiSkillDescription, readPiSkills } from "@/adapters/pi/skills.ts";
import { flatDecision, flatDenyLine, parseCaretEnvelope } from "@/adapters/wire.ts";

const APPROVE = { id: "default", label: "Approve", description: "Approve this plan" };

const skillRoots = (cwd: string) => piSkillRoots(cwd, { agentDir: piAgentDir(), home: homedir() });

export const piAdapter: AgentAdapter = {
  id: "pi",
  approveVariants: [APPROVE],
  approveCarriesNotes: true,
  restartHint: "Then run /reload in pi.",
  parseHookInput: (stdin) => parseCaretEnvelope(stdin),
  emitDecision: (decision) => JSON.stringify(flatDecision(decision)),
  fatalDenyLine: flatDenyLine,
  readInstallState: () => readPiInstallState(piAgentDir()),
  listSkills: (cwd) => readPiSkills(skillRoots(cwd)),
  readSkillDescription: (cwd, skill) => readPiSkillDescription(skillRoots(cwd), skill),
};
