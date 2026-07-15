// The `caret install --target` orchestrator: target parsing (pure) and dispatch to
// the injected target runners.

import { afterEach, expect, test } from "bun:test";

import { parseTargets, runInstallSubcommand } from "@/commands/install.ts";

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

test("runInstallSubcommand dispatches to each selected target with the same opts", () => {
  const calls: string[] = [];
  runInstallSubcommand(
    { target: "opencode,claude", uninstall: true, dryRun: false },
    {
      runOpencode: (o) => calls.push(`opencode:${o.uninstall}:${o.dryRun}`),
      runClaude: (o) => calls.push(`claude:${o.uninstall}:${o.dryRun}`),
    },
  );
  expect(calls).toEqual(["opencode:true:false", "claude:true:false"]);
});

test("runInstallSubcommand runs only the requested target", () => {
  const calls: string[] = [];
  runInstallSubcommand(
    { target: "opencode", uninstall: false, dryRun: true },
    {
      runOpencode: () => calls.push("opencode"),
      runClaude: () => calls.push("claude"),
    },
  );
  expect(calls).toEqual(["opencode"]);
});

test("runInstallSubcommand sets a non-zero exit code and dispatches nothing on a bad target", () => {
  const calls: string[] = [];
  runInstallSubcommand(
    { target: "bogus", uninstall: false, dryRun: false },
    { runOpencode: () => calls.push("opencode"), runClaude: () => calls.push("claude") },
  );
  expect(calls).toEqual([]);
  expect(process.exitCode).toBe(2);
});
