// End-to-end pi wire-contract fidelity: pi's extension speaks the same caret-owned
// envelope and flat allow/deny decision OpenCode's plugin does, so the shared envelope
// fixture and review bridge drive pi's real parse/emit code here. pi declares no
// approve variants, so its wire never carries an acceptMode.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildEnvelope, parseDecision } from "@bridge/review-bridge.ts";
import { setupTempStateDir } from "@test/support/env.ts";
import { emitWire as emitWireVia } from "@test/support/wire-contract.ts";
import { piAdapter } from "@/adapters/pi/index.ts";
import type { Decision } from "@/lib/types.ts";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "review-request-stdin.json");
const stdin = readFileSync(FIXTURE, "utf-8");

setupTempStateDir("caret-pi-wire-contract-");

function emitWire(decision: Decision): Promise<unknown> {
  return emitWireVia(stdin, decision, piAdapter);
}

function readBack(decision: Decision): unknown {
  return parseDecision(piAdapter.emitDecision(decision));
}

test("the caret envelope fixture parses to a PlanInput carrying its payload", () => {
  const input = piAdapter.parseHookInput(stdin);
  expect(input.sessionId).toBe("0pen-c0de-1b27-4d91-9c64-7ea2f0b1d3a5");
  expect(input.cwd).toBe("/Users/dev/projects/gadget");
  expect(input.plan).toContain("# Add a status endpoint");
});

test("an envelope's declared approve variants are not adopted", () => {
  const envelope = buildEnvelope("# P", {
    sessionID: "s1",
    directory: "/repo",
    planFilePath: "/repo/plan.md",
    approveVariants: ["build"],
  });
  expect(piAdapter.parseHookInput(envelope)).toEqual({
    sessionId: "s1",
    cwd: "/repo",
    plan: "# P",
    planFilePath: "/repo/plan.md",
  });
});

test("a plain approve reads back as a bare allow", () => {
  expect(readBack({ behavior: "allow", decidedAt: 1 })).toEqual({ behavior: "allow" });
});

test("an approve with notes reads back carrying them", () => {
  expect(readBack({ behavior: "allow", feedback: "use the retry helper", decidedAt: 1 })).toEqual({
    behavior: "allow",
    feedback: "use the retry helper",
  });
});

test("request changes reads back as a deny with the feedback", () => {
  expect(readBack({ behavior: "deny", feedback: "Fix the bug", decidedAt: 1 })).toEqual({
    behavior: "deny",
    feedback: "Fix the bug",
  });
});

test("an allow with an accept mode emits none over the fixture", async () => {
  expect(await emitWire({ behavior: "allow", acceptMode: "build", decidedAt: 1 })).toEqual({
    behavior: "allow",
  });
});

test("the fatal deny line is a flat deny with the reason", () => {
  expect(JSON.parse(piAdapter.fatalDenyLine("boom"))).toEqual({
    behavior: "deny",
    feedback: "boom",
    failsafe: true,
  });
});

test("caret's own fail-safe deny reads back marked failsafe", () => {
  expect(readBack({ behavior: "deny", feedback: "x", failsafe: true, decidedAt: 1 })).toEqual({
    behavior: "deny",
    feedback: "x",
    failsafe: true,
  });
});
