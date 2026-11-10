// Standing gate for the dependency-placement law (EXC-1086). `opencode/` and `pi/` are
// the directories caret publishes as unbundled TypeScript, so their imports are the only
// npm specifiers a consumer's package manager ever has to resolve — `dist/cli.js` and
// `ui/dist` are bundles with no package names left in them. OpenCode and pi install the
// package **and its declared `dependencies`**, so a build input filed in `dependencies` is
// downloaded by every user and loaded by none.
// `doc/agents/dependency-rules.md` § Where a new package goes states the rule; this suite
// is what makes it falsifiable, so the next misplacement fails `bun test` on the push that
// adds it rather than being caught by an audit years later.
//
// Three escape hatches, all real:
//
// - **A non-optional peer of an `opencode/` import belongs in `dependencies` with no
//   import site to derive it from.** Today the term is empty — `@opencode-ai/plugin`'s
//   only peers are the three optional `@opentui/*` — so no peer expansion is built. When
//   that day comes, add the peer to the expected set explicitly with a comment naming the
//   package that obliges it; do not widen the extractor.
// - **A `@/`-style path alias appearing in `opencode/` is a genuine bug, not a gap here.**
//   `opencode/` ships as source, so a consumer has no tsconfig `paths` to resolve it with.
//   The extractor reads such a specifier as an undeclared package name and the gate reds,
//   which is the correct outcome.
// - **A host-provided specifier is imported but never declared** (`HOST_PROVIDED_BY_DIR`).
//   The host maps it to its own copy — OpenCode v2 for TUI plugins, imported only
//   dynamically; pi for every extension — so a declared copy would be downloaded by every
//   user and loaded by none.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join } from "node:path";

import pkg from "@root/package.json" with { type: "json" };
import { importSpecifiers, runtimeImportSpecifiers } from "@test/support/import-specifiers.ts";

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const OPENCODE_DIR = "opencode";

// The scan boundary is the publish boundary: `files` ships each source directory entire, so every
// module extension a consumer could resolve is read, not just the `.ts` files. A shipped
// file this glob missed would go silently underived — the one failure direction that
// leaves the gate green while a consumer's install breaks.
const SHIPPED_GLOB = "**/*.{ts,mts,cts,js,mjs,cjs}";

/**
 * Every npm package name `source` imports. Relative and absolute specifiers and node
 * builtins are dropped; a subpath is reduced to its package name (`@scope/pkg/sub` to
 * `@scope/pkg`, `pkg/sub` to `pkg`), which is the unit `package.json` declares. The
 * extractor's limits (double quotes only, raw source) are exhaustive here: a template-
 * literal or `require()` specifier has no place in an ESM plugin. Statements TypeScript
 * erases whole do not count (`runtimeImportSpecifiers`).
 */
function importedPackages(source: string): string[] {
  return runtimeImportSpecifiers(source)
    .filter((spec) => !spec.startsWith(".") && !spec.startsWith("/") && !isBuiltin(spec))
    .map((spec) =>
      spec
        .split("/")
        .slice(0, spec.startsWith("@") ? 2 : 1)
        .join("/"),
    );
}

const HOST_PROVIDED_BY_DIR: Record<string, readonly string[]> = {
  opencode: ["@opentui/solid"],
  // pi maps these to its own copies at load time (pi's docs/extensions.md), so they may be imported statically.
  pi: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
    "typebox",
  ],
};

function scanImports(dir: string): Set<string> {
  const names = new Set<string>();
  for (const file of new Bun.Glob(SHIPPED_GLOB).scanSync({ cwd: join(REPO_ROOT, dir) })) {
    for (const name of importedPackages(readFileSync(join(REPO_ROOT, dir, file), "utf-8")))
      names.add(name);
  }
  return names;
}

/** The union over directories of each directory's imports minus that directory's host set. */
function expectedDependencies(
  importsByDir: Record<string, Iterable<string>>,
  hostProvidedByDir: Record<string, readonly string[]>,
): string[] {
  const expected = new Set<string>();
  for (const [dir, names] of Object.entries(importsByDir)) {
    const host = hostProvidedByDir[dir] ?? [];
    for (const name of names) if (!host.includes(name)) expected.add(name);
  }
  return [...expected].sort();
}

const importsByDir = Object.fromEntries(
  Object.keys(HOST_PROVIDED_BY_DIR).map((dir) => [dir, scanImports(dir)]),
);

test("`dependencies` carries exactly what the shipped source directories make a consumer resolve", () => {
  expect(Object.keys(pkg.dependencies).sort()).toEqual(
    expectedDependencies(importsByDir, HOST_PROVIDED_BY_DIR),
  );
});

