import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deployFiles, removeFiles, renderPlugin } from "../../../src/adapters/opencode/deploy.ts";
import { readOpencodeInstallState } from "../../../src/adapters/opencode/install.ts";
import { pluginFilePath } from "../../../src/adapters/opencode/paths.ts";

test("renderPlugin substitutes the version and bin markers (all occurrences)", () => {
  const out = renderPlugin(`v="__CARET_VERSION__"; bin="__CARET_BIN__"; again="__CARET_BIN__"`, {
    version: "1.2.3",
    binPath: "/x/bin/caret",
  });
  expect(out).toBe(`v="1.2.3"; bin="/x/bin/caret"; again="/x/bin/caret"`);
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

test("removeFiles deletes targets; dry-run leaves them; a missing path is fine", async () => {
  const path = join(dir, "plugin", "caret.ts");
  await mkdir(join(dir, "plugin"), { recursive: true });
  await writeFile(path, "A");
  removeFiles([path], { dryRun: true });
  expect(existsSync(path)).toBe(true); // dry-run leaves it
  removeFiles([path], { dryRun: false });
  expect(existsSync(path)).toBe(false); // really removed
  expect(() => removeFiles([join(dir, "nope")], { dryRun: false })).not.toThrow();
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
