// The agent-adapter registry/selection seam (src/adapters/index.ts). These
// assert the tool-agnostic selection contract — precedence, the unknown-id
// fail-safe, and that fatalDeny always ships a deny and never throws. The
// Claude-specific wire shape of that deny line is pinned in
// test/adapters/claude/, not here (test-layout: no agent vocabulary in core).

import { afterEach, expect, test } from "bun:test";
import type { AgentAdapter } from "../../src/adapters/adapter.ts";
import { agentIds, DEFAULT_AGENT, fatalDeny, selectAdapter } from "../../src/adapters/index.ts";

const ORIGINAL = process.env.CARET_AGENT;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CARET_AGENT;
  else process.env.CARET_AGENT = ORIGINAL;
});

function expectAdapterShape(a: AgentAdapter): void {
  expect(Array.isArray(a.approveVariants)).toBe(true);
  expect(typeof a.parseHookInput).toBe("function");
  expect(typeof a.emitDecision).toBe("function");
  expect(typeof a.fatalDenyLine).toBe("function");
  expect(typeof a.readInstallState).toBe("function");
}

test("the default agent is registered and selectable", () => {
  expect(agentIds()).toContain(DEFAULT_AGENT);
});

test("selectAdapter() with no id returns the default adapter", () => {
  delete process.env.CARET_AGENT;
  expectAdapterShape(selectAdapter());
});

test("an explicit id selects that adapter and wins over the env", () => {
  process.env.CARET_AGENT = "definitely-not-a-real-agent";
  // The explicit argument takes precedence over the (bogus) env var.
  expectAdapterShape(selectAdapter(DEFAULT_AGENT));
});

test("CARET_AGENT selects the adapter when no explicit id is given", () => {
  process.env.CARET_AGENT = DEFAULT_AGENT;
  expectAdapterShape(selectAdapter());
});

test("a blank CARET_AGENT falls through to the default", () => {
  process.env.CARET_AGENT = "   ";
  expectAdapterShape(selectAdapter());
});

test("an unknown agent id throws (so the caller fails safe to a deny)", () => {
  expect(() => selectAdapter("nope")).toThrow(/unknown agent adapter/);
});

test("an unknown CARET_AGENT throws", () => {
  process.env.CARET_AGENT = "nope";
  expect(() => selectAdapter()).toThrow(/unknown agent adapter/);
});

test("fatalDeny ships a non-empty deny line for the default adapter", () => {
  delete process.env.CARET_AGENT;
  const line = fatalDeny("boom");
  expect(typeof line).toBe("string");
  expect(line.length).toBeGreaterThan(0);
});

test("fatalDeny never throws and still ships a line when selection fails", () => {
  // A bogus CARET_AGENT makes selectAdapter throw; fatalDeny must still degrade
  // to a hard-coded deny line rather than emitting nothing (the truly-fatal path
  // always fails safe).
  process.env.CARET_AGENT = "definitely-not-a-real-agent";
  let line = "";
  expect(() => {
    line = fatalDeny("boom");
  }).not.toThrow();
  expect(line.length).toBeGreaterThan(0);
});