test("a directory's host set excuses only that directory's imports", () => {
  expect(expectedDependencies({ pi: ["typebox", "zod"] }, HOST_PROVIDED_BY_DIR)).toEqual(["zod"]);
  expect(expectedDependencies({ opencode: ["typebox"] }, HOST_PROVIDED_BY_DIR)).toEqual([
    "typebox",
  ]);
  expect(expectedDependencies({ pi: ["@opentui/solid"] }, HOST_PROVIDED_BY_DIR)).toEqual([
    "@opentui/solid",
  ]);
});

test("@opentui/solid, opencode/'s host-provided exception, is still imported by opencode/", () => {
  expect(importsByDir.opencode).toContain("@opentui/solid");
});

test("`dependencies` is the only section a consumer's install pulls", () => {
  // npm and bun both install `optionalDependencies` by default and auto-install
  // non-optional peers, so either section is a second door the assertion above does not
  // watch — a build input parked in one still reaches every consumer.
  expect(Object.keys(pkg).filter((key) => key.endsWith("Dependencies"))).toEqual([
    "devDependencies",
  ]);
});

test("every shipped source directory still has imports to derive the expected set from", () => {
  // Without this the gate passes vacuously the moment a directory is renamed or its
  // imports are inlined — finding nothing would read as "dependencies is empty and
  // correct" rather than as a broken scan.
  for (const names of Object.values(importsByDir)) expect(names.size).toBeGreaterThan(0);
});

test("review-bridge.ts, which the CLI bundles, imports node builtins only and no sibling module", () => {
  // A relative import could reach caret.plugin.ts and inline @opencode-ai/plugin into
  // dist/cli.js — which the dependencies check above cannot see, since it is declared.
  const source = readFileSync(join(REPO_ROOT, OPENCODE_DIR, "review-bridge.ts"), "utf-8");
  expect(importedPackages(source)).toEqual([]);
  expect(source).not.toMatch(/\b(?:from|import)\s*\(?\s*"\.\.?\//);
});

const readShipped = (file: string) => readFileSync(join(REPO_ROOT, OPENCODE_DIR, file), "utf-8");

// Type-only imports count here, unlike the gates above: tsc still resolves an erased
// `import type`, so one from caret.plugin.ts re-couples the core to the v1 plugin,
// and one from @opencode-ai/plugin ties the core back to v1's SDK.
const nonBuiltinImports = (file: string) =>
  new Set(importSpecifiers(readShipped(file)).filter((spec) => !isBuiltin(spec)));

test("caret.core.ts's closure is review-bridge.ts and node builtins, type-only imports included", () => {
  expect(nonBuiltinImports("caret.core.ts")).toEqual(new Set(["./review-bridge.ts"]));
  expect(nonBuiltinImports("review-bridge.ts")).toEqual(new Set());
});

test("src/ reaches opencode/ only through review-bridge.ts, so the CLI bundle never pulls in the plugin SDK", () => {
  // `@opencode/` is the real v2 plugin SDK's scope, which src/ must not import either.
  const specifiers = [...new Bun.Glob("**/*.ts").scanSync({ cwd: join(REPO_ROOT, "src") })].flatMap(
    (file) =>
      [
        ...readFileSync(join(REPO_ROOT, "src", file), "utf-8").matchAll(
          /"((?:@oc|@opencode)\/[^"]+)"/g,
        ),
      ].map((match) => match[1]),
  );
  expect(specifiers.length).toBeGreaterThan(0);
  expect(new Set(specifiers)).toEqual(new Set(["@oc/review-bridge.ts"]));
});

test("the extractor reduces a subpath to its package name and keeps the scope", () => {
  expect(importedPackages('from "@opencode-ai/plugin"')).toEqual(["@opencode-ai/plugin"]);
  expect(importedPackages('from "@codemirror/view/dist/index.js"')).toEqual(["@codemirror/view"]);
  expect(importedPackages('from "shiki/core"')).toEqual(["shiki"]);
});

test("the extractor drops builtins and relative specifiers, not package names", () => {
  expect(importedPackages('from "node:child_process"')).toEqual([]);
  expect(importedPackages('from "fs"')).toEqual([]);
  expect(importedPackages('export { default } from "./caret.plugin.ts"')).toEqual([]);
  expect(importedPackages('from "semver"')).toEqual(["semver"]);
});

test("the extractor reads side-effect and dynamic imports, not just the from form", () => {
  expect(importedPackages('import "zod";')).toEqual(["zod"]);
  expect(importedPackages('await import("smol-toml")')).toEqual(["smol-toml"]);
});
