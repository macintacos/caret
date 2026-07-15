import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCodexInstallState } from "@/adapters/codex/install.ts";

// Point CODEX_HOME at a throwaway temp dir so the probe reads disposable state,
// never the real ~/.codex. The prior value is restored after each test.
let tmp: string;
let savedCodex: string | undefined;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-codex-install-"));
  savedCodex = process.env.CODEX_HOME;
});
afterEach(async () => {
  if (savedCodex === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = savedCodex;
  await rm(tmp, { recursive: true, force: true });
});

test("everything is unknown when the config dir is absent", () => {
  process.env.CODEX_HOME = join(tmp, "codex");
  // No files written → pluginEnabled/hook are unknown (config.toml/hooks.json
  // absent); pluginVersion is always unknown (no Codex-side caret package).
  expect(readCodexInstallState()).toEqual({
    pluginVersion: "unknown",
    pluginEnabled: "unknown",
    hookInUserSettings: "unknown",
  });
});

test("surfaces the codex_hooks feature gate and a manual hook entry", async () => {
  const dir = join(tmp, "codex");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "config.toml"), "[features]\ncodex_hooks = true\n");
  await writeFile(
    join(dir, "hooks.json"),
    JSON.stringify({
      PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: "caret review" }] }],
    }),
  );
  process.env.CODEX_HOME = dir;
  expect(readCodexInstallState()).toEqual({
    pluginVersion: "unknown",
    pluginEnabled: true,
    hookInUserSettings: true,
  });
});

test("reports the feature off and hookInUserSettings:false when files parse but hold none", async () => {
  const dir = join(tmp, "codex");
  await mkdir(dir, { recursive: true });
  // config.toml parses but the feature gate is absent → false; hooks.json parses
  // but carries no caret command → false.
  await writeFile(join(dir, "config.toml"), "[features]\nother_flag = true\n");
  await writeFile(join(dir, "hooks.json"), JSON.stringify({ PermissionRequest: [] }));
  process.env.CODEX_HOME = dir;
  const state = readCodexInstallState();
  expect(state.pluginVersion).toBe("unknown");
  expect(state.pluginEnabled).toBe(false);
  expect(state.hookInUserSettings).toBe(false);
});

test("codex_hooks explicitly false is reported as false, not unknown", async () => {
  const dir = join(tmp, "codex");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "config.toml"), "[features]\ncodex_hooks = false\n");
  process.env.CODEX_HOME = dir;
  expect(readCodexInstallState().pluginEnabled).toBe(false);
});

test("invalid TOML degrades pluginEnabled to unknown", async () => {
  const dir = join(tmp, "codex");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "config.toml"), "this is not = valid = toml [[[");
  process.env.CODEX_HOME = dir;
  expect(readCodexInstallState().pluginEnabled).toBe("unknown");
});
