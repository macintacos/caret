// The agent-adapter registry: maps a tool id to its AgentAdapter and resolves the
// active one. The composition layer (cli.ts, commands/*) selects through here
// instead of importing a specific adapter by name, so adding a coding-agent tool
// is a registry entry plus its src/adapters/<tool>/ implementation — the
// tool-agnostic core never changes.

import type { AgentAdapter } from "@/adapters/adapter.ts";
import { claudeAdapter } from "@/adapters/claude/index.ts";
import { codexAdapter } from "@/adapters/codex/index.ts";
import { opencodeAdapter } from "@/adapters/opencode/index.ts";
import { permissionRequestDenyLine } from "@/adapters/wire.ts";

/** The adapter selected when no id is given — the Claude adapter, so the existing
 * Claude plugin packaging keeps working unchanged. */
export const DEFAULT_AGENT = "claude";

/** Registered adapters keyed by tool id. */
const REGISTRY: Record<string, AgentAdapter> = {
  claude: claudeAdapter,
  // The Codex adapter is default-OFF, selectable via CARET_AGENT=codex. Its wire
  // contract is modeled from docs and not yet live-verified, and it ships no Codex
  // packaging — registering it proves the second-adapter seam (EXC-532).
  codex: codexAdapter,
  // The OpenCode adapter, selectable via CARET_AGENT=opencode (EXC-339). Unlike
  // claude/codex it is not a command-hook agent — it loads caret's in-process
  // plugin (the opencode/ packaging), which bridges to `caret review` so the
  // daemon-side review pipeline is reused unchanged. Both ends of its wire are
  // caret-owned.
  opencode: opencodeAdapter,
};

/** The registered tool ids, in registration order. */
export function agentIds(): string[] {
  return Object.keys(REGISTRY);
}

/** Resolve the active adapter. An explicit `id` wins, then CARET_AGENT, then the
 * default; a blank/unset selector falls through to the default. Throws on an
 * unknown id so the caller fails safe — the review path never silently emits a
 * different tool's wire shape. */
export function selectAdapter(id?: string): AgentAdapter {
  const raw = (id ?? process.env.CARET_AGENT ?? "").trim();
  const key = raw === "" ? DEFAULT_AGENT : raw;
  const adapter = REGISTRY[key];
  if (!adapter) {
    throw new Error(`unknown agent adapter: "${key}" (known: ${agentIds().join(", ")})`);
  }
  return adapter;
}

/** Render the last-resort fatal deny wire line for the CLI's fatal handler. Falls
 * back through progressively more dependency-free renderers so the truly-fatal path
 * always ships a deny, never nothing. */
export function fatalDeny(reason: string): string {
  let adapter: AgentAdapter | undefined;
  try {
    adapter = selectAdapter();
  } catch {
    // Selection itself failed (e.g. a bogus CARET_AGENT) — skip straight to the
    // hard-coded fallback below.
  }
  if (adapter) {
    try {
      return adapter.emitDecision({ behavior: "deny", feedback: reason, decidedAt: Date.now() });
    } catch {
      // The adapter loaded but emitDecision threw — use its dependency-free line.
    }
    try {
      return adapter.fatalDenyLine(reason);
    } catch {
      // Fall through to the hard-coded line below.
    }
  }
  return permissionRequestDenyLine(reason);
}
