// Standing gate for the pi extension's shipped closure. pi loads `pi/caret.ts` as source
// from the installed package under Node, not Bun, so every module it reaches through a
// relative import must be in package.json's `files` and must not touch the `Bun` global —
// either mistake breaks the extension only at load time on a user's machine.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import pkg from "@root/package.json" with { type: "json" };
import { runtimeImportSpecifiers } from "@test/support/import-specifiers.ts";

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const ENTRY = "pi/caret.ts";

const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");
const ships = (rel: string, files: readonly string[]) =>
  files.some((f) => rel === f || (f.endsWith("/") && rel.startsWith(f)));

/** Every repo-relative path reached from `entry` through relative runtime imports. */
function relativeClosure(entry: string, readFile: (rel: string) => string): string[] {
  const seen = new Set<string>();
  const pending = [entry];
  for (let rel = pending.pop(); rel !== undefined; rel = pending.pop()) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const spec of runtimeImportSpecifiers(readFile(rel))) {
      if (spec.startsWith(".")) pending.push(normalize(join(dirname(rel), spec)));
    }
  }
  return [...seen].sort();
}

const usesBun = (source: string) =>
  /\bBun\./.test(source) ||
  runtimeImportSpecifiers(source).some((s) => s === "bun" || s.startsWith("bun:"));

/** The paths that don't ship under `files` or that reach for Bun's runtime. */
function closureViolations(
  paths: readonly string[],
  read: (rel: string) => string,
  files: readonly string[],
): string[] {
  return paths.filter((rel) => !ships(rel, files) || usesBun(read(rel)));
}

const realClosure = relativeClosure(ENTRY, readRepo);

test("the pi entry's closure includes the review bridge and the shared state", () => {
  expect(realClosure).toContain("opencode/review-bridge.ts");
  expect(realClosure).toContain("pi/state.ts");
});

test("every module the pi entry reaches ships and is Bun-free", () => {
  expect(closureViolations(realClosure, readRepo, pkg.files)).toEqual([]);
});

const fixture: Record<string, string> = {
  "pi/caret.ts": 'import { a } from "./a.ts";\nimport { x } from "./x.ts";',
  "pi/a.ts": 'import { b } from "./b.ts";',
  "pi/b.ts": 'Bun.spawn(["caret"]);',
  "pi/x.ts": "export const x = 1;",
};
const readFixture = (rel: string) => fixture[rel] ?? "";
const fixtureClosure = relativeClosure("pi/caret.ts", readFixture);

test("the closure follows relative imports transitively", () => {
  expect(fixtureClosure).toEqual(["pi/a.ts", "pi/b.ts", "pi/caret.ts", "pi/x.ts"]);
});

test("a transitive module using Bun's runtime is a violation", () => {
  expect(closureViolations(fixtureClosure, readFixture, ["pi/"])).toEqual(["pi/b.ts"]);
});

test("a module importing a `bun` or `bun:` specifier is a violation", () => {
  // Built by concatenation so import-conventions.test.ts doesn't read the fixture as an import.
  const bunFixture: Record<string, string> = {
    "pi/a.ts": `import { $ } from "${"bun"}";`,
    "pi/b.ts": `import { Database } from "${"bun"}:sqlite";`,
    "pi/x.ts": "export const x = 1;",
  };
  const read = (rel: string) => bunFixture[rel] ?? "";
  expect(closureViolations(Object.keys(bunFixture), read, ["pi/"])).toEqual(["pi/a.ts", "pi/b.ts"]);
});

test("a module outside `files` is a violation", () => {
  expect(closureViolations(["pi/caret.ts", "pi/x.ts"], readFixture, ["pi/caret.ts"])).toEqual([
    "pi/x.ts",
  ]);
});

test("every pi extension entry exists and ships", () => {
  const entries = pkg.pi.extensions.map((e) => normalize(e));
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.filter((rel) => !existsSync(join(REPO_ROOT, rel)))).toEqual([]);
  expect(entries.filter((rel) => !ships(rel, pkg.files))).toEqual([]);
});

test("the package is discoverable as a pi package", () => {
  expect(pkg.keywords).toContain("pi-package");
});
