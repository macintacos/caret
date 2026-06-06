import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeAdapter } from "../../../src/adapters/claude/index.ts";
import { toHookOutput } from "../../../src/adapters/claude/feedback.ts";
import type { Decision } from "../../../src/types.ts";

test("emitDecision serializes a deny to the Claude PermissionRequest JSON", () => {
  const decision: Decision = { behavior: "deny", feedback: "tighten scope", decidedAt: 1 };
  expect(claudeAdapter.emitDecision(decision)).toBe(JSON.stringify(toHookOutput(decision)));
  // Spot-check the wire shape so a serialization regression is visible here, not
  // only via the byte-identity check above.
  expect(JSON.parse(claudeAdapter.emitDecision(decision))).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "deny", message: "tighten scope" },
    },
  });
});

test("emitDecision carries an approve variant's setMode through to stdout", () => {
  const decision: Decision = { behavior: "allow", acceptMode: "auto", decidedAt: 2 };
  expect(JSON.parse(claudeAdapter.emitDecision(decision))).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "allow",
        updatedPermissions: [{ type: "setMode", mode: "auto", destination: "session" }],
      },
    },
  });
});

test("declares its approve variants as opaque id + label tokens", () => {
  expect(claudeAdapter.approveVariants.map((v) => v.id)).toEqual([
    "default",
    "acceptEdits",
    "auto",
  ]);
  for (const variant of claudeAdapter.approveVariants) {
    expect(variant.label.length).toBeGreaterThan(0);
  }
});

test("parseHookInput maps Claude's hook stdin into a core PlanInput", () => {
  const stdin = JSON.stringify({
    session_id: "S",
    cwd: "/proj",
    transcript_path: "/tmp/t.jsonl", // present in the payload but never read
    tool_input: { plan: "# Plan" },
  });
  expect(claudeAdapter.parseHookInput(stdin)).toEqual({
    sessionId: "S",
    cwd: "/proj",
    plan: "# Plan",
  });
});

test("parseHookInput tolerates a payload missing every field", () => {
  expect(claudeAdapter.parseHookInput("{}")).toEqual({
    sessionId: undefined,
    cwd: undefined,
    plan: undefined,
  });
});

test("parseHookInput throws on malformed stdin so the caller can fail-safe deny", () => {
  expect(() => claudeAdapter.parseHookInput("not json")).toThrow("could not parse hook stdin JSON");
});

test("readInstallState returns an agent-neutral InstallProbe shape", () => {
  // The probe reads caret's own plugin entries from the Claude config dir; with
  // no install present it degrades every field to "unknown" rather than throwing.
  const savedClaude = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(tmpdir(), "caret-absent-claude-config");
  try {
    expect(claudeAdapter.readInstallState()).toEqual({
      pluginVersion: "unknown",
      pluginEnabled: "unknown",
      hookInUserSettings: "unknown",
    });
  } finally {
    if (savedClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedClaude;
  }
});
