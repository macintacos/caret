import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addPluginDependency,
  deployFiles,
  removeFiles,
  removePluginDependency,
  renderPlugin,
} from "../../../src/adapters/opencode/deploy.ts";
import { readOpencodeInstallState } from "../../../src/adapters/opencode/install.ts";
import { pluginFilePath } from "../../../src/adapters/opencode/paths.ts";

test("renderPlugin substitutes the version and bin markers (all occurrences)", () => {
  const out = renderPlugin(`v="__CARET_VERSION__"; bin="__CARET_BIN__"; again="__CARET_BIN__"`, {
    version: "1.2.3",
    binPath: "/x/bin/caret",
  });
  expect(out).toBe(`v="1.2.3"; bin="/x/bin/caret"; again="/x/bin/caret"`);
});

test("renderPlugin substitutes values literally even when they contain $-sequences", () => {
  // A filesystem path may legally contain `$&`, `$$`, `$\``; a plain string
  // replacement would reinterpret those as String.replace substitution patterns
  // and corrupt the deployed binary path.
  const out = renderPlugin(`bin="__CARET_BIN__"; v="__CARET_VERSION__"`, {
    version: "1.0$$beta",
    binPath: "/home/a$&b/bin/caret",
  });
  expect(out).toBe(`bin="/home/a$&b/bin/caret"; v="1.0$$beta"`);
});

const DEP = "@opencode-ai/plugin";
const VER = "1.16.2";

test("addPluginDependency creates a fresh manifest when none exists", () => {
  expect(addPluginDependency(null, DEP, VER)).toBe(
    `{\n  "dependencies": {\n    "${DEP}": "${VER}"\n  }\n}\n`,
  );
});

test("addPluginDependency merges into existing deps and preserves other keys", () => {
  const existing = JSON.stringify({ $schema: "x", dependencies: { shescape: "^2.1.0" } });
  const out = JSON.parse(addPluginDependency(existing, DEP, VER));
  expect(out).toEqual({ $schema: "x", dependencies: { shescape: "^2.1.0", [DEP]: VER } });
});

test("addPluginDependency is idempotent (re-pins the same version)", () => {
  const once = addPluginDependency(null, DEP, VER);
  expect(addPluginDependency(once, DEP, VER)).toBe(once);
  // A stale version is overwritten to caret's pin.
  const stale = JSON.stringify({ dependencies: { [DEP]: "0.0.1" } });
  expect(JSON.parse(addPluginDependency(stale, DEP, VER)).dependencies[DEP]).toBe(VER);
});

test("addPluginDependency throws on invalid JSON (caller skips rather than clobbering)", () => {
  expect(() => addPluginDependency("{ not json", DEP, VER)).toThrow();
});

test("removePluginDependency returns null to delete a caret-owned-only manifest", () => {
  const owned = addPluginDependency(null, DEP, VER);
  expect(removePluginDependency(owned, DEP)).toBeNull();
  expect(removePluginDependency(null, DEP)).toBeNull();
});

test("removePluginDependency removes only caret's dep, preserving user content", () => {
  const existing = JSON.stringify({
    $schema: "x",
    dependencies: { shescape: "^2.1.0", [DEP]: VER },
  });
  const out = JSON.parse(removePluginDependency(existing, DEP) as string);
  expect(out).toEqual({ $schema: "x", dependencies: { shescape: "^2.1.0" } });
});

test("removePluginDependency keeps a file that has other top-level keys after pruning empty deps", () => {
  const existing = JSON.stringify({ $schema: "x", dependencies: { [DEP]: VER } });
  const out = JSON.parse(removePluginDependency(existing, DEP) as string);
  expect(out).toEqual({ $schema: "x" }); // empty `dependencies` pruned, file kept
});

test("removePluginDependency returns the text verbatim when caret's dep is absent (no-op)", () => {
  const existing = `{"dependencies":{"shescape":"^2.1.0"}}`;
  expect(removePluginDependency(existing, DEP)).toBe(existing);
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-deploy-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("deployFiles writes files, creating parent dirs, and is idempotent", () => {
  const path = join(dir, "plugin", "caret.ts");
  const r1 = deployFiles([{ path, contents: "A" }], { dryRun: false });
  expect(r1.paths).toEqual([path]);
  expect(readFileSync(path, "utf-8")).toBe("A");
  // Re-deploy overwrites in place — no duplicate, no error.
  deployFiles([{ path, contents: "B" }], { dryRun: false });
  expect(readFileSync(path, "utf-8")).toBe("B");
});

test("deployFiles in dry-run reports paths but writes nothing", () => {
  const path = join(dir, "plugin", "caret.ts");
  const r = deployFiles([{ path, contents: "A" }], { dryRun: true });
  expect(r.dryRun).toBe(true);
  expect(r.paths).toEqual([path]);
  expect(existsSync(path)).toBe(false);
});

test("removeFiles removes/reports only files that exist; dry-run leaves them", async () => {
  const path = join(dir, "plugin", "caret.ts");
  await mkdir(join(dir, "plugin"), { recursive: true });
  await writeFile(path, "A");
  const dry = removeFiles([path], { dryRun: true });
  expect(dry.paths).toEqual([path]); // existing file previewed
  expect(existsSync(path)).toBe(true); // dry-run leaves it
  const real = removeFiles([path], { dryRun: false });
  expect(real.paths).toEqual([path]); // actually removed
  expect(existsSync(path)).toBe(false);
  // A target that was never installed is reported as removed-nothing, not a lie.
  const missing = removeFiles([join(dir, "nope")], { dryRun: false });
  expect(missing.paths).toEqual([]);
});

test("a rendered plugin's version is read back by the install probe (render <-> probe agree)", () => {
  const configDir = join(dir, "opencode");
  const rendered = renderPlugin(`const CARET_PLUGIN_VERSION = "__CARET_VERSION__";\n`, {
    version: "9.9.9",
    binPath: "/b",
  });
  deployFiles([{ path: pluginFilePath(configDir), contents: rendered }], { dryRun: false });
  const saved = process.env.OPENCODE_CONFIG_DIR;
  const savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.OPENCODE_CONFIG_DIR = configDir;
  delete process.env.XDG_CONFIG_HOME;
  try {
    const probe = readOpencodeInstallState();
    expect(probe.pluginVersion).toBe("9.9.9");
    expect(probe.pluginEnabled).toBe(true);
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = saved;
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
  }
});
