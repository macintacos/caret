// The package entrypoint that makes `@macintacos/caret` loadable as an OpenCode
// plugin via a bare `plugin: ["@macintacos/caret"]` array entry. OpenCode's loader
// iterates a plugin module's exports (Object.values) and rejects the whole module
// on the FIRST export that isn't a Plugin, so the entrypoint must expose EXACTLY
// the plugin function. These tests pin that invariant and the package.json wiring
// (a bare specifier resolves the package's `exports["."]`; the plugin's runtime
// import must be a real dependency so OpenCode's `bun install` provides it).

import { expect, test } from "bun:test";

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

test("the OpenCode package entrypoint exports only the plugin (OpenCode loader invariant)", async () => {
  const mod = await import("@opencode/index.ts");
  const values = Object.values(mod);
  expect(values).toHaveLength(1);
  expect(typeof values[0]).toBe("function");
});

test('package.json entrypoint resolves to the OpenCode plugin so `plugin: ["@macintacos/caret"]` loads', () => {
  expect(pkg.exports?.["."]).toBe("./opencode/index.ts");
  expect(pkg.main).toBe("./opencode/index.ts");
});

test("package.json exposes a `caret` bin so `bunx @macintacos/caret` runs the CLI", () => {
  // The prebuilt installer's OpenCode step is `bunx @macintacos/caret install
  // --target opencode`, and `npm i -g @macintacos/caret` must yield a `caret`
  // command — both resolve this bin entry (the shim picks the native binary or
  // the bundle at runtime).
  expect(pkg.bin?.caret).toBe("./bin/caret");
});

test("@opencode-ai/plugin is a runtime dependency, not a devDependency", () => {
  expect(pkg.dependencies["@opencode-ai/plugin"]).toBeDefined();
  expect(pkg.devDependencies["@opencode-ai/plugin"]).toBeUndefined();
});
