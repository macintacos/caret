// The package entrypoint that makes `@macintacos/caret` loadable as an OpenCode
// plugin via a bare `plugin: ["@macintacos/caret"]` array entry. OpenCode's loader
// iterates a plugin module's exports (Object.values) and rejects the whole module
// on the FIRST export that isn't a plugin, so the entrypoint must expose EXACTLY
// one value: the object both OpenCode v1 (`server`) and v2 (`setup`) load. These
// tests pin that invariant and the package.json wiring (a bare specifier resolves
// the package's `exports["."]`; v1's runtime import, `@opencode-ai/plugin`'s
// `tool()`, must be a real dependency so OpenCode's `bun install` provides it).

import { expect, test } from "bun:test";

import v1Server from "@oc/caret.plugin.ts";
import v2Setup from "@oc/caret.plugin.v2.ts";
import pkgJson from "@root/package.json" with { type: "json" };

// package.json arrives as a parsed module (as test/core/lib/build-id.test.ts
// reads it too) rather than through a runtime file read, so the alias resolves
// it — `paths` governs module resolution, not `new URL(…, import.meta.url)`.
// The assertions read through a widened shape because the inferred literal type
// admits no lookup for a key that is correctly absent — devDependencies must
// *not* carry @opencode-ai/plugin, which is precisely what the last test pins.
const pkg = pkgJson as {
  exports?: Record<string, unknown>;
  main?: string;
  bin?: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

test("the OpenCode package entrypoint exports one plugin serving both v1 (server) and v2 (setup)", async () => {
  const mod = await import("@oc/index.ts");
  const values = Object.values(mod);
  expect(values).toHaveLength(1);
  const plugin = values[0] as Record<string, unknown>;
  expect(plugin.id).toBe("caret");
  expect(plugin.setup).toBe(v2Setup);
  expect(plugin.server).toBe(v1Server);
  // v1 rejects a default holding both `server` and `tui`; a TUI module is its own export.
  expect(plugin.tui).toBeUndefined();
});

test('package.json entrypoint resolves to the OpenCode plugin so `plugin: ["@macintacos/caret"]` loads', () => {
  expect(pkg.exports?.["."]).toBe("./opencode/index.ts");
  expect(pkg.main).toBe("./opencode/index.ts");
});

test("package.json exposes the v2 TUI module at `./tui`", () => {
  expect(pkg.exports?.["./tui"]).toBe("./opencode/caret.tui.ts");
});

test("the TUI module's default loads on v2 as { id, setup } and on v1 as a TUI-only plugin", async () => {
  // v2's TUI loader reads only the default and requires a non-empty `id` and a `setup`
  // (anomalyco/opencode packages/tui/src/plugin/context.tsx:694-696,741-751); v1 rejects a
  // default holding both `server` and `tui`, and needs `tui` on a TUI target.
  const mod = await import("@oc/caret.tui.ts");
  const plugin = mod.default as Record<string, unknown>;
  expect(typeof plugin.id).toBe("string");
  expect(plugin.id).not.toBe("");
  expect(typeof plugin.setup).toBe("function");
  expect(typeof plugin.tui).toBe("function");
  expect("server" in plugin).toBe(false);
});

test("package.json exposes a `caret` bin so `bunx @macintacos/caret` runs the CLI", () => {
  // Installing caret from npm is `bunx @macintacos/caret install`, and `npm i -g
  // @macintacos/caret` must yield a `caret` command — both resolve this bin entry (the
  // shim picks the native binary or the bundle at runtime).
  expect(pkg.bin?.caret).toBe("./bin/caret");
});

test("@opencode-ai/plugin is a runtime dependency, not a devDependency", () => {
  expect(pkg.dependencies["@opencode-ai/plugin"]).toBeDefined();
  expect(pkg.devDependencies["@opencode-ai/plugin"]).toBeUndefined();
});

test("@opencode/plugin is a runtime dependency, not a devDependency", () => {
  expect(pkg.dependencies["@opencode/plugin"]).toBeDefined();
  expect(pkg.devDependencies["@opencode/plugin"]).toBeUndefined();
});
