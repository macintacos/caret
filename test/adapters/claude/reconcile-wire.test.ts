// End-to-end Claude wire-contract for the reconcile hook (EXC-482): drive a
// REALISTIC Claude PostToolUse/ExitPlanMode payload through the actual pipeline —
// the adapter's parseHookInput and the core runReconcile — and assert a terminal
// approval is reconciled against the daemon's pending review. The checked-in
// fixture in fixtures/exit-plan-mode-posttooluse-stdin.json is the real payload
// shape (session_id, cwd, tool_name, hook_event_name: "PostToolUse", tool_input,
// tool_response); driving it through the real parser keeps this from being a
// constant-equality tautology. This is the legitimate home for Claude wire-shape
// assertions (the adapter directory, per test-layout).

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { setupTempStateDir } from "@test/support/env.ts";
import { claudeAdapter } from "@/adapters/claude/index.ts";
import type { ClientReview } from "@/lib/types.ts";
import { runReconcile } from "@/review/reconcile.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "exit-plan-mode-posttooluse-stdin.json");
const stdin = readFileSync(FIXTURE, "utf-8");
const fixtureSession = (JSON.parse(stdin) as { session_id: string }).session_id;

// runReconcile logs best-effort lines to caret.log; route them at a throwaway
// state dir so this suite never appends to the real ~/.local/state/caret.
setupTempStateDir("caret-reconcile-wire-");

function pendingReview(over: Partial<ClientReview> = {}): ClientReview {
  return {
    id: "rid",
    sessionId: fixtureSession,
    cwd: "/Users/dev/projects/widget",
    title: "Add a health-check endpoint",
    status: "pending",
    planEpoch: 0,
    version: 1,
    currentPlan: "# Add a health-check endpoint\n",
    annotations: [],
    versions: [],
    generalCommentDraft: "",
    composerScratches: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

test("the PostToolUse fixture parses to a PlanInput carrying the session id and plan", () => {
  const input = claudeAdapter.parseHookInput(stdin);
  expect(input.sessionId).toBe(fixtureSession);
  expect(input.plan).toContain("# Add a health-check endpoint");
});

test("a terminal approval reconciles the daemon's pending review for that session", async () => {
  const resolved: string[] = [];
  await runReconcile(stdin, {
    parseHookInput: claudeAdapter.parseHookInput,
    listReviews: async () => [pendingReview({ id: "rid" })],
    resolveReview: async (id) => {
      resolved.push(id);
    },
  });
  expect(resolved).toEqual(["rid"]);
});

test("a pending review for a different session is left untouched", async () => {
  const resolved: string[] = [];
  await runReconcile(stdin, {
    parseHookInput: claudeAdapter.parseHookInput,
    listReviews: async () => [pendingReview({ id: "other", sessionId: "some-other-session" })],
    resolveReview: async (id) => {
      resolved.push(id);
    },
  });
  expect(resolved).toEqual([]);
});
