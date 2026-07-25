// End-to-end Claude wire-contract fidelity (EXC-531): drive a REALISTIC Claude
// PermissionRequest/ExitPlanMode payload through the actual pipeline — the
// adapter's parseHookInput, the core runReview, and the adapter's emitDecision —
// and pin the exact stdout JSON for each reviewer outcome (plain allow,
// allow+acceptEdits, allow+auto, deny+feedback). The checked-in fixture in
// fixtures/permission-request-stdin.json is the real payload shape (session_id,
// cwd, tool_name, hook_event_name, tool_input.plan); driving it through the real
// parse/emit code keeps these assertions from being constant-equality tautologies.
//
// This is the legitimate home for Claude wire-shape assertions (the adapter
// directory, per test-layout). The decision JSON shape — the object-array
// `updatedPermissions:[{type:"setMode",...}]` — is what caret empirically emits;
// the live-contract verification is the manual follow-up EXC-549.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { setupTempStateDir } from "@test/support/env.ts";
import { claudeAdapter } from "@/adapters/claude/index.ts";
import type { Decision } from "@/lib/types.ts";
import { runReview } from "@/review/orchestrate.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "permission-request-stdin.json");
const stdin = readFileSync(FIXTURE, "utf-8");
// The plan the fixture's ExitPlanMode call carried. Every allow envelope must
// echo the original tool_input back as decision.updatedInput, or Claude Code
// >=2.1.199 silently discards the allow (EXC-683). Read it from the fixture so
// the assertion tracks the fixture rather than duplicating the plan text.
const fixturePlan = (JSON.parse(stdin) as { tool_input: { plan: string } }).tool_input.plan;

// runReview logs the review timeline to caret.log; route it at a throwaway state
// dir so this suite never appends to the real ~/.local/state/caret.
setupTempStateDir("caret-wire-contract-");

// Build review deps that parse with the REAL Claude adapter and fake only the
// daemon-side effects (the network, the browser, the timer). longPoll returns the
// supplied decision, so one call drives the whole loop to that outcome.
function depsReturning(decision: Decision): Parameters<typeof runReview>[1] {
  return {
    parseHookInput: claudeAdapter.parseHookInput,
    ensureDaemon: async () => "http://x",
    postReview: async () => ({ id: "rid" }),
    longPoll: async () => decision,
    openBrowser: () => {},
    timeoutMs: 1000,
    expire: async () => {},
  };
}

// Run the real parse → runReview → emitDecision path over the fixture and return
// the parsed stdout wire object the hook would write.
async function emitWire(decision: Decision): Promise<unknown> {
  const out = await runReview(stdin, depsReturning(decision));
  return JSON.parse(claudeAdapter.emitDecision(out, claudeAdapter.parseHookInput(stdin)));
}

test("the fixture parses to a PlanInput carrying the realistic payload", () => {
  // parseHookInput ignores the unknown fields a real payload carries
  // (transcript_path, tool_name, hook_event_name) and lifts session_id, cwd, and
  // tool_input.plan into the core PlanInput.
  const input = claudeAdapter.parseHookInput(stdin);
  expect(input.sessionId).toBe("5f3c1a8e-0b27-4d91-9c64-7ea2f0b1d3a5");
  expect(input.cwd).toBe("/Users/dev/projects/widget");
  expect(input.plan).toContain("# Add a health-check endpoint");
});

test("plain approve over the fixture echoes tool_input as updatedInput on the allow", async () => {
  // The updatedInput echo is what stops Claude Code >=2.1.199 from discarding the
  // allow (EXC-683). A plain approve carries no permission change, so updatedInput
  // is the only thing keeping the allow alive.
  expect(await emitWire({ behavior: "allow", decidedAt: 1 })).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow", updatedInput: { plan: fixturePlan } },
    },
  });
});

test("approve + acceptEdits over the fixture carries updatedInput and a setMode acceptEdits permission", async () => {
  expect(await emitWire({ behavior: "allow", acceptMode: "acceptEdits", decidedAt: 1 })).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "allow",
        updatedInput: { plan: fixturePlan },
        updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
      },
    },
  });
});

test("approve + auto over the fixture carries updatedInput and a setMode auto permission", async () => {
  expect(await emitWire({ behavior: "allow", acceptMode: "auto", decidedAt: 1 })).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "allow",
        updatedInput: { plan: fixturePlan },
        updatedPermissions: [{ type: "setMode", mode: "auto", destination: "session" }],
      },
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
