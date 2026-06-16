import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toWireDecision } from "../../../src/adapters/opencode/feedback.ts";
import { opencodeAdapter } from "../../../src/adapters/opencode/index.ts";
import type { Decision } from "../../../src/types.ts";

test("emitDecision serializes a deny to the caret OpenCode decision JSON", () => {
  const decision: Decision = { behavior: "deny", feedback: "tighten scope", decidedAt: 1 };
  expect(opencodeAdapter.emitDecision(decision)).toBe(JSON.stringify(toWireDecision(decision)));
  // Spot-check the wire shape so a serialization regression is visible here, not
  // only via the byte-identity check above. Both ends of this wire are
  // caret-owned (the plugin pipes to `caret review`, the adapter renders back to
  // the plugin), so the shape is a clean flat decision — no foreign hook envelope.
  expect(JSON.parse(opencodeAdapter.emitDecision(decision))).toEqual({
    behavior: "deny",
    feedback: "tighten scope",
  });
});

test("emitDecision renders a plain allow with no escalation (acceptMode dropped)", () => {
  const decision: Decision = { behavior: "allow", acceptMode: "default", decidedAt: 2 };
  expect(JSON.parse(opencodeAdapter.emitDecision(decision))).toEqual({ behavior: "allow" });
});

test("declares a single plain approve variant with the reviewer-facing label", () => {
  expect(opencodeAdapter.approveVariants).toEqual([
    { id: "default", label: "Approve", description: "Approve this plan" },
  ]);
});

test("parseHookInput maps the caret OpenCode envelope into a core PlanInput", () => {
  const stdin = JSON.stringify({
    session_id: "S",
    cwd: "/proj",
    tool_input: { plan: "# Plan", title: "T" },
  });
  expect(opencodeAdapter.parseHookInput(stdin)).toEqual({
    sessionId: "S",
    cwd: "/proj",
    plan: "# Plan",
    title: "T",
  });
});

test("parseHookInput tolerates a payload missing every field", () => {
  expect(opencodeAdapter.parseHookInput("{}")).toEqual({
    sessionId: undefined,
    cwd: undefined,
    plan: undefined,
    title: undefined,
  });
});

test("parseHookInput throws on malformed stdin so the caller can fail-safe deny", () => {
  expect(() => opencodeAdapter.parseHookInput("not json")).toThrow(
    "could not parse hook stdin JSON",
  );
});

test("readInstallState returns an agent-neutral InstallProbe shape (all unknown when absent)", () => {
  const savedDir = process.env.OPENCODE_CONFIG_DIR;
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.OPENCODE_CONFIG_DIR = join(tmpdir(), "caret-absent-opencode-config");
  delete process.env.XDG_CONFIG_HOME;
  try {
    expect(opencodeAdapter.readInstallState()).toEqual({
      pluginVersion: "unknown",
      pluginEnabled: "unknown",
      hookInUserSettings: "unknown",
    });
  } finally {
    if (savedDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = savedDir;
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
  }
});

test("fatalDenyLine is a dependency-free deny wire line", () => {
  expect(JSON.parse(opencodeAdapter.fatalDenyLine("daemon unreachable"))).toEqual({
    behavior: "deny",
    feedback: "daemon unreachable",
  });
});
