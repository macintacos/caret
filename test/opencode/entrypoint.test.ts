// The package entrypoint that makes `@macintacos/caret` loadable as an OpenCode
// plugin via a bare `plugin: ["@macintacos/caret"]` array entry. OpenCode's loader
// iterates a plugin module's exports (Object.values) and rejects the whole module
// on the FIRST export that isn't a plugin, so the entrypoint must expose EXACTLY
// one value: the object both OpenCode v1 (`server`) and v2 (`setup`) load. These
// tests pin that invariant and the package.json wiring (a bare specifier resolves
// the package's `exports["."]`; v1's runtime import, `@opencode-ai/plugin`'s
// `tool()`, must be a real dependency so OpenCode's `bun install` provides it).

import { expect, test } from "bun:test";
import { join } from "node:path";

import v2Setup from "@oc/caret.plugin.v2.ts";
import pkgJson from "@root/package.json" with { type: "json" };

// package.json arrives as a parsed module (as test/core/lib/build-id.test.ts
// reads it too) rather than through a runtime file read, so the alias resolves
// it — `paths` governs module resolution, not `new URL(…, import.meta.url)`.
// The assertions read through a widened shape because the inferred literal type
// admits no lookup for a key that is correctly absent — devDependencies must
// *not* carry `@opencode-ai/plugin`, nor dependencies `@opencode/plugin` — what the last
// two tests pin.
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
  expect(typeof plugin.server).toBe("function");
  // v1 rejects a default holding both `server` and `tui`; a TUI module is its own export.
  expect(plugin.tui).toBeUndefined();
});

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const ENTRY = join(REPO_ROOT, "opencode", "index.ts");
const V1 = join(REPO_ROOT, "opencode", "caret.plugin.ts");

/** Runs `script` in a fresh bun, whose module registry this file's imports haven't touched. */
function inFreshBun(script: string): string {
  const { exitCode, stdout, stderr } = Bun.spawnSync([process.execPath, "-e", script], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (exitCode !== 0) throw new Error(stderr.toString());
  return stdout.toString();
}

test("a v2 load — index.ts plus setup() — never evaluates @opencode-ai/plugin", () => {
  const out = inFreshBun(`
    const v1Sdk = () => Object.keys(require.cache).filter((k) => k.includes("/@opencode-ai/plugin/"));
    const { default: plugin } = await import(${JSON.stringify(ENTRY)});
    await plugin.setup({ tool: { transform: async () => {} }, session: { hook: async () => {} } });
    const afterSetup = v1Sdk();
    await import(${JSON.stringify(V1)});
    console.log(JSON.stringify({ afterSetup, seenOnceImported: v1Sdk().length > 0 }));
  `);
  // seenOnceImported proves the probe sees the SDK at all, so an empty afterSetup is real.
  expect(JSON.parse(out)).toEqual({ afterSetup: [], seenOnceImported: true });
});

test("server() rejects when the v1 module fails to load, never swallowing it", () => {
  const out = inFreshBun(`
    Bun.plugin({ name: "fail-v1", setup(build) {
      build.onLoad({ filter: /caret\\.plugin\\.ts$/ }, () => { throw new Error("v1 load failed"); });
    } });
    const { default: plugin } = await import(${JSON.stringify(ENTRY)});
    console.log(await plugin.server({}).then(() => "resolved", (e) => e.message));
  `);
  expect(out.trim()).toBe("v1 load failed");
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

test("@opencode/plugin is a devDependency, not a runtime dependency", () => {
  expect(pkg.devDependencies["@opencode/plugin"]).toBeDefined();
  expect(pkg.dependencies["@opencode/plugin"]).toBeUndefined();
});
