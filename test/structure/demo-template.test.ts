// Standing gate for the demo template. Claude Code reads it from the plugin root,
// OpenCode's install embeds it, and pi reads it at run time from beside its extension,
// so dropping `templates/` from package.json's `files`, or moving the template, breaks
// every installed `/caret demo` with no error at install or run time. Nothing but this
// suite catches it.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEMO_COMMAND as PI_DEMO_COMMAND, DEMO_TEMPLATE as PI_DEMO_TEMPLATE } from "@piext/demo.ts";
import pkg from "@root/package.json" with { type: "json" };
import { MARKDOWN_READ_BY_TESTS } from "@scripts/preflight.ts";
import { DEMO_TEMPLATE } from "@/adapters/opencode/packaging.ts";

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const CLAUDE_COMMAND = "skills/caret/references/demo.md";
const OPENCODE_COMMAND = "opencode/references/demo.md";

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");
const missing = (paths: readonly string[]) =>
  paths.filter((rel) => !existsSync(join(REPO_ROOT, rel)));
const unshipped = (paths: readonly string[]) =>
  paths.filter(
    (rel) => !pkg.files.some((f) => rel === f || (f.endsWith("/") && rel.startsWith(f))),
  );

const claudePaths = read(CLAUDE_COMMAND)
  .split("<plugin root>/")
  .slice(1)
  .map((s) => s.match(/^[\w./-]+/)?.[0] ?? "");

test(`${CLAUDE_COMMAND} reads only files the package ships`, () => {
  expect(claudePaths.length).toBeGreaterThan(0);
  expect(missing(claudePaths)).toEqual([]);
  expect(unshipped(claudePaths)).toEqual([]);
});

test(`${OPENCODE_COMMAND} embeds a template the package ships`, () => {
  expect(read(OPENCODE_COMMAND)).toContain("__CARET_DEMO_TEMPLATE__");
  expect(missing([DEMO_TEMPLATE])).toEqual([]);
  expect(unshipped([DEMO_TEMPLATE])).toEqual([]);
});

const PI_ENTRY = "pi/caret.ts";
const fromPiEntry = (rel: string) =>
  relative(REPO_ROOT, fileURLToPath(new URL(rel, pathToFileURL(join(REPO_ROOT, PI_ENTRY)))));
const piPaths = [fromPiEntry(PI_DEMO_COMMAND), fromPiEntry(PI_DEMO_TEMPLATE)];

test(`${PI_ENTRY}'s /caret demo reads only files the package ships`, () => {
  expect(missing(piPaths)).toEqual([]);
  expect(unshipped(piPaths)).toEqual([]);
});

test("preflight runs this suite when only the Markdown it reads changed", () => {
  const markdown = [
    CLAUDE_COMMAND,
    OPENCODE_COMMAND,
    ...claudePaths.filter((rel) => rel.endsWith(".md")),
    DEMO_TEMPLATE,
  ];
  expect(markdown.filter((rel) => !MARKDOWN_READ_BY_TESTS.includes(rel))).toEqual([]);
});
