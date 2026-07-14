// The package entrypoint that makes `@macintacos/caret` loadable as an OpenCode
// plugin via a bare `plugin: ["@macintacos/caret"]` array entry. OpenCode's loader
// iterates a plugin module's exports (Object.values) and rejects the whole module
// on the FIRST export that isn't a Plugin, so the entrypoint must expose EXACTLY
// the plugin function. These tests pin that invariant and the package.json wiring
// (a bare specifier resolves the package's `exports["."]`; the plugin's runtime
// import must be a real dependency so OpenCode's `bun install` provides it).

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as {
  exports?: Record<string, unknown>;
  main?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

test("the OpenCode package entrypoint exports only the plugin (OpenCode loader invariant)", async () => {
  const mod = await import("../../opencode/index.ts");
  const values = Object.values(mod);
  expect(values).toHaveLength(1);
  expect(typeof values[0]).toBe("function");
});

test('package.json entrypoint resolves to the OpenCode plugin so `plugin: ["@macintacos/caret"]` loads', () => {
  expect(pkg.exports?.["."]).toBe("./opencode/index.ts");
  expect(pkg.main).toBe("./opencode/index.ts");
});

test("@opencode-ai/plugin is a runtime dependency (moved out of devDependencies)", () => {
  expect(pkg.dependencies["@opencode-ai/plugin"]).toBeDefined();
  expect(pkg.devDependencies["@opencode-ai/plugin"]).toBeUndefined();
});

test("jsonc-parser is a runtime dependency (comment-preserving OpenCode config edits)", () => {
  expect(pkg.dependencies["jsonc-parser"]).toBeDefined();
});
