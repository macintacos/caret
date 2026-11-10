// End-to-end OpenCode wire-contract fidelity: drive a caret OpenCode review
// envelope through the actual pipeline — the adapter's parseHookInput, the core
// runReview, and the adapter's emitDecision — and pin the stdout JSON for each
// reviewer outcome (allow, deny+feedback). Unlike the Claude/Codex adapters, both
// ends of THIS wire are caret-owned: the OpenCode plugin builds the envelope and
// pipes it to `caret review`, and reads the decision JSON the adapter emits. The
// checked-in fixture is the exact envelope the plugin sends; driving it through the
// real parse/emit code keeps these assertions from being constant-equality
// tautologies. This is the legitimate home for OpenCode wire-shape assertions (the
// adapter directory, per test-layout), kept out of test/core.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildEnvelope, parseDecision } from "@bridge/review-bridge.ts";
import { APPROVE_AND_BUILD } from "@oc/caret.plugin.v2.ts";
import { setupTempStateDir } from "@test/support/env.ts";
import { emitWire as emitWireVia } from "@test/support/wire-contract.ts";
import { APPROVE_VARIANTS, BUILD_VARIANT } from "@/adapters/opencode/approve.ts";
import { opencodeAdapter } from "@/adapters/opencode/index.ts";
import type { Decision } from "@/lib/types.ts";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "review-request-stdin.json");
const stdin = readFileSync(FIXTURE, "utf-8");

setupTempStateDir("caret-opencode-wire-contract-");

function emitWire(decision: Decision): Promise<unknown> {
  return emitWireVia(stdin, decision, opencodeAdapter);
}

test("the fixture parses to a PlanInput carrying the envelope payload", () => {
  const input = opencodeAdapter.parseHookInput(stdin);
  expect(input.sessionId).toBe("0pen-c0de-1b27-4d91-9c64-7ea2f0b1d3a5");
  expect(input.cwd).toBe("/Users/dev/projects/gadget");
  expect(input.plan).toContain("# Add a status endpoint");
});

test("plain approve over the fixture emits behavior=allow", async () => {
  expect(await emitWire({ behavior: "allow", decidedAt: 1 })).toEqual({ behavior: "allow" });
});

test("the default approve variant over the fixture emits a bare allow", async () => {
  expect(await emitWire({ behavior: "allow", acceptMode: "default", decidedAt: 1 })).toEqual({
    behavior: "allow",
  });
});

test("approve & build over the fixture carries acceptMode build", async () => {
  expect(await emitWire({ behavior: "allow", acceptMode: "build", decidedAt: 1 })).toEqual({
    behavior: "allow",
    acceptMode: "build",
  });
});

test("the plugin's parseDecision keeps an emitted acceptMode and notes", () => {
  const line = opencodeAdapter.emitDecision({
    behavior: "allow",
    acceptMode: "build",
    feedback: "use the helper",
    decidedAt: 1,
  });
  expect(parseDecision(line)).toEqual({
    behavior: "allow",
    acceptMode: "build",
    feedback: "use the helper",
  });
});

test("a v2 envelope's approve & build declaration reaches the PlanInput", () => {
  const ctx = { sessionID: "S", directory: "/proj" };
  const declared = buildEnvelope("# P", { ...ctx, approveVariants: [APPROVE_AND_BUILD] });
  expect(opencodeAdapter.parseHookInput(declared).approveVariants).toEqual([
    ...APPROVE_VARIANTS,
    BUILD_VARIANT,
  ]);
  expect(opencodeAdapter.parseHookInput(buildEnvelope("# P", ctx)).approveVariants).toBe(undefined);
});

test("the adapter's build variant id is the one the v2 plugin declares", () => {
  expect(BUILD_VARIANT.id).toBe(APPROVE_AND_BUILD);
});

test("a deny over the fixture carries the reviewer feedback", async () => {
  expect(
    await emitWire({ behavior: "deny", feedback: "narrow step 2 to one route", decidedAt: 1 }),
  ).toEqual({ behavior: "deny", feedback: "narrow step 2 to one route" });
});

test("the envelope the plugin builds for a plan file parses to that planFilePath", () => {
  const envelope = buildEnvelope("# P", {
    sessionID: "S",
    directory: "/proj",
    planFilePath: "/proj/.opencode/plans/p.md",
  });
  expect(opencodeAdapter.parseHookInput(envelope).planFilePath).toBe("/proj/.opencode/plans/p.md");
});
