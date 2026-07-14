// The comment-preserving editor that adds/removes caret's entry in an OpenCode
// config's `plugin` array (EXC-794). This replaces the retired config-dir
// package.json manifest: `caret install --target opencode` now makes caret a
// first-class array plugin. Edits go through jsonc-parser so a user's other
// entries, other keys, and comments survive.

import { expect, test } from "bun:test";
import {
  addPluginToConfigText,
  removePluginFromConfigText,
} from "../../src/adapters/opencode/config-plugin.ts";

const PKG = "@macintacos/caret";

test("add creates the plugin array when the config has none", () => {
  const out = addPluginToConfigText(null, PKG);
  expect(JSON.parse(out)).toEqual({ plugin: [PKG] });
});

test("add appends to an existing array, preserving other entries and keys", () => {
  const src = JSON.stringify({ theme: "dark", plugin: ["opencode-wakatime"] }, null, 2);
  const out = addPluginToConfigText(src, PKG);
  expect(JSON.parse(out)).toEqual({ theme: "dark", plugin: ["opencode-wakatime", PKG] });
});

test("add is idempotent (re-adding leaves the text unchanged)", () => {
  const once = addPluginToConfigText(null, PKG);
  const twice = addPluginToConfigText(once, PKG);
  expect(twice).toBe(once);
});

test("add preserves comments in a jsonc config", () => {
  const src = ["{", "  // my opencode config", '  "plugin": ["opencode-wakatime"]', "}", ""].join(
    "\n",
  );
  const out = addPluginToConfigText(src, PKG);
  expect(out).toContain("// my opencode config");
  expect(JSON.parse(stripComments(out)).plugin).toEqual(["opencode-wakatime", PKG]);
});

test("remove drops caret's entry, preserving other entries and keys", () => {
  const src = JSON.stringify({ theme: "dark", plugin: ["opencode-wakatime", PKG] }, null, 2);
  const out = removePluginFromConfigText(src, PKG);
  expect(JSON.parse(out)).toEqual({ theme: "dark", plugin: ["opencode-wakatime"] });
});

test("remove is a no-op when caret isn't present", () => {
  const src = JSON.stringify({ plugin: ["opencode-wakatime"] }, null, 2);
  expect(removePluginFromConfigText(src, PKG)).toBe(src);
});

test("remove preserves comments in a jsonc config", () => {
  const src = ["{", "  // keep me", `  "plugin": ["opencode-wakatime", "${PKG}"]`, "}", ""].join(
    "\n",
  );
  const out = removePluginFromConfigText(src, PKG);
  expect(out).toContain("// keep me");
  expect(JSON.parse(stripComments(out)).plugin).toEqual(["opencode-wakatime"]);
});

// Minimal comment stripper so a jsonc body can be JSON.parsed for structural checks.
function stripComments(s: string): string {
  return s.replace(/^\s*\/\/.*$/gm, "");
}
