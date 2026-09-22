// Shared scaffolding for the per-adapter wire-contract suites: a fixture's raw
// hook stdin is driven through the real code path, so each suite's assertions
// pin what its own adapter actually emits rather than a constant-equality
// tautology.
import { expect } from "bun:test";

import type { Decision, PlanInput } from "@/lib/types.ts";
import { parseHook, type ReviewDeps, runReview } from "@/review/orchestrate.ts";

/** The adapter surface `emitWire` needs — every `AgentAdapter` satisfies it. */
export interface WireAdapter {
  parseHookInput(stdin: string): PlanInput;
  emitDecision(decision: Decision, input?: PlanInput): string;
}

/** runReview deps faking every effect: a daemon that creates review "rid" and
 * approves it. */
export function fakeReviewDeps(overrides: Partial<ReviewDeps> = {}): ReviewDeps {
  return {
    ensureDaemon: async () => "http://x",
    postReview: async () => ({ id: "rid" }),
    longPoll: async () => ({ behavior: "allow", decidedAt: 1 }),
    openBrowser: () => {},
    announceUrl: () => {},
    timeoutMs: 1000,
    expire: async () => {},
    ...overrides,
  };
}

/**
 * Run the real parse -> runReview -> emitDecision path over `stdin` and return
 * the parsed stdout wire object the hook would write.
 */
export async function emitWire(
  stdin: string,
  decision: Decision,
  adapter: WireAdapter,
): Promise<unknown> {
  const parsed = parseHook(adapter.parseHookInput, stdin);
  const out = await runReview(parsed, fakeReviewDeps({ longPoll: async () => decision }));
  return JSON.parse(adapter.emitDecision(out, "input" in parsed ? parsed.input : undefined));
}

/**
 * Assert the shared deny contract over the fixture: a deny carries the
 * reviewer feedback verbatim as `decision.message` (identical between Claude
 * and Codex — Codex's PermissionRequest envelope is modeled ~1:1 on Claude's).
 */
export async function expectWireDenyContract(
  emitWire: (decision: Decision) => Promise<unknown>,
  feedback = "narrow step 2 to one route",
): Promise<void> {
  expect(await emitWire({ behavior: "deny", feedback, decidedAt: 1 })).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "deny", message: feedback },
    },
  });
}
