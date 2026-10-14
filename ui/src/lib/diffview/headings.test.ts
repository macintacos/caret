import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { fillLines } from "@ui/support/diffview-dom.ts";
import { codeBlockRanges } from "$lib/diffview/codeBlocks.ts";
import { headingLines, tagHeadingRows } from "$lib/diffview/headings.ts";

describe("headingLines", () => {
  // The fenced ranges the view would pass, derived the same way SourceView derives them.
  const lines = (text: string) =>
    [...headingLines(text, codeBlockRanges(text))].sort((a, b) => a - b);

  test("finds every ATX level", () => {
    expect(lines(["# One", "", "prose", "", "### Three", "###### Six"].join("\n"))).toEqual([
      1, 5, 6,
    ]);
  });

  test("finds both lines of a setext heading", () => {
    expect(lines(["prose", "", "Setext title", "===", "", "Second", "---"].join("\n"))).toEqual([
      3, 4, 6, 7,
    ]);
  });

  test("leaves a hash that opens no heading alone", () => {
    expect(lines(["#hashtag", "", "prose # mid-line"].join("\n"))).toEqual([]);
  });

  test("leaves a line inside a fenced block alone", () => {
    expect(lines(["```sh", "# a shell comment", "```"].join("\n"))).toEqual([]);
  });

  test("leaves YAML front matter alone, where marked reads its lines as headings", () => {
    // marked reads the comment as an ATX heading, and the last key over the closer as setext.
    const text = ["---", "# a yaml comment", "title: x", "---", "", "# Real"].join("\n");
    expect(lines(text)).toEqual([6]);
  });

  test("leaves a line the code panel claims alone, where CommonMark reads a heading", () => {
    // A backtick in its info string makes the first line prose to CommonMark, but caret's
    // fence scan opens a block on it, and the panel is what the reader sees.
    expect(lines(["``` a ``` b", "# Title", "```"].join("\n"))).toEqual([]);
  });
});

function buildContent(lineCount: number): HTMLElement {
  const root = document.createElement("div");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  fillLines(content, lineCount);
  root.append(content);
  return root;
}

const tagged = (root: HTMLElement, line: number) =>
  root.querySelector(`[data-content] [data-line="${line}"]`)?.hasAttribute("data-md-heading") ??
  false;

describe("tagHeadingRows", () => {
  test("tags the named rows and clears the rest", () => {
    const root = buildContent(3);
    tagHeadingRows(root, new Set([1]));
    tagHeadingRows(root, new Set([3]));
    expect([1, 2, 3].map((n) => tagged(root, n))).toEqual([false, false, true]);
  });
});
