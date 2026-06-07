import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexAdapter } from "../../../src/adapters/codex/index.ts";
import { toHookOutput } from "../../../src/adapters/codex/feedback.ts";
import type { Decision } from "../../../src/types.ts";

test("emitDecision serializes a deny to the Codex PermissionRequest JSON", () => {
  const decision: Decision = { behavior: "deny", feedback: "tighten scope", decidedAt: 1 };
  expect(codexAdapter.emitDecision(decision)).toBe(JSON.stringify(toHookOutput(decision)));
  // Spot-check the wire shape so a serialization regression is visible here, not
  // only via the byte-identity check above.
  expect(JSON.parse(codexAdapter.emitDecision(decision))).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "deny", message: "tighten scope" },
    },
  });
});

test("emitDecision renders a plain allow with no mode escalation", () => {
  // Codex's permission-escalation fields are reserved/fail-closed today, so an
  // approve carrying an acceptMode still emits a plain allow (the acceptMode is
  // dropped, not escalated) — see src/adapters/codex/feedback.ts.
  const decision: Decision = { behavior: "allow", acceptMode: "default", decidedAt: 2 };
  expect(JSON.parse(codexAdapter.emitDecision(decision))).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  });
});

test("an allow carrying an unsupported escalating mode still emits a plain allow", () => {
  // Even a mode token Codex doesn't (yet) support escalates nothing on the wire:
  // the plan is approved, the escalation silently dropped.
  const decision: Decision = { behavior: "allow", acceptMode: "auto", decidedAt: 3 };
  expect(JSON.parse(codexAdapter.emitDecision(decision))).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  });
});

test("declares a single plain approve variant with the reviewer-facing label", () => {
  // The label is the source of truth the UI renders verbatim. Codex exposes only a
  // plain approve because its escalation modes are not stable/live-verified yet.
  expect(codexAdapter.approveVariants).toEqual([
    { id: "default", label: "Approve", description: "Approve this plan" },
  ]);
});

test("parseHookInput maps Codex's hook stdin into a core PlanInput", () => {
  const stdin = JSON.stringify({
    session_id: "S",
    cwd: "/proj",
    hook_event_name: "PermissionRequest", // present in the payload but never read
    tool_input: { plan: "# Plan" },
  });
  expect(codexAdapter.parseHookInput(stdin)).toEqual({
    sessionId: "S",
    cwd: "/proj",
    plan: "# Plan",
  });
});

test("parseHookInput tolerates a payload missing every field", () => {
  expect(codexAdapter.parseHookInput("{}")).toEqual({
    sessionId: undefined,
    cwd: undefined,
    plan: undefined,
  });
});

test("parseHookInput throws on malformed stdin so the caller can fail-safe deny", () => {
  expect(() => codexAdapter.parseHookInput("not json")).toThrow("could not parse hook stdin JSON");
});

test("readInstallState returns an agent-neutral InstallProbe shape", () => {
  // The probe reads caret's Codex hook state from the Codex config dir; with no
  // install present it degrades every field to "unknown" (pluginVersion is always
  // "unknown" — there is no Codex-side caret package).
  const savedCodex = process.env.CODEX_HOME;
  process.env.CODEX_HOME = join(tmpdir(), "caret-absent-codex-config");
  try {
    expect(codexAdapter.readInstallState()).toEqual({
      pluginVersion: "unknown",
      pluginEnabled: "unknown",
      hookInUserSettings: "unknown",
    });
  } finally {
    if (savedCodex === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = savedCodex;
  }
});

test("fatalDenyLine is a dependency-free deny wire line", () => {
  expect(JSON.parse(codexAdapter.fatalDenyLine("daemon unreachable"))).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "deny", message: "daemon unreachable" },
    },
  });
});
