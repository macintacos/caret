// The OpenAI Codex CLI adapter: the second AgentAdapter implementation, proving
// the registry abstraction is real (EXC-532). It owns Codex's PermissionRequest
// hook wire protocol — the decision JSON on stdout — and is selectable via
// `CARET_AGENT=codex`. Claude stays the default; this adapter is default-OFF and
// ships no Codex packaging (no installer, no hook manifests) — that is a future
// ship step, not built here.
//
// The Codex contract is modeled from docs/research, NOT verified against a live
// Codex session: Codex's PermissionRequest hook is documented as ~1:1 with
// Claude's (one JSON object on stdin, a `hookSpecificOutput.decision.behavior =
// "allow" | "deny"` envelope plus an optional `message` deny channel on stdout),
// configured in `~/.codex/hooks.json` or the `[hooks]` table of
// `~/.codex/config.toml`, gated behind `[features] codex_hooks = true`. The exact
// stdin field names for the session/cwd/plan are NOT fully documented; they are
// modeled sensibly below and flagged provisional pending live verification (the
// same manual follow-up pattern as Claude's EXC-549). See feedback.ts (decision
// wire shape), approve.ts (the single plain-approve variant), and install.ts
// (the ~/.codex probe) for the per-surface provisional notes.

import type { AgentAdapter, InstallProbe } from "@/adapters/adapter.ts";
import { APPROVE_VARIANTS } from "@/adapters/codex/approve.ts";
import { fatalDenyLine, toHookOutput } from "@/adapters/codex/feedback.ts";
import { readCodexInstallState } from "@/adapters/codex/install.ts";
import type { Decision, PlanInput, SkillRef } from "@/lib/types.ts";

/** The shape of the PermissionRequest hook stdin Codex is modeled to pipe to
 * `caret review`. PROVISIONAL (EXC-532): the field names are docs-based, not
 * live-verified. Every field is optional — a payload missing any of them still
 * parses to a PlanInput, and the downstream guards handle the gaps. The session
 * id and cwd mirror Claude's snake_case convention; the plan is modeled under a
 * `tool_input.plan` envelope as Codex's docs describe a Claude-shaped payload. */
interface HookStdin {
  session_id?: string;
  cwd?: string;
  tool_input?: { plan?: string };
}

export const codexAdapter: AgentAdapter = {
  id: "codex",
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

  fatalDenyLine(reason: string): string {
    return fatalDenyLine(reason);
  },

  readInstallState(): InstallProbe {
    return readCodexInstallState();
  },

  // Codex contributes nothing to the reviewer's `/` completion: it has no skill or
  // command directory caret can enumerate. The empty list is what keeps the editor
  // silent on a codex review rather than painting an empty popup — filling it in
  // later is this module's business alone, not the UI's.
  listSkills(): Promise<SkillRef[]> {
    return Promise.resolve([]);
  },

  // Nothing enumerated is nothing to describe: the `/` list is empty here, so no
  // name can reach this, and null is what the panel would show anyway. Filling
  // both in is this module's business alone, not the UI's.
  readSkillDescription(): Promise<string | null> {
    return Promise.resolve(null);
  },
};
