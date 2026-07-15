import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readOpencodeInstallState } from "@/adapters/opencode/install.ts";

// Point OPENCODE_CONFIG_DIR + XDG_CACHE_HOME at throwaway temp dirs so the probe
// reads disposable state, never the real ~/.config/opencode or ~/.cache/opencode.
// XDG_CONFIG_HOME is cleared so it can't leak the host's config dir. Restored after.
let tmp: string;
const saved: Record<string, string | undefined> = {};
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-opencode-install-"));
  for (const k of ["OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"]) {
    saved[k] = process.env[k];
  }
  delete process.env.XDG_CONFIG_HOME;
  process.env.XDG_CACHE_HOME = join(tmp, "cache");
});
afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(tmp, { recursive: true, force: true });
});

const configDir = () => join(tmp, "opencode");
const cachePkg = () => join(tmp, "cache", "opencode", "node_modules", "@macintacos/caret");

test("everything is unknown when the config dir is absent", () => {
  process.env.OPENCODE_CONFIG_DIR = configDir(); // never created
  expect(readOpencodeInstallState()).toEqual({
    pluginVersion: "unknown",
    pluginEnabled: "unknown",
    hookInUserSettings: "unknown",
  });
});

test("reports the cache version + enabled, and caret configured in the plugin array", async () => {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "opencode.json"), JSON.stringify({ plugin: ["@macintacos/caret"] }));
  await mkdir(cachePkg(), { recursive: true });
  await writeFile(join(cachePkg(), "package.json"), JSON.stringify({ version: "1.2.3" }));
  process.env.OPENCODE_CONFIG_DIR = dir;
  expect(readOpencodeInstallState()).toEqual({
    pluginVersion: "1.2.3",
    pluginEnabled: true,
    hookInUserSettings: true,
  });
});

test("configured but not yet installed: array entry present, cache still empty", async () => {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "opencode.json"), JSON.stringify({ plugin: ["@macintacos/caret"] }));
  process.env.OPENCODE_CONFIG_DIR = dir;
  const s = readOpencodeInstallState();
  expect(s.hookInUserSettings).toBe(true); // configured
  expect(s.pluginEnabled).toBe(false); // not installed until OpenCode restarts
  expect(s.pluginVersion).toBe("unknown");
});

test("config present without a caret array entry → not configured", async () => {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "opencode.json"), JSON.stringify({ plugin: ["other@1.0.0"] }));
  process.env.OPENCODE_CONFIG_DIR = dir;
  expect(readOpencodeInstallState().hookInUserSettings).toBe(false);
});

test("a caret entry in any config file is found (scans all; parses jsonc comments)", async () => {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "config.json"), JSON.stringify({ plugin: ["other@1.0.0"] }));
  await writeFile(
    join(dir, "opencode.jsonc"),
    ["{", "  // mine", '  "plugin": ["@macintacos/caret"]', "}", ""].join("\n"),
  );
  process.env.OPENCODE_CONFIG_DIR = dir;
  expect(readOpencodeInstallState().hookInUserSettings).toBe(true);
});
