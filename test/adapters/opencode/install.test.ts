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

/** OpenCode's plugin cache: one dir per RAW specifier under `packages/`, each holding
 * a top-level shim manifest whose `dependencies` entry names the resolved version. */
const cachePkg = (specifier: string) => join(tmp, "cache", "opencode", "packages", specifier);

/** The shim manifest OpenCode's Arborist reify writes into a cache dir — an exact
 * version under the package NAME, with no range prefix. */
const shim = (version: string) => ({ dependencies: { "@macintacos/caret": version } });

/** Create `specifier`'s cache dir holding `manifest` as its top-level package.json. */
async function writeCachePkg(specifier: string, manifest: unknown): Promise<void> {
  await mkdir(cachePkg(specifier), { recursive: true });
  await writeFile(join(cachePkg(specifier), "package.json"), JSON.stringify(manifest));
}

/** A config dir listing caret in its `plugin` array, selected via OPENCODE_CONFIG_DIR.
 * Scaffolding for the cache cases: the probe returns all-unknown without a config dir,
 * but these cases assert on the cache, not on the array scan. */
async function configWithCaret(): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "opencode.json"), JSON.stringify({ plugin: ["@macintacos/caret"] }));
  process.env.OPENCODE_CONFIG_DIR = dir;
}

test("everything is unknown when the config dir is absent", () => {
  process.env.OPENCODE_CONFIG_DIR = configDir(); // never created
  expect(readOpencodeInstallState()).toEqual({
    pluginVersion: "unknown",
    pluginEnabled: "unknown",
    hookInUserSettings: "unknown",
  });
});

test("reports the bare specifier dir's version + enabled, and caret configured", async () => {
  await configWithCaret();
  await writeCachePkg("@macintacos/caret", shim("1.2.3"));
  expect(readOpencodeInstallState()).toEqual({
    pluginVersion: "1.2.3",
    pluginEnabled: true,
    hookInUserSettings: true,
  });
});

test("finds a pinned specifier dir when the bare one is absent", async () => {
  await configWithCaret();
  await writeCachePkg("@macintacos/caret@latest", shim("0.2.0"));
  const s = readOpencodeInstallState();
  expect(s.pluginVersion).toBe("0.2.0");
  expect(s.pluginEnabled).toBe(true);
});

test("the bare specifier dir wins when a pinned one also exists", async () => {
  await configWithCaret();
  await writeCachePkg("@macintacos/caret", shim("0.8.1"));
  await writeCachePkg("@macintacos/caret@latest", shim("0.2.0"));
  const s = readOpencodeInstallState();
  expect(s.pluginVersion).toBe("0.8.1");
  expect(s.pluginEnabled).toBe(true);
});

test("configured but not yet installed: array entry present, cache still empty", async () => {
  await configWithCaret();
  const s = readOpencodeInstallState();
  expect(s.hookInUserSettings).toBe(true); // configured
  expect(s.pluginEnabled).toBe(false); // not installed until OpenCode restarts
  expect(s.pluginVersion).toBe("unknown");
});

test("a failed install — cache dir present, no dependency entry — is not enabled", async () => {
  await configWithCaret();
  await writeCachePkg("@macintacos/caret", { name: "opencode-shim" });
  const s = readOpencodeInstallState();
  expect(s.pluginVersion).toBe("unknown");
  expect(s.pluginEnabled).toBe(false);
});

test("an unparseable shim manifest degrades to unknown", async () => {
  await configWithCaret();
  await mkdir(cachePkg("@macintacos/caret"), { recursive: true });
  await writeFile(join(cachePkg("@macintacos/caret"), "package.json"), "{ not json");
  const s = readOpencodeInstallState();
  expect(s.pluginVersion).toBe("unknown");
  expect(s.pluginEnabled).toBe(false);
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
