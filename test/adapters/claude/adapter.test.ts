import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { toHookOutput } from "@/adapters/claude/feedback.ts";
import { claudeAdapter } from "@/adapters/claude/index.ts";
import type { Decision } from "@/lib/types.ts";

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

test("emitDecision echoes the plan input as updatedInput and carries the setMode to stdout", () => {
  // emitDecision receives the parsed hook input so it can echo tool_input back as
  // updatedInput — without it Claude Code >=2.1.199 discards the allow (EXC-683).
  const decision: Decision = { behavior: "allow", acceptMode: "auto", decidedAt: 2 };
  const input = { plan: "# Ship it", planFilePath: "/home/u/.claude/plans/x.md" };
  expect(JSON.parse(claudeAdapter.emitDecision(decision, input))).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "allow",
        updatedInput: { plan: "# Ship it", planFilePath: "/home/u/.claude/plans/x.md" },
        updatedPermissions: [{ type: "setMode", mode: "auto", destination: "session" }],
      },
    },
  });
});

test("declares its approve variants with the reviewer-facing labels", () => {
  // The labels are the source of truth the UI renders verbatim; pinning them
  // here keeps the wire declaration and the e2e-pinned button text in lockstep.
  expect(claudeAdapter.approveVariants).toEqual([
    { id: "default", label: "Approve", description: "Approve edits manually" },
    {
      id: "acceptEdits",
      label: "Approve & accept edits",
      description: "Auto-accept file edits this session",
    },
    {
      id: "auto",
      label: "Approve & auto mode",
      description: "Full auto mode this session",
    },
  ]);
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

test("parseHookInput lifts the plan file path so caret can canonicalize it", () => {
  const stdin = JSON.stringify({
    session_id: "S",
    cwd: "/proj",
    tool_input: { plan: "# Plan", planFilePath: "/home/u/.claude/plans/widget.md" },
  });
  expect(claudeAdapter.parseHookInput(stdin)).toMatchObject({
    plan: "# Plan",
    planFilePath: "/home/u/.claude/plans/widget.md",
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
