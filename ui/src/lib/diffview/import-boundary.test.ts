import { describe, expect, test } from "bun:test";
import { join, relative } from "node:path";
import { Glob } from "bun";

// The diffview module is the single owner of @pierre/diffs: this suite scans
// every source tree in the repo and fails if any file outside
// ui/src/lib/diffview/ imports the package. The boundary is what keeps the
// library swappable and its vanilla API out of the rest of the codebase.

const repoRoot = join(import.meta.dir, "../../../..");

const ALLOWED_PREFIX = "ui/src/lib/diffview/";

// Import/re-export/require forms, including type-only and dynamic imports.
// A bare mention in a comment or string (no import syntax) does not match.
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']@pierre\/diffs/;

const importsPierreDiffs = (source: string): boolean => IMPORT_PATTERN.test(source);

// Every tree that holds TypeScript or Svelte source (ui/dist and node_modules
// are outside these globs by construction).
const SOURCE_GLOBS = [
  "*.ts",
  "src/**/*.ts",
  "scripts/**/*.ts",
  "test/**/*.ts",
  "hooks/**/*.ts",
  "commands/**/*.ts",
  "ui/*.ts",
  "ui/src/**/*.ts",
  "ui/src/**/*.svelte",
];

async function scanRepo(): Promise<{ allowed: string[]; violations: string[] }> {
  const allowed: string[] = [];
  const violations: string[] = [];
  for (const pattern of SOURCE_GLOBS) {
    for await (const path of new Glob(pattern).scan({ cwd: repoRoot, absolute: true })) {
      const source = await Bun.file(path).text();
      if (!importsPierreDiffs(source)) continue;
      const repoPath = relative(repoRoot, path);
      (repoPath.startsWith(ALLOWED_PREFIX) ? allowed : violations).push(repoPath);
    }
  }
  return { allowed, violations };
}

describe("the @pierre/diffs import matcher", () => {
  test("recognizes the import forms the boundary must catch", () => {
    expect(importsPierreDiffs('import { File } from "@pierre/diffs";')).toBe(true);
    expect(importsPierreDiffs("import type { FileContents } from '@pierre/diffs';")).toBe(true);
    expect(importsPierreDiffs('export type { LineAnnotation } from "@pierre/diffs";')).toBe(true);
    expect(importsPierreDiffs('const mod = await import("@pierre/diffs");')).toBe(true);
    expect(importsPierreDiffs('const mod = require("@pierre/diffs");')).toBe(true);
    expect(importsPierreDiffs('import "@pierre/diffs";')).toBe(true);
  });

  test("ignores bare mentions that are not imports", () => {
    expect(importsPierreDiffs("// rendered by @pierre/diffs under the hood")).toBe(false);
    expect(importsPierreDiffs('const label = "@pierre/diffs";')).toBe(false);
  });
});

describe("the import boundary", () => {
  test("only ui/src/lib/diffview/ imports @pierre/diffs", async () => {
    const { allowed, violations } = await scanRepo();
    // Sanity: the scan sees the module's own importers, so an empty result
    // can't silently come from a broken glob.
    expect(allowed.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
