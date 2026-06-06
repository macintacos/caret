import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readClaudeInstallState } from "../../../src/adapters/claude/install.ts";

// Point CLAUDE_CONFIG_DIR at a throwaway temp dir so the probe reads disposable
// state, never the real ~/.claude. The prior value is restored after each test.
let tmp: string;
let savedClaude: string | undefined;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-claude-install-"));
  savedClaude = process.env.CLAUDE_CONFIG_DIR;
});
afterEach(async () => {
  if (savedClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedClaude;
  await rm(tmp, { recursive: true, force: true });
});

test("reads caret's own plugin entries and is unknown when files are absent", () => {
  process.env.CLAUDE_CONFIG_DIR = join(tmp, "claude");
  // No files written → everything unknown (pluginEnabled/hook depend on a
  // settings.json that is absent here).
  expect(readClaudeInstallState()).toEqual({
    pluginVersion: "unknown",
    pluginEnabled: "unknown",
    hookInUserSettings: "unknown",
  });
});

test("surfaces version, enabled, and a manual hook entry", async () => {
  const dir = join(tmp, "claude");
  await mkdir(join(dir, "plugins"), { recursive: true });
  await writeFile(
    join(dir, "plugins", "installed_plugins.json"),
    JSON.stringify({ plugins: { "caret@caret": [{ version: "0.0.7" }] } }),
  );
  await writeFile(
    join(dir, "settings.json"),
    JSON.stringify({
      enabledPlugins: { "caret@caret": true },
      hooks: {
        PreToolUse: [
          { matcher: "ExitPlanMode", hooks: [{ type: "command", command: "caret review" }] },
        ],
      },
    }),
  );
  process.env.CLAUDE_CONFIG_DIR = dir;
  expect(readClaudeInstallState()).toEqual({
    pluginVersion: "0.0.7",
    pluginEnabled: true,
    hookInUserSettings: true,
  });
});

test("reports hookInUserSettings:false for the normal plugin-only state", async () => {
  const dir = join(tmp, "claude");
  await mkdir(dir, { recursive: true });
  // settings.json exists and parses but has no manual caret hook — the healthy
  // case (caret's hooks live in the plugin's own hooks.json).
  await writeFile(
    join(dir, "settings.json"),
    JSON.stringify({ enabledPlugins: { "caret@caret": false }, hooks: { PreToolUse: [] } }),
  );
  process.env.CLAUDE_CONFIG_DIR = dir;
  const state = readClaudeInstallState();
  expect(state.hookInUserSettings).toBe(false);
  expect(state.pluginEnabled).toBe(false);
  expect(state.pluginVersion).toBe("unknown"); // no installed_plugins.json
});
