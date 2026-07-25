// End-to-end Codex wire-contract fidelity (EXC-532): drive a Codex
// PermissionRequest payload through the actual pipeline — the adapter's
// parseHookInput, the core runReview, and the adapter's emitDecision — and pin the
// stdout JSON for each reviewer outcome (allow, deny+feedback). The checked-in
// fixture in fixtures/permission-request-stdin.json is a SYNTHETIC payload modeled
// from docs (Codex's contract is not live-verified, EXC-532); driving it through
// the real parse/emit code keeps these assertions from being constant-equality
// tautologies. This is the legitimate home for Codex wire-shape assertions (the
// adapter directory, per test-layout), kept out of test/core.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { setupTempStateDir } from "@test/support/env.ts";
import { codexAdapter } from "@/adapters/codex/index.ts";
import type { Decision } from "@/lib/types.ts";
import { runReview } from "@/review/orchestrate.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "permission-request-stdin.json");
const stdin = readFileSync(FIXTURE, "utf-8");

// runReview logs to caret.log; route it at a throwaway state dir so this suite
// never appends to the real ~/.local/state/caret.
setupTempStateDir("caret-codex-wire-contract-");

// Build review deps that parse with the REAL Codex adapter and fake only the
// daemon-side effects. longPoll returns the supplied decision, so one call drives
// the whole loop to that outcome.
function depsReturning(decision: Decision): Parameters<typeof runReview>[1] {
  return {
    parseHookInput: codexAdapter.parseHookInput,
    ensureDaemon: async () => "http://x",
    postReview: async () => ({ id: "rid" }),
    longPoll: async () => decision,
    openBrowser: () => {},
    timeoutMs: 1000,
    expire: async () => {},
  };
}

async function emitWire(decision: Decision): Promise<unknown> {
  const out = await runReview(stdin, depsReturning(decision));
  return JSON.parse(codexAdapter.emitDecision(out));
}

test("the fixture parses to a PlanInput carrying the modeled payload", () => {
  const input = codexAdapter.parseHookInput(stdin);
  expect(input.sessionId).toBe("c0de1a8e-1b27-4d91-9c64-7ea2f0b1d3a5");
  expect(input.cwd).toBe("/Users/dev/projects/gadget");
  expect(input.plan).toContain("# Add a status endpoint");
});

test("plain approve over the fixture emits behavior=allow with no escalation", async () => {
  expect(await emitWire({ behavior: "allow", decidedAt: 1 })).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  });
});

test("an approve variant over the fixture emits a plain allow (no escalation today)", async () => {
  expect(await emitWire({ behavior: "allow", acceptMode: "default", decidedAt: 1 })).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  });
});

test("a deny over the fixture carries the reviewer feedback in decision.message", async () => {
  expect(
    await emitWire({ behavior: "deny", feedback: "narrow step 2 to one route", decidedAt: 1 }),
  ).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "deny", message: "narrow step 2 to one route" },
    },
  });
});
