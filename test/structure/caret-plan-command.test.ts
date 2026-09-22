// Standing gate for `/caret:plan`. Both agents discover the command by file path, so a
// dropped or renamed file, or a `files` entry that stops shipping it, fails silently at
// the user's terminal and never in CI. Nothing but this suite catches it.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REVIEW_TOOL } from "@opencode/caret.plugin.ts";
import pkg from "@root/package.json" with { type: "json" };
import { MARKDOWN_READ_BY_TESTS } from "@scripts/preflight.ts";

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const CLAUDE_COMMAND = "commands/plan.md";
const OPENCODE_COMMAND = "opencode/commands/plan.md";
const COMMANDS = [CLAUDE_COMMAND, OPENCODE_COMMAND];

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");
const unshipped = (paths: readonly string[]) =>
  paths.filter(
    (rel) => !pkg.files.some((f) => rel === f || (f.endsWith("/") && rel.startsWith(f))),
  );

test("both plan commands exist and ship", () => {
  expect(COMMANDS.filter((rel) => !existsSync(join(REPO_ROOT, rel)))).toEqual([]);
  expect(unshipped(COMMANDS)).toEqual([]);
});

test(`${CLAUDE_COMMAND} routes through ExitPlanMode, the call caret's hook intercepts`, () => {
  expect(read(CLAUDE_COMMAND)).toContain("ExitPlanMode");
});

test(`${OPENCODE_COMMAND} calls the plugin's review tool by its current name`, () => {
  expect(read(OPENCODE_COMMAND)).toContain(REVIEW_TOOL);
});

test("preflight runs this suite when only the plan commands changed", () => {
  expect(COMMANDS.filter((rel) => !MARKDOWN_READ_BY_TESTS.includes(rel))).toEqual([]);
});
