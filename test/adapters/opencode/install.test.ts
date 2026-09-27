import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
 * a top-level shim manifest whose `dependencies` entry names the requested spec. */
const cachePkg = (specifier: string) => join(tmp, "cache", "opencode", "packages", specifier);

/** The shim manifest OpenCode's Arborist reify writes into a cache dir — the requested
 * spec under the package NAME, an exact version or a range. */
const shim = (version: string) => ({ dependencies: { "@macintacos/caret": version } });

/** Create `specifier`'s cache dir holding `manifest` as its top-level package.json. */
async function writeCachePkg(specifier: string, manifest: unknown): Promise<void> {
  await mkdir(cachePkg(specifier), { recursive: true });
  await writeFile(join(cachePkg(specifier), "package.json"), JSON.stringify(manifest));
}

/** A config dir listing caret in its `plugin` array, selected via OPENCODE_CONFIG_DIR.
 * Scaffolding for the cache cases: the probe returns all-unknown without a config dir,
 * but these cases assert on the cache, not on the array scan. */
async function configWithCaret(entry = "@macintacos/caret"): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "opencode.json"), JSON.stringify({ plugin: [entry] }));
  process.env.OPENCODE_CONFIG_DIR = dir;
}

/** A `--from-local` checkout: the caret package.json plus the file `isCaretCheckout` probes. */
async function checkout(version: string): Promise<string> {
  const dir = join(tmp, "checkout");
  await mkdir(join(dir, "opencode"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "@macintacos/caret", version }),
  );
  await writeFile(join(dir, "opencode", "caret.plugin.ts"), "");
  return dir;
}

/** OpenCode's cache for a `file:` entry: the package symlinked into the specifier's dir. */
async function linkCheckoutCache(spec: string, dir: string): Promise<void> {
  const scope = join(cachePkg(spec), "node_modules", "@macintacos");
  await mkdir(scope, { recursive: true });
  await symlink(dir, join(scope, "caret"));
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

test("a bare entry never falls back to a pinned sibling dir", async () => {
  await configWithCaret();
  await writeCachePkg("@macintacos/caret@latest", shim("0.2.0"));
  expect(readOpencodeInstallState().pluginVersion).toBe("unknown");
});

test("a pinned entry reads its own dir", async () => {
  await configWithCaret("@macintacos/caret@latest");
  await writeCachePkg("@macintacos/caret", shim("0.8.1"));
  await writeCachePkg("@macintacos/caret@latest", shim("0.2.0"));
  expect(readOpencodeInstallState().pluginVersion).toBe("0.2.0");
});

test("an exact-version pin reads its own dir", async () => {
  await configWithCaret("@macintacos/caret@1.0.2");
  await writeCachePkg("@macintacos/caret", shim("0.8.1"));
  await writeCachePkg("@macintacos/caret@1.0.2", shim("1.0.2"));
  expect(readOpencodeInstallState().pluginVersion).toBe("1.0.2");
});

test("the installed caret's version is reported over a range in the shim", async () => {
  await configWithCaret();
  await writeCachePkg("@macintacos/caret", shim("^1.1.0"));
  const pkg = join(cachePkg("@macintacos/caret"), "node_modules", "@macintacos", "caret");
  await mkdir(pkg, { recursive: true });
  await writeFile(join(pkg, "package.json"), JSON.stringify({ version: "1.1.3" }));
  const s = readOpencodeInstallState();
  expect(s.pluginVersion).toBe("1.1.3");
  expect(s.pluginEnabled).toBe(true);
});

test("a range-only shim is unknown, never a guessed version", async () => {
  await configWithCaret();
  await writeCachePkg("@macintacos/caret", shim("^1.1.0"));
  const s = readOpencodeInstallState();
  expect(s.pluginVersion).toBe("unknown");
  expect(s.pluginEnabled).toBe(false);
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

test("an unreadable config reports the install as unknown, never throwing", async () => {
  await configWithCaret();
  // resolveConfigFile prefers opencode.jsonc, so a directory there makes the read EISDIR.
  await mkdir(join(configDir(), "opencode.jsonc"));
  expect(readOpencodeInstallState()).toEqual({
    pluginVersion: "unknown",
    pluginEnabled: "unknown",
    hookInUserSettings: true,
  });
});

test("a --from-local checkout entry reports the checkout's version, enabled", async () => {
  const dir = await checkout("9.9.9");
  await configWithCaret(`file:${dir}`);
  await linkCheckoutCache(`file:${dir}`, dir);
  expect(readOpencodeInstallState()).toMatchObject({ pluginVersion: "9.9.9", pluginEnabled: true });
});
