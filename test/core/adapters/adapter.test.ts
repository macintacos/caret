// The agent-adapter registry/selection seam (src/adapters/index.ts). These
// assert the tool-agnostic selection contract — precedence, the unknown-id
// fail-safe, and that fatalDeny always ships a deny and never throws. The
// Claude-specific wire shape of that deny line is pinned in
// test/adapters/claude/, not here (test-layout: no agent vocabulary in core).

import { afterEach, expect, test } from "bun:test";

import type { AgentAdapter } from "@/adapters/adapter.ts";
import { agentIds, DEFAULT_AGENT, fatalDeny, selectAdapter } from "@/adapters/index.ts";

// A second registered id proves selection resolves more than one adapter. The id
// is a registry key, not agent wire vocabulary, so it stays clear of the
// test-layout boundary (Codex's wire shape is pinned in test/adapters/codex/).
const SECOND_AGENT = "codex";

const ORIGINAL = process.env.CARET_AGENT;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CARET_AGENT;
  else process.env.CARET_AGENT = ORIGINAL;
});

function expectAdapterShape(a: AgentAdapter): void {
  expect(typeof a.id).toBe("string");
  expect(Array.isArray(a.approveVariants)).toBe(true);
  expect(typeof a.parseHookInput).toBe("function");
  expect(typeof a.emitDecision).toBe("function");
  expect(typeof a.fatalDenyLine).toBe("function");
  expect(typeof a.readInstallState).toBe("function");
  expect(typeof a.listSkills).toBe("function");
  expect(typeof a.readSkillDescription).toBe("function");
}

// Each adapter self-declares its id, and it must match the registry key it is
// selected by — the id is the "source" the daemon publishes on /api/health
// (EXC-791), so a mismatch would mislabel the environment in the UI.
test("each adapter's id matches its registry key", () => {
  for (const id of agentIds()) {
    expect(selectAdapter(id).id).toBe(id);
  }
});

test("the default agent is registered and selectable", () => {
  expect(agentIds()).toContain(DEFAULT_AGENT);
});

test("a second adapter is registered alongside the default", () => {
  // Proves the registry holds more than one adapter (EXC-532) without naming the
  // default — claude stays the default, the second id is just another entry.
  expect(agentIds()).toContain(SECOND_AGENT);
  expect(DEFAULT_AGENT).not.toBe(SECOND_AGENT);
});

test("selectAdapter resolves each registered id to a distinct adapter", () => {
  delete process.env.CARET_AGENT;
  const def = selectAdapter(DEFAULT_AGENT);
  const second = selectAdapter(SECOND_AGENT);
  expectAdapterShape(def);
  expectAdapterShape(second);
  // Selection picks the right instance, not a shared/default fallback.
  expect(second).not.toBe(def);
  // The no-id default is the default adapter, not the second one.
  expect(selectAdapter()).toBe(def);
});

test("CARET_AGENT selects the second adapter end-to-end", () => {
  // The acceptance criterion: CARET_AGENT=codex resolves the codex adapter through
  // the env path, distinct from the claude default.
  process.env.CARET_AGENT = SECOND_AGENT;
  const viaEnv = selectAdapter();
  expect(viaEnv).toBe(selectAdapter(SECOND_AGENT));
  expect(viaEnv).not.toBe(selectAdapter(DEFAULT_AGENT));
});

test("the opencode adapter is registered and selectable via its id and env", () => {
  // EXC-339: a third registered adapter, resolvable both by explicit id and via
  // CARET_AGENT, and distinct from the claude default. Its wire shape is pinned in
  // test/adapters/opencode/, not here (test-layout: no agent vocabulary in core).
  expect(agentIds()).toContain("opencode");
  delete process.env.CARET_AGENT;
  const oc = selectAdapter("opencode");
  expectAdapterShape(oc);
  expect(oc).not.toBe(selectAdapter(DEFAULT_AGENT));
  process.env.CARET_AGENT = "opencode";
  expect(selectAdapter()).toBe(oc);
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
