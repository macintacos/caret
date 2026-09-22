// Standing gate for the dependency-placement law (EXC-1086). `opencode/` is the one
// directory caret publishes as unbundled TypeScript, so its imports are the only npm
// specifiers a consumer's package manager ever has to resolve — `dist/cli.js` and
// `ui/dist` are bundles with no package names left in them. OpenCode installs the plugin
// package **and its declared `dependencies`** into its own cache, so a build input filed
// in `dependencies` is downloaded by every OpenCode user and loaded by none.
// `doc/agents/dependency-rules.md` § Where a new package goes states the rule; this suite
// is what makes it falsifiable, so the next misplacement fails `bun test` on the push that
// adds it rather than being caught by an audit years later.
//
// Two escape hatches, both real:
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
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join } from "node:path";

import pkg from "@root/package.json" with { type: "json" };
import { importSpecifiers } from "@test/support/import-specifiers.ts";

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const SHIPPED_DIR = "opencode";

// The scan boundary is the publish boundary: `files` ships `opencode/` entire, so every
// module extension a consumer could resolve is read, not just the three `.ts` files here
// today. A shipped file this glob missed would go silently underived — the one failure
// direction that leaves the gate green while a consumer's install breaks.
const SHIPPED_GLOB = "**/*.{ts,mts,cts,js,mjs,cjs}";

/**
 * Every npm package name `source` imports. Relative and absolute specifiers and node
 * builtins are dropped; a subpath is reduced to its package name (`@scope/pkg/sub` to
 * `@scope/pkg`, `pkg/sub` to `pkg`), which is the unit `package.json` declares. The
 * extractor's limits (double quotes only, raw source) are exhaustive here: a template-
 * literal or `require()` specifier has no place in an ESM plugin. A type-only import
 * counts: types are erased before a consumer runs anything, so this is strict in the
 * safe direction; keep `opencode/` free of `import type` from a package you would not
 * want every consumer to download.
 */
function importedPackages(source: string): string[] {
  return importSpecifiers(source)
    .filter((spec) => !spec.startsWith(".") && !spec.startsWith("/") && !isBuiltin(spec))
    .map((spec) =>
      spec
        .split("/")
        .slice(0, spec.startsWith("@") ? 2 : 1)
        .join("/"),
    );
}

const shipped = new Set<string>();
for (const file of new Bun.Glob(SHIPPED_GLOB).scanSync({ cwd: join(REPO_ROOT, SHIPPED_DIR) })) {
  const source = readFileSync(join(REPO_ROOT, SHIPPED_DIR, file), "utf-8");
  for (const name of importedPackages(source)) shipped.add(name);
}

test("`dependencies` carries exactly what opencode/ makes a consumer resolve", () => {
  expect(Object.keys(pkg.dependencies).sort()).toEqual([...shipped].sort());
});

test("`dependencies` is the only section a consumer's install pulls", () => {
  // npm and bun both install `optionalDependencies` by default and auto-install
  // non-optional peers, so either section is a second door the assertion above does not
  // watch — a build input parked in one still reaches every consumer.
  expect(Object.keys(pkg).filter((key) => key.endsWith("Dependencies"))).toEqual([
    "devDependencies",
  ]);
});

test("opencode/ still has imports to derive the expected set from", () => {
  // Without this the gate passes vacuously the moment the directory is renamed or the
  // plugin's imports are inlined — finding nothing would read as "dependencies is empty
  // and correct" rather than as a broken scan.
  expect(shipped.size).toBeGreaterThan(0);
});

test("review-bridge.ts, which the CLI bundles, imports node builtins only and no sibling module", () => {
  // A relative import could reach caret.plugin.ts and inline @opencode-ai/plugin into
  // dist/cli.js — which the dependencies check above cannot see, since it is declared.
  const source = readFileSync(join(REPO_ROOT, SHIPPED_DIR, "review-bridge.ts"), "utf-8");
  expect(importedPackages(source)).toEqual([]);
  expect(source).not.toMatch(/\b(?:from|import)\s*\(?\s*"\.\.?\//);
});

test("src/ reaches opencode/ only through review-bridge.ts, so the CLI bundle never pulls in the plugin SDK", () => {
  const specifiers = [...new Bun.Glob("**/*.ts").scanSync({ cwd: join(REPO_ROOT, "src") })].flatMap(
    (file) =>
      [
        ...readFileSync(join(REPO_ROOT, "src", file), "utf-8").matchAll(/"(@opencode\/[^"]+)"/g),
      ].map((match) => match[1]),
  );
  expect(specifiers.length).toBeGreaterThan(0);
  expect(new Set(specifiers)).toEqual(new Set(["@opencode/review-bridge.ts"]));
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
