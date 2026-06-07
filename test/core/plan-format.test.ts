import { expect, test } from "bun:test";
import { hasUntaggedCodeBlock, PLAN_FORMAT_DENY_MESSAGE } from "../../src/plan-format.ts";

// A bare fence (no info string) renders unhighlighted → violation.
test("a bare fenced code block is untagged", () => {
  expect(hasUntaggedCodeBlock("# Plan\n\n```\nconst x = 1;\n```\n")).toBe(true);
});

// An info string present on every fence → no violation.
test("a fenced code block with a language marker is tagged", () => {
  expect(hasUntaggedCodeBlock("# Plan\n\n```ts\nconst x = 1;\n```\n")).toBe(false);
});

// `text` counts as an info string (non-code blocks satisfy the rule).
test("a fence tagged `text` is tagged", () => {
  expect(hasUntaggedCodeBlock("```text\nproject/\n  file.ts\n```\n")).toBe(false);
});

test("prose with no code blocks passes", () => {
  expect(hasUntaggedCodeBlock("# Plan\n\nJust prose, no code here.\n")).toBe(false);
});

test("an empty string passes (no code blocks)", () => {
  expect(hasUntaggedCodeBlock("")).toBe(false);
});

test("whitespace-only passes (no code blocks)", () => {
  expect(hasUntaggedCodeBlock("   \n\n  ")).toBe(false);
});

test("undefined passes (no plan)", () => {
  expect(hasUntaggedCodeBlock(undefined)).toBe(false);
});

// Tilde fences are equivalent to backtick fences.
test("a bare tilde fence is untagged", () => {
  expect(hasUntaggedCodeBlock("~~~\ncode\n~~~\n")).toBe(true);
});

test("a tagged tilde fence is tagged", () => {
  expect(hasUntaggedCodeBlock("~~~py\nprint(1)\n~~~\n")).toBe(false);
});

// Indented (4-space) code blocks have no info string and render unhighlighted.
test("an indented code block is untagged", () => {
  expect(hasUntaggedCodeBlock("Some prose.\n\n    indented = true\n    more = false\n")).toBe(true);
});

// walkTokens must descend into list items.
test("a bare fence nested in a list item is untagged", () => {
  expect(hasUntaggedCodeBlock("- item\n\n  ```\n  code\n  ```\n")).toBe(true);
});

// walkTokens must descend into blockquotes.
test("a bare fence nested in a blockquote is untagged", () => {
  expect(hasUntaggedCodeBlock("> Note:\n>\n> ```\n> code\n> ```\n")).toBe(true);
});

// A fence shown as a literal example inside a tagged outer block is part of the
// outer block's text, not a separate token — same as the renderer sees it.
test("literal fences inside a tagged outer fence are not flagged", () => {
  const md = "````md\n```\nnot a real block\n```\n````\n";
  expect(hasUntaggedCodeBlock(md)).toBe(false);
});

// A tagged block and a bare block together → still a violation.
test("a mix with one bare fence is untagged", () => {
  const md = "```ts\nconst a = 1;\n```\n\nmore\n\n```\nbare\n```\n";
  expect(hasUntaggedCodeBlock(md)).toBe(true);
});

// The format-deny message is actionable and distinct from the fail-safe deny.
test("the deny message names the fix and is distinct from the fail-safe deny", () => {
  expect(PLAN_FORMAT_DENY_MESSAGE).toContain("language marker");
  expect(PLAN_FORMAT_DENY_MESSAGE.toLowerCase()).toContain("text");
  expect(PLAN_FORMAT_DENY_MESSAGE).not.toContain("no unreviewed plan ships");
});
