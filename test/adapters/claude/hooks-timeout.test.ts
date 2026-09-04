// The hooks.json ↔ review-timeout coupling (EXC-531). caret's own fail-safe deny
// must always emit BEFORE Claude Code kills the hook: if the review-timeout
// ceiling ever reached or exceeded the hook's `timeout` budget, the hook could be
// killed mid-review with no decision on stdout — and a killed hook is NOT a deny.
//
// Two numbers must stay coupled in the safe direction (hook budget strictly
// greater than the review ceiling). They live in two files Claude Code's plugin
// system keeps apart — `hooks/hooks.json` (the plugin's on-disk hook manifest)
// and the review-timeout ceiling enforced by the settings schema — so this suite
// reads BOTH and fails if either drifts.
//
// It reads the Claude plugin's hook manifest and matches Claude's PermissionRequest
// /ExitPlanMode vocabulary, so it lives beside the Claude adapter (test-layout),
// not in test/core.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOOK_TIMEOUT_S } from "@/config/constants.ts";
import { DEFAULTS, loadSettings } from "@/config/settings.ts";

// hooks/hooks.json sits at the repo root, two dirs up from src/, four up from here.
const HOOKS_JSON = join(import.meta.dir, "../../../hooks/hooks.json");

interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}
interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}
interface HooksFile {
  hooks: Record<string, HookMatcher[]>;
}

/** The PermissionRequest/ExitPlanMode hook's declared `timeout` (seconds) — the
 * budget Claude Code gives `caret review` before it kills the hook. */
function permissionRequestTimeout(file: HooksFile): number {
  const matchers = file.hooks.PermissionRequest ?? [];
  const exitPlanMode = matchers.find((m) => m.matcher === "ExitPlanMode");
  const entry = exitPlanMode?.hooks.find((h) => h.command.includes("caret review"));
  if (entry?.timeout === undefined) {
    throw new Error("no PermissionRequest/ExitPlanMode `caret review` hook timeout in hooks.json");
  }
  return entry.timeout;
}

test("hooks.json's PermissionRequest timeout is the named HOOK_TIMEOUT_S budget", async () => {
  const file = JSON.parse(await Bun.file(HOOKS_JSON).text()) as HooksFile;
  // Editing the hooks.json number alone fails here: the manifest and the constant
  // the settings ceiling is built from are the same single source.
  expect(permissionRequestTimeout(file)).toBe(HOOK_TIMEOUT_S);
});

// Drive the review-timeout ceiling through its REAL load path so the assertion
// can't be a tautology against the schema literal: write a config.toml, load it,
// and observe whether the value survives or reverts to DEFAULTS (whole-file
// granularity — an out-of-bounds timeout_s reverts the entire file).
let dir: string;
let configToml: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-hooks-timeout-"));
  configToml = join(dir, "config.toml");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("a timeout_s AT the hook budget is rejected by the schema (reverts to DEFAULTS)", async () => {
  await writeFile(configToml, `[review]\ntimeout_s = ${HOOK_TIMEOUT_S}\n`);
  // At/above the budget is out of bounds, so the whole file reverts — proof the
  // ceiling is strictly below the hook budget, in the safe direction.
  expect(loadSettings(configToml)).toEqual(DEFAULTS);
});

test("a timeout_s just BELOW the hook budget is accepted", async () => {
  const justBelow = HOOK_TIMEOUT_S - 1;
  await writeFile(configToml, `[review]\ntimeout_s = ${justBelow}\n`);
  expect(loadSettings(configToml).review.timeout_s).toBe(justBelow);
});
