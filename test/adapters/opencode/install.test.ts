import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOpencodeInstallState } from "../../../src/adapters/opencode/install.ts";

// Point OPENCODE_CONFIG_DIR at a throwaway temp dir so the probe reads disposable
// state, never the real ~/.config/opencode. XDG_CONFIG_HOME is cleared so it can't
// leak the host's config dir into the resolution. Prior values restored after each.
let tmp: string;
let savedDir: string | undefined;
let savedXdg: string | undefined;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-opencode-install-"));
  savedDir = process.env.OPENCODE_CONFIG_DIR;
  savedXdg = process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_CONFIG_HOME;
});
afterEach(async () => {
  if (savedDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
  else process.env.OPENCODE_CONFIG_DIR = savedDir;
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
  await rm(tmp, { recursive: true, force: true });
});

test("everything is unknown when the config dir is absent", () => {
  process.env.OPENCODE_CONFIG_DIR = join(tmp, "opencode"); // never created
  expect(readOpencodeInstallState()).toEqual({
    pluginVersion: "unknown",
    pluginEnabled: "unknown",
    hookInUserSettings: "unknown",
  });
});

test("reports the installed plugin file, its version, and no manual array entry", async () => {
  const dir = join(tmp, "opencode");
  await mkdir(join(dir, "plugins"), { recursive: true });
  await writeFile(
    join(dir, "plugins", "caret.ts"),
    `const CARET_PLUGIN_VERSION = "1.2.3";\n// caret plugin\n`,
  );
  // A user config whose plugin array holds only third-party plugins → no MANUAL
  // caret entry (caret rides as the auto-loaded file above, not an array entry).
  await writeFile(join(dir, "config.json"), JSON.stringify({ plugin: ["other@1.0.0"] }));
  process.env.OPENCODE_CONFIG_DIR = dir;
  expect(readOpencodeInstallState()).toEqual({
    pluginVersion: "1.2.3",
    pluginEnabled: true,
    hookInUserSettings: false,
  });
});

test("config dir present but no plugin file → not enabled, version unknown", async () => {
  const dir = join(tmp, "opencode");
  await mkdir(dir, { recursive: true });
  process.env.OPENCODE_CONFIG_DIR = dir;
  const s = readOpencodeInstallState();
  expect(s.pluginEnabled).toBe(false);
  expect(s.pluginVersion).toBe("unknown");
});

test("a manual caret entry in the user's plugin array is surfaced", async () => {
  const dir = join(tmp, "opencode");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "config.json"),
    JSON.stringify({ plugin: ["@macintacos/caret-opencode@1.0.0"] }),
  );
  process.env.OPENCODE_CONFIG_DIR = dir;
  expect(readOpencodeInstallState().hookInUserSettings).toBe(true);
});

test("a manual caret entry in a later config file is not masked by an earlier one", async () => {
  const dir = join(tmp, "opencode");
  await mkdir(dir, { recursive: true });
  // config.json parses but has a caret-less plugin array; opencode.json holds the
  // real manual entry. The probe must scan both, not stop at the first parseable.
  await writeFile(join(dir, "config.json"), JSON.stringify({ plugin: ["other@1.0.0"] }));
  await writeFile(
    join(dir, "opencode.json"),
    JSON.stringify({ plugin: ["@macintacos/caret-opencode@1.0.0"] }),
  );
  process.env.OPENCODE_CONFIG_DIR = dir;
  expect(readOpencodeInstallState().hookInUserSettings).toBe(true);
});

test("a plugin file without a version marker reports enabled but version unknown", async () => {
  const dir = join(tmp, "opencode");
  await mkdir(join(dir, "plugins"), { recursive: true });
  await writeFile(join(dir, "plugins", "caret.ts"), `// caret plugin, no version marker\n`);
  process.env.OPENCODE_CONFIG_DIR = dir;
  const s = readOpencodeInstallState();
  expect(s.pluginEnabled).toBe(true);
  expect(s.pluginVersion).toBe("unknown");
});
