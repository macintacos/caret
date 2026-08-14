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

// The suite sits at test/structure/, two levels below the repo root; resolving against
// import.meta.dir reads the real tree regardless of the runner's cwd.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const SHIPPED_DIR = "opencode";

// The scan boundary is the publish boundary: `files` ships `opencode/` entire, so every
// module extension a consumer could resolve is read, not just the two `.ts` files here
// today. A shipped file this glob missed would go silently underived — the one failure
// direction that leaves the gate green while a consumer's install breaks.
const SHIPPED_GLOB = "**/*.{ts,mts,cts,js,mjs,cjs}";

/**
 * Every npm package name `source` imports.
 *
 * Covers all three specifier-bearing forms — `from "…"` (which also catches
 * `export … from`), a bare side-effect `import "…"`, and a dynamic `import("…")` — since
 * each is a module reference a consumer's resolver must satisfy. Relative and absolute
 * specifiers and node builtins are dropped; a subpath is reduced to its package name
 * (`@scope/pkg/sub` to `@scope/pkg`, `pkg/sub` to `pkg`), which is the unit `package.json`
 * declares. The `(?<!@)` guard drops CSS `@import` at-rules, matching the sibling
 * extractor in import-conventions.test.ts.
 *
 * Three properties worth knowing before reading a failure:
 *
 * - **Double-quoted specifiers only**, which is exhaustive here rather than lucky: biome
 *   formats this tree with `quoteStyle: "double"` and `opencode/` is in its scope, so a
 *   single-quoted import fails `mise run lint` before it can reach this scan. A
 *   template-literal or `require()` specifier would be missed silently — neither has a
 *   place in an ESM plugin, and both would have to survive review.
 * - **Raw source is scanned, not a token stream.** A `from "…"` inside a comment or a
 *   template literal is therefore read as a package name and reds the gate. That loud
 *   false positive — reword the prose — is the deliberate trade against a tokenizer that
 *   could mis-parse and silently stop seeing real imports.
 * - **A type-only import counts.** Types are erased before a consumer runs anything, so
 *   this is strict in the safe direction; keep `opencode/` free of `import type` from a
 *   package you would not want every consumer to download.
 */
function importedPackages(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?<!@)\b(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
    const spec = match[1];
    if (!spec) continue;
    if (spec.startsWith(".") || spec.startsWith("/")) continue;
    if (isBuiltin(spec)) continue;
    found.push(
      spec
        .split("/")
        .slice(0, spec.startsWith("@") ? 2 : 1)
        .join("/"),
    );
  }
  return found;
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
