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

import { opencodeAdapter } from "@/adapters/opencode/index.ts";
import type { Decision } from "@/lib/types.ts";
import { runReview } from "@/review/orchestrate.ts";

import { setupTempStateDir } from "../../support/env.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "review-request-stdin.json");
const stdin = readFileSync(FIXTURE, "utf-8");

setupTempStateDir("caret-opencode-wire-contract-");

function depsReturning(decision: Decision): Parameters<typeof runReview>[1] {
  return {
    parseHookInput: opencodeAdapter.parseHookInput,
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
  return JSON.parse(opencodeAdapter.emitDecision(out));
}

test("the fixture parses to a PlanInput carrying the envelope payload", () => {
  const input = opencodeAdapter.parseHookInput(stdin);
  expect(input.sessionId).toBe("0pen-c0de-1b27-4d91-9c64-7ea2f0b1d3a5");
  expect(input.cwd).toBe("/Users/dev/projects/gadget");
  expect(input.title).toBe("Add a status endpoint");
  expect(input.plan).toContain("# Add a status endpoint");
});

test("plain approve over the fixture emits behavior=allow", async () => {
  expect(await emitWire({ behavior: "allow", decidedAt: 1 })).toEqual({ behavior: "allow" });
});

test("an approve variant over the fixture emits a plain allow (no escalation in v1)", async () => {
  expect(await emitWire({ behavior: "allow", acceptMode: "default", decidedAt: 1 })).toEqual({
    behavior: "allow",
  });
});

test("a deny over the fixture carries the reviewer feedback", async () => {
  expect(
    await emitWire({ behavior: "deny", feedback: "narrow step 2 to one route", decidedAt: 1 }),
  ).toEqual({ behavior: "deny", feedback: "narrow step 2 to one route" });
});
