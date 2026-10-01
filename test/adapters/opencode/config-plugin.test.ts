// The comment-preserving editor that adds/removes caret's entry in an OpenCode config's
// `plugin` or `plugins` array (EXC-794) — how `caret install` makes caret a first-class
// array plugin. Edits go through jsonc-parser so a user's other entries, other keys, and
// comments survive.

import { expect, test } from "bun:test";

import { type ParseError, parse } from "jsonc-parser";

import {
  addPluginToConfigText,
  configParseError,
  type PluginKey,
  pluginItemSpecs,
  rewritePluginArray,
  setPluginVersionInConfigText,
  splitPluginSpecifier,
} from "@/adapters/opencode/config-plugin.ts";
import { caretEntries, caretPackageEntry, dropEntries } from "@/adapters/opencode/entries.ts";

const PKG = "@macintacos/caret";

test("add creates the plugin array when the config has none", () => {
  const out = addPluginToConfigText(null, PKG, "plugin");
  expect(JSON.parse(out)).toEqual({ plugin: [PKG] });
});

test("add appends to an existing array, preserving other entries and keys", () => {
  const src = JSON.stringify({ theme: "dark", plugin: ["opencode-wakatime"] }, null, 2);
  const out = addPluginToConfigText(src, PKG, "plugin");
  expect(JSON.parse(out)).toEqual({ theme: "dark", plugin: ["opencode-wakatime", PKG] });
});

test("add is idempotent (re-adding leaves the text unchanged)", () => {
  const once = addPluginToConfigText(null, PKG, "plugin");
  const twice = addPluginToConfigText(once, PKG, "plugin");
  expect(twice).toBe(once);
});

test("add is a no-op when caret is already present with a pinned version", () => {
  // A user who pinned `@macintacos/caret@0.4.0` must not get a duplicate bare entry.
  const src = JSON.stringify({ plugin: [`${PKG}@0.4.0`] }, null, 2);
  expect(addPluginToConfigText(src, PKG, "plugin")).toBe(src);
});

test("add is a no-op for a pinned caret entry alongside other plugins", () => {
  const src = JSON.stringify({ plugin: ["opencode-wakatime", `${PKG}@1.2.3`] }, null, 2);
  expect(addPluginToConfigText(src, PKG, "plugin")).toBe(src);
});

test("remove drops a pinned caret entry too, preserving other plugins", () => {
  const src = JSON.stringify({ plugin: ["opencode-wakatime", `${PKG}@0.4.0`] }, null, 2);
  const out = dropCaret(src, "plugin");
  expect(JSON.parse(out).plugin).toEqual(["opencode-wakatime"]);
});

test("add replaces a malformed non-array plugin value instead of throwing", () => {
  expect(
    JSON.parse(addPluginToConfigText(JSON.stringify({ plugin: "oops" }), PKG, "plugin")),
  ).toEqual({
    plugin: [PKG],
  });
  expect(JSON.parse(addPluginToConfigText(JSON.stringify({ plugin: {} }), PKG, "plugin"))).toEqual({
    plugin: [PKG],
  });
});

test("add preserves comments in a jsonc config", () => {
  const src = ["{", "  // my opencode config", '  "plugin": ["opencode-wakatime"]', "}", ""].join(
    "\n",
  );
  const out = addPluginToConfigText(src, PKG, "plugin");
  expect(out).toContain("// my opencode config");
  expect(JSON.parse(stripComments(out)).plugin).toEqual(["opencode-wakatime", PKG]);
});

test("remove drops caret's entry, preserving other entries and keys", () => {
  const src = JSON.stringify({ theme: "dark", plugin: ["opencode-wakatime", PKG] }, null, 2);
  const out = dropCaret(src, "plugin");
  expect(JSON.parse(out)).toEqual({ theme: "dark", plugin: ["opencode-wakatime"] });
});

test("remove is a no-op when caret isn't present", () => {
  const src = JSON.stringify({ plugin: ["opencode-wakatime"] }, null, 2);
  expect(dropCaret(src, "plugin")).toBe(src);
});

test("remove preserves comments in a jsonc config", () => {
  const src = ["{", "  // keep me", `  "plugin": ["opencode-wakatime", "${PKG}"]`, "}", ""].join(
    "\n",
  );
  const out = dropCaret(src, "plugin");
  expect(out).toContain("// keep me");
  expect(JSON.parse(stripComments(out)).plugin).toEqual(["opencode-wakatime"]);
});

// --- specifier splitting, entry lookup, and the version rewrite (EXC-909) --------

test("split separates a scoped package from its pin, and reports a bare entry as unpinned", () => {
  expect(splitPluginSpecifier(PKG)).toEqual({ pkg: PKG, version: null });
  expect(splitPluginSpecifier(`${PKG}@0.7.3`)).toEqual({ pkg: PKG, version: "0.7.3" });
  // `@latest` is a version segment like any other — the caller decides what it means.
  expect(splitPluginSpecifier(`${PKG}@latest`)).toEqual({ pkg: PKG, version: "latest" });
});

