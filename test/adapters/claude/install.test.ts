import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { setupTempClaudeConfigDir } from "@test/support/claude-config-dir.ts";
import { readClaudeInstallState } from "@/adapters/claude/install.ts";

const tmp = setupTempClaudeConfigDir("caret-claude-install-");

test("reads caret's own plugin entries and is unknown when files are absent", () => {
  // No files written → everything unknown (pluginEnabled/hook depend on a
  // settings.json that is absent here).
  expect(readClaudeInstallState()).toEqual({
    pluginVersion: "unknown",
    pluginEnabled: "unknown",
    hookInUserSettings: "unknown",
  });
});

test("surfaces version, enabled, and a manual hook entry", async () => {
  const dir = join(tmp(), "claude");
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
  expect(readClaudeInstallState()).toEqual({
    pluginVersion: "0.0.7",
    pluginEnabled: true,
    hookInUserSettings: true,
  });
});

test("reports hookInUserSettings:false for the normal plugin-only state", async () => {
  const dir = join(tmp(), "claude");
  await mkdir(dir, { recursive: true });
  // settings.json exists and parses but has no manual caret hook — the healthy
  // case (caret's hooks live in the plugin's own hooks.json).
  await writeFile(
    join(dir, "settings.json"),
    JSON.stringify({ enabledPlugins: { "caret@caret": false }, hooks: { PreToolUse: [] } }),
  );
  const state = readClaudeInstallState();
  expect(state.hookInUserSettings).toBe(false);
  expect(state.pluginEnabled).toBe(false);
  expect(state.pluginVersion).toBe("unknown"); // no installed_plugins.json
});
