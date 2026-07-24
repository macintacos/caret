// The `caret install` orchestrator: target parsing (pure), the no-`--target` selection
// policy (chooser on a TTY, detected agents otherwise), and dispatch to the injected
// target runners.

import { afterEach, expect, test } from "bun:test";

import { parseTargets, runInstallSubcommand } from "@/commands/install.ts";
import type { InstallTarget } from "@/commands/install-targets.ts";

test("parseTargets accepts a single target, both, and dedupes/preserves order", () => {
  expect(parseTargets("opencode")).toEqual({ targets: ["opencode"] });
  expect(parseTargets("claude")).toEqual({ targets: ["claude"] });
  expect(parseTargets("opencode,claude")).toEqual({ targets: ["opencode", "claude"] });
  expect(parseTargets(" claude , opencode ")).toEqual({ targets: ["claude", "opencode"] });
  expect(parseTargets("opencode,opencode")).toEqual({ targets: ["opencode"] });
});

test("parseTargets errors on an empty or unknown target", () => {
  expect(parseTargets(undefined)).toHaveProperty("error");
  expect(parseTargets("")).toHaveProperty("error");
  const bad = parseTargets("opencode,vim");
  expect("error" in bad && bad.error).toContain("vim");
});

afterEach(() => {
  process.exitCode = 0;
});

test("runInstallSubcommand dispatches to each selected target with the same opts", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { target: "opencode,claude", uninstall: true, dryRun: false },
    {
      runOpencode: (o) => calls.push(`opencode:${o.uninstall}:${o.dryRun}`),
      runClaude: (o) => calls.push(`claude:${o.uninstall}:${o.dryRun}`),
    },
  );
  expect(calls).toEqual(["opencode:true:false", "claude:true:false"]);
});

test("runInstallSubcommand runs only the requested target", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { target: "opencode", uninstall: false, dryRun: true },
    {
      runOpencode: () => calls.push("opencode"),
      runClaude: () => calls.push("claude"),
    },
  );
  expect(calls).toEqual(["opencode"]);
});

test("runInstallSubcommand sets a non-zero exit code and dispatches nothing on a bad target", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { target: "bogus", uninstall: false, dryRun: false },
    { runOpencode: () => calls.push("opencode"), runClaude: () => calls.push("claude") },
  );
  expect(calls).toEqual([]);
  expect(process.exitCode).toBe(2);
});

test("with no --target on a TTY, the chooser sees the detected agents and drives dispatch", async () => {
  const calls: string[] = [];
  let offered: InstallTarget[] = [];
  await runInstallSubcommand(
    { uninstall: false, dryRun: false },
    {
      detect: () => ["claude"],
      isInteractive: () => true,
      prompt: async (detected) => {
        offered = detected;
        return ["opencode", "claude"];
      },
      runOpencode: () => calls.push("opencode"),
      runClaude: () => calls.push("claude"),
    },
  );
  expect(offered).toEqual(["claude"]);
  expect(calls).toEqual(["opencode", "claude"]);
});

test("a cancelled chooser installs nothing", async () => {
  const calls: string[] = [];
  let prompted = false;
  await runInstallSubcommand(
    { uninstall: false, dryRun: false },
    {
      detect: () => ["claude", "opencode"],
      isInteractive: () => true,
      prompt: async () => {
        prompted = true;
        return null;
      },
      runOpencode: () => calls.push("opencode"),
      runClaude: () => calls.push("claude"),
    },
  );
  expect(prompted).toBe(true);
  expect(calls).toEqual([]);
});

test("with no --target and no TTY, every detected agent is installed without prompting", async () => {
  const calls: string[] = [];
  let prompted = false;
  await runInstallSubcommand(
    { uninstall: false, dryRun: false },
    {
      detect: () => ["claude", "opencode"],
      isInteractive: () => false,
      prompt: async () => {
        prompted = true;
        return null;
      },
      runOpencode: () => calls.push("opencode"),
      runClaude: () => calls.push("claude"),
    },
  );
  expect(prompted).toBe(false);
  expect(calls).toEqual(["claude", "opencode"]);
});

test("with no --target, no TTY, and no agent detected, it falls back to Claude Code", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { uninstall: false, dryRun: false },
    {
      detect: () => [],
      isInteractive: () => false,
      prompt: async () => null,
      runOpencode: () => calls.push("opencode"),
      runClaude: () => calls.push("claude"),
    },
  );
  expect(calls).toEqual(["claude"]);
});

test("--dry-run without --target previews the detected agents instead of prompting", async () => {
  const calls: string[] = [];
  let prompted = false;
  await runInstallSubcommand(
    { uninstall: false, dryRun: true },
    {
      detect: () => ["opencode"],
      isInteractive: () => true,
      prompt: async () => {
        prompted = true;
        return null;
      },
      runOpencode: () => calls.push("opencode"),
      runClaude: () => calls.push("claude"),
    },
  );
  expect(prompted).toBe(false);
  expect(calls).toEqual(["opencode"]);
});