test("split handles an unscoped package, a path entry, and a malformed scoped name", () => {
  expect(splitPluginSpecifier("opencode-wakatime@1.2.3")).toEqual({
    pkg: "opencode-wakatime",
    version: "1.2.3",
  });
  expect(splitPluginSpecifier("/Users/dev/caret")).toEqual({
    pkg: "/Users/dev/caret",
    version: null,
  });
  expect(splitPluginSpecifier("@nope")).toEqual({ pkg: "@nope", version: null });
});

test("find returns the verbatim entry naming the package, pin and all", () => {
  const src = JSON.stringify({ plugin: ["opencode-wakatime", `${PKG}@0.7.3`] });
  expect(caretPackageEntry(src)?.spec).toBe(`${PKG}@0.7.3`);
});

test("find returns null with no plugin key, no matching entry, or no config at all", () => {
  expect(caretPackageEntry(null) === null).toBe(true);
  expect(caretPackageEntry(JSON.stringify({ theme: "dark" })) === null).toBe(true);
  expect(caretPackageEntry(JSON.stringify({ plugin: ["opencode-wakatime"] })) === null).toBe(true);
});

test("set pins a bare entry, leaving other entries and keys alone", () => {
  const src = JSON.stringify({ theme: "dark", plugin: ["opencode-wakatime", PKG] }, null, 2);
  const out = setPluginVersionInConfigText(src, { pkg: PKG, version: "0.8.1", key: "plugin" });
  expect(JSON.parse(out)).toEqual({
    theme: "dark",
    plugin: ["opencode-wakatime", `${PKG}@0.8.1`],
  });
});

test("set rewrites an existing pin rather than appending a second one", () => {
  const src = JSON.stringify({ plugin: [`${PKG}@0.7.3`] }, null, 2);
  expect(
    JSON.parse(setPluginVersionInConfigText(src, { pkg: PKG, version: "0.8.1", key: "plugin" }))
      .plugin,
  ).toEqual([`${PKG}@0.8.1`]);
});

test("set is a no-op when no entry names the package", () => {
  const src = JSON.stringify({ plugin: ["opencode-wakatime"] }, null, 2);
  expect(setPluginVersionInConfigText(src, { pkg: PKG, version: "0.8.1", key: "plugin" })).toBe(
    src,
  );
});

test("set preserves comments and sibling keys in a jsonc config", () => {
  const src = [
    "{",
    "  // my opencode config",
    '  "theme": "dark",',
    `  "plugin": ["opencode-wakatime", "${PKG}"]`,
    "}",
    "",
  ].join("\n");
  const out = setPluginVersionInConfigText(src, { pkg: PKG, version: "0.8.1", key: "plugin" });
  expect(out).toContain("// my opencode config");
  expect(JSON.parse(stripComments(out))).toEqual({
    theme: "dark",
    plugin: ["opencode-wakatime", `${PKG}@0.8.1`],
  });
});

// A local `file:` entry's tail is a filesystem path, and a directory may legitimately
// contain an `@` — a worktree named `caret@fix`, a `~/src/work@home` tree. The npm split
// would read that as a pin and truncate the path, which would make caret remove and
// rewrite an entry it should have recognized as already correct. Falsifiable: without the
// `file:` guard, `pkg` comes back as `file:/Users/j/src/caret` and `version` as `fix`.
test("splitPluginSpecifier never splits a local path on an @ in a directory name", () => {
  const spec = "file:/Users/j/src/caret@fix";
  expect(splitPluginSpecifier(spec)).toEqual({ pkg: spec, version: null });
});

test("pluginItemSpecs lists each item's specifier at its own index, null for the rest", () => {
  const src = JSON.stringify({ plugin: ["a", 42, "file:/x", { b: 1 }] });
  expect(pluginItemSpecs(src, "plugin")).toEqual(["a", null, "file:/x", null]);
});

// --- v2's `plugins` key: string and `{ package, options }` items ------------------

const MIXED = [
  "{",
  "  // my opencode config",
  '  "plugin": ["opencode-wakatime"],',
  `  "plugins": ["opencode-foo", { "package": "${PKG}@0.7.3", "options": { "x": 1 } }]`,
  "}",
  "",
].join("\n");

test("add on plugins appends a bare string and leaves plugin untouched", () => {
  const src = JSON.stringify({ plugin: ["opencode-wakatime"], plugins: ["opencode-foo"] });
  expect(JSON.parse(addPluginToConfigText(src, PKG, "plugins"))).toEqual({
    plugin: ["opencode-wakatime"],
    plugins: ["opencode-foo", PKG],
  });
});

test("add on plugins is a no-op over a pinned object item", () => {
  expect(addPluginToConfigText(MIXED, PKG, "plugins")).toBe(MIXED);
});

