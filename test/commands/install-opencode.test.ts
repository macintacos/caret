import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OpencodePackaging } from "@/adapters/opencode/packaging.ts";
import { CARET_PACKAGE } from "@/adapters/opencode/paths.ts";
import { runInstallOpencodeTarget } from "@/commands/install-opencode.ts";

// Stub packaging so the target never resolves the real caret root. Only the command
// files + bin path matter now (caret itself installs as a `plugin` array entry).
const PACKAGING: OpencodePackaging = {
  binPath: "/opt/caret/bin/caret",
  commands: [{ name: "demo.md", contents: "run __CARET_BIN__" }],
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-install-oc-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function install(uninstall = false, dryRun = false) {
  runInstallOpencodeTarget({ uninstall, dryRun }, { configDir: dir, packaging: PACKAGING });
}
const configJson = () => join(dir, "opencode.json");
const commandFile = () => join(dir, "commands", "caret:demo.md");

test("install adds caret to the plugin array (creating opencode.json) and deploys namespaced commands", () => {
  install();
  expect(JSON.parse(readFileSync(configJson(), "utf-8")).plugin).toEqual([CARET_PACKAGE]);
  expect(existsSync(commandFile())).toBe(true);
  expect(existsSync(join(dir, "commands", "demo.md"))).toBe(false);
  // The command's __CARET_BIN__ marker is substituted with the running caret binary.
  expect(readFileSync(commandFile(), "utf-8")).toBe("run /opt/caret/bin/caret");
});

test("install is idempotent (re-adding leaves the config unchanged)", () => {
  install();
  const first = readFileSync(configJson(), "utf-8");
  install();
  expect(readFileSync(configJson(), "utf-8")).toBe(first);
});

test("install leaves the config untouched when caret is already pinned to a version", () => {
  // A user who hard-coded `@macintacos/caret@0.4.0` must not get a duplicate bare entry.
  writeFileSync(configJson(), JSON.stringify({ plugin: [`${CARET_PACKAGE}@0.4.0`] }, null, 2));
  const before = readFileSync(configJson(), "utf-8");
  install();
  expect(readFileSync(configJson(), "utf-8")).toBe(before);
});

test("install preserves a user's existing plugins and other config keys", () => {
  writeFileSync(
    configJson(),
    JSON.stringify({ theme: "dark", plugin: ["opencode-wakatime"] }, null, 2),
  );
  install();
  expect(JSON.parse(readFileSync(configJson(), "utf-8"))).toEqual({
    theme: "dark",
    plugin: ["opencode-wakatime", CARET_PACKAGE],
  });
});

test("install edits an existing opencode.jsonc in place, preserving comments", () => {
  const jsonc = join(dir, "opencode.jsonc");
  writeFileSync(jsonc, ["{", "  // my config", '  "plugin": []', "}", ""].join("\n"));
  install();
  expect(existsSync(configJson())).toBe(false); // did not create a second config file
  const out = readFileSync(jsonc, "utf-8");
  expect(out).toContain("// my config");
  expect(out).toContain(CARET_PACKAGE);
});

test("uninstall removes caret's array entry and the command files", () => {
  install();
  install(true);
  expect(JSON.parse(readFileSync(configJson(), "utf-8")).plugin).toEqual([]);
  expect(existsSync(commandFile())).toBe(false);
});

test("uninstall preserves a user's other plugins", () => {
  writeFileSync(configJson(), JSON.stringify({ plugin: ["opencode-wakatime"] }, null, 2));
  install();
  install(true);
  expect(JSON.parse(readFileSync(configJson(), "utf-8")).plugin).toEqual(["opencode-wakatime"]);
});

test("dry-run install writes nothing", () => {
  install(false, true);
  expect(existsSync(configJson())).toBe(false);
  expect(existsSync(commandFile())).toBe(false);
});
