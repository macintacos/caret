import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpencodePackaging } from "../../src/adapters/opencode/packaging.ts";
import {
  OPENCODE_PLUGIN_DEP,
  OPENCODE_PLUGIN_DEP_VERSION,
  packageJsonPath,
  pluginFilePath,
} from "../../src/adapters/opencode/paths.ts";
import { runInstallOpencodeSubcommand } from "../../src/commands/install-opencode.ts";

// A stub packaging so the subcommand never resolves the real caret root. The source
// carries non-default exports (like the real plugin) so the strip step is exercised.
const PACKAGING: OpencodePackaging = {
  pluginSource: [
    `export const CARET_PLUGIN_VERSION = "__CARET_VERSION__";`,
    `export const BIN = "__CARET_BIN__";`,
    `const CaretPlugin = () => ({});`,
    `export default CaretPlugin;`,
    ``,
  ].join("\n"),
  binPath: "/opt/caret/bin/caret",
  commands: [{ name: "demo.md", contents: "run __CARET_BIN__" }],
};

let dir: string;
let depInstallCalls: string[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-install-oc-"));
  depInstallCalls = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Stub the dependency installer so tests never shell out to a real `bun install`.
const stubInstall = (configDir: string) => {
  depInstallCalls.push(configDir);
  return { ok: true, detail: "" };
};

function install(uninstall = false, dryRun = false) {
  runInstallOpencodeSubcommand(
    { uninstall, dryRun },
    { configDir: dir, packaging: PACKAGING, installDeps: stubInstall },
  );
}

test("install writes a package.json declaring caret's plugin dependency (the load fix)", () => {
  install();
  const pkgPath = packageJsonPath(dir);
  expect(existsSync(pkgPath)).toBe(true);
  expect(JSON.parse(readFileSync(pkgPath, "utf-8"))).toEqual({
    dependencies: { [OPENCODE_PLUGIN_DEP]: OPENCODE_PLUGIN_DEP_VERSION },
  });
  // The plugin + command files also land; commands are namespaced (`/caret:demo`).
  expect(existsSync(pluginFilePath(dir))).toBe(true);
  expect(existsSync(join(dir, "command", "caret:demo.md"))).toBe(true);
  expect(existsSync(join(dir, "command", "demo.md"))).toBe(false);
});

test("install is idempotent (re-running leaves the manifest unchanged)", () => {
  install();
  const first = readFileSync(packageJsonPath(dir), "utf-8");
  install();
  expect(readFileSync(packageJsonPath(dir), "utf-8")).toBe(first);
});

test("install merges into a pre-existing package.json without clobbering user deps", () => {
  writeFileSync(packageJsonPath(dir), JSON.stringify({ dependencies: { shescape: "^2.1.0" } }));
  install();
  expect(JSON.parse(readFileSync(packageJsonPath(dir), "utf-8"))).toEqual({
    dependencies: { shescape: "^2.1.0", [OPENCODE_PLUGIN_DEP]: OPENCODE_PLUGIN_DEP_VERSION },
  });
});

test("uninstall removes a caret-owned manifest entirely", () => {
  install();
  install(true);
  expect(existsSync(packageJsonPath(dir))).toBe(false);
  expect(existsSync(pluginFilePath(dir))).toBe(false);
});

test("uninstall strips only caret's dep, preserving a user's package.json", () => {
  writeFileSync(packageJsonPath(dir), JSON.stringify({ dependencies: { shescape: "^2.1.0" } }));
  install();
  install(true);
  expect(JSON.parse(readFileSync(packageJsonPath(dir), "utf-8"))).toEqual({
    dependencies: { shescape: "^2.1.0" },
  });
});

test("dry-run install writes nothing", () => {
  install(false, true);
  expect(existsSync(packageJsonPath(dir))).toBe(false);
  expect(existsSync(pluginFilePath(dir))).toBe(false);
});

test("install runs the dependency installer once; dry-run and uninstall do not", () => {
  install();
  expect(depInstallCalls).toEqual([dir]); // installed the dep into the config dir
  depInstallCalls = [];
  install(false, true); // dry-run previews, installs nothing
  expect(depInstallCalls).toEqual([]);
  install(true); // uninstall removes, installs nothing
  expect(depInstallCalls).toEqual([]);
});

test("the deployed plugin exports only `export default` (OpenCode loads only Plugin exports)", () => {
  install();
  const deployed = readFileSync(pluginFilePath(dir), "utf-8");
  const exportLines = deployed.split("\n").filter((l) => /^\s*export\b/.test(l));
  expect(exportLines).toEqual(["export default CaretPlugin;"]);
});