test("add on plugin ignores a caret item that sits in plugins", () => {
  const out = addPluginToConfigText(MIXED, PKG, "plugin");
  expect(JSON.parse(stripComments(out)).plugin).toEqual(["opencode-wakatime", PKG]);
  expect(JSON.parse(stripComments(out)).plugins).toEqual(JSON.parse(stripComments(MIXED)).plugins);
});

test("caretPackageEntry reads an object item's package verbatim, with its key and index", () => {
  expect(caretPackageEntry(MIXED)).toEqual({ key: "plugins", index: 1, spec: `${PKG}@0.7.3` });
});

test("pluginItemSpecs on plugins lists string items and object packages in order", () => {
  expect(pluginItemSpecs(MIXED, "plugins")).toEqual(["opencode-foo", `${PKG}@0.7.3`]);
});

test("set on plugins bumps an object item's package, keeping its options and comments", () => {
  const out = setPluginVersionInConfigText(MIXED, { pkg: PKG, version: "0.8.1", key: "plugins" });
  expect(out).toContain("// my opencode config");
  expect(JSON.parse(stripComments(out))).toEqual({
    plugin: ["opencode-wakatime"],
    plugins: ["opencode-foo", { package: `${PKG}@0.8.1`, options: { x: 1 } }],
  });
});

test("remove on plugins drops an object item, keeping comments and plugin", () => {
  const out = dropCaret(MIXED, "plugins");
  expect(out).toContain("// my opencode config");
  expect(JSON.parse(stripComments(out))).toEqual({
    plugin: ["opencode-wakatime"],
    plugins: ["opencode-foo"],
  });
});

test("remove on plugin leaves a caret item in plugins alone", () => {
  const src = JSON.stringify({ plugin: [PKG], plugins: [PKG] });
  expect(JSON.parse(dropCaret(src, "plugin"))).toEqual({ plugin: [], plugins: [PKG] });
});

// v1 up to 1.18.15 refuses to start on any `plugins` key, an empty one included.
test("removing the last plugins item deletes the key; the last plugin item leaves []", () => {
  const src = JSON.stringify({ theme: "dark", plugin: [PKG], plugins: [PKG] });
  const noPlugins = dropCaret(src, "plugins");
  expect(JSON.parse(noPlugins)).toEqual({ theme: "dark", plugin: [PKG] });
  expect(JSON.parse(dropCaret(noPlugins, "plugin"))).toEqual({
    theme: "dark",
    plugin: [],
  });
});

test("rewritePluginArray keeps exactly the items the predicate keeps", () => {
  const src = JSON.stringify({ plugins: ["a", "b", { package: "c" }] });
  const out = rewritePluginArray(src, "plugins", (item) => item !== "b");
  expect(JSON.parse(out)).toEqual({ plugins: ["a", { package: "c" }] });
  expect(rewritePluginArray(src, "plugins", () => true)).toBe(src);
});

test("an emptied plugins key is deleted with its comma, keeping every comment", () => {
  const cases: [string, string][] = [
    ['{\n  // c\n  "plugins": ["x"]\n}\n', "{\n  // c\n}\n"],
    ['{\n  // c\n  "plugins": ["x"],\n  "a": 1\n}\n', '{\n  // c\n  "a": 1\n}\n'],
    ['{\n  "a": 1,\n  // c\n  "plugins": ["x"]\n}\n', '{\n  "a": 1\n  // c\n}\n'],
    ['{\n  "plugins": ["x"],\n}\n', "{\n}\n"],
    ['{ "plugins": ["x"], }', "{  }"],
    ['{ "a": 1, "plugins": ["x"], }', '{ "a": 1,  }'],
    ['{\r\n  "a": 1,\r\n  "plugins": ["x"]\r\n}\r\n', '{\r\n  "a": 1\r\n}\r\n'],
  ];
  for (const [src, want] of cases) {
    const out = rewritePluginArray(src, "plugins", () => false);
    expect(out).toBe(want);
    const errors: ParseError[] = [];
    parse(out, errors, { allowTrailingComma: true });
    expect(errors).toEqual([]);
  }
});

// Minimal comment stripper so a jsonc body can be JSON.parsed for structural checks.
function stripComments(s: string): string {
  return s.replace(/^\s*\/\/.*$/gm, "");
}

/** Drop caret's package entries from one key, the way uninstall drops them from both. */
function dropCaret(src: string, key: PluginKey): string {
  return dropEntries(
    src,
    caretEntries(src, () => false).filter((e) => e.key === key),
  );
}

test("configParseError accepts what OpenCode loads: comments, a trailing comma, an empty file", () => {
  expect(configParseError('// mine\n{ "plugin": ["x"] }')).toBeNull();
  expect(configParseError('{ "plugin": ["x"], }')).toBeNull();
  expect(configParseError("")).toBeNull();
});

test("configParseError names why a truncated config or an array root is unreadable", () => {
  expect(configParseError('{ "plugin": [')).not.toBeNull();
  expect(configParseError("[]")).toBe("not a JSON object");
});
