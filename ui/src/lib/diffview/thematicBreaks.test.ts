import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { codeBlockRanges } from "$lib/diffview/codeBlocks.ts";
import { tagThematicBreakRows, thematicBreakLines } from "$lib/diffview/thematicBreaks.ts";

// thematicBreakLines decides which lines of a rendered plan are real thematic
// breaks, so the source view can draw a horizontal rule on those rows (EXC-862).
// Most of this suite is the NEGATIVE half: `---` is also a setext heading
// underline, a YAML front-matter delimiter, and (inside pipes) a table delimiter
// row, and converting any of those is a wrong render rather than a taste call.
describe("thematicBreakLines", () => {
  // The fenced ranges the view would pass, derived the same way SourceView derives
  // them, so a case written here is a case the production wiring really produces.
  const lines = (text: string) =>
    [...thematicBreakLines(text, codeBlockRanges(text))].sort((a, b) => a - b);

  test("finds nothing in prose", () => {
    expect(lines("just prose\nmore prose\n")).toEqual([]);
  });

  test("finds all three CommonMark spellings", () => {
    expect(lines(["a", "", "---", "", "b", "", "***", "", "c", "", "___"].join("\n"))).toEqual([
      3, 7, 11,
    ]);
  });

  test("finds the spaced, longer and indented forms", () => {
    // CommonMark allows internal spaces, more than three markers, up to three
    // leading spaces, and trailing whitespace.
    expect(lines(["- - -", "", "*****", "", "  ___  "].join("\n"))).toEqual([1, 3, 5]);
  });

  test("leaves a setext heading underline alone", () => {
    // `text` then `---` is an <h2>, not a rule — the single most common way a
    // dashes-only line is NOT a thematic break.
    expect(lines(["Setext head", "---", "", "prose"].join("\n"))).toEqual([]);
  });

  test("leaves a table delimiter row alone", () => {
    expect(lines(["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n"))).toEqual([]);
  });

  test("leaves a line inside a fenced block alone", () => {
    expect(lines(["```", "---", "```"].join("\n"))).toEqual([]);
  });

  test("leaves both YAML front-matter delimiters alone", () => {
    expect(lines(["---", "title: x", "---", "", "prose"].join("\n"))).toEqual([]);
  });

  test("leaves front matter closed with ... alone", () => {
    expect(lines(["---", "title: x", "...", "", "prose"].join("\n"))).toEqual([]);
  });

  test("reads front matter carrying a blank line as two rules, not as front matter", () => {
    // The deliberate cost of bounding the closer scan at the first blank line. The
    // delimiters draw rules, which is local and visible; the unbounded scan's
    // failure — claiming a distant `---` as the closer — is neither.
    expect(lines(["---", "title: x", "", "---", "", "prose"].join("\n"))).toEqual([1, 4]);
  });

  test("keeps a leading --- that never closes", () => {
    // Unclosed is not front matter; a document that opens on a rule still gets one.
    expect(lines(["---", "", "prose"].join("\n"))).toEqual([1]);
  });

  test("keeps a distant break when the document opens on one", () => {
    // The falsifying case for the front-matter guard: an unbounded search for the
    // closer would claim line 7 and delete both, losing a rule six lines away from
    // anything the guard is about.
    expect(lines(["---", "", "# Title", "", "prose", "", "---"].join("\n"))).toEqual([1, 7]);
  });

  test("keeps an indented leading break, which front matter cannot be", () => {
    expect(lines(["  ---", "", "prose", "", "---"].join("\n"))).toEqual([1, 5]);
  });

  test("leaves a line the panel calls code alone, even when CommonMark disagrees", () => {
    // caret's fence scan toggles on every ``` line, so on nested fences it and marked
    // disagree about which rows are code; the row a reader sees inside a code panel
    // must not also carry a rule. Deferring to the panel costs the break at line 5.
    const text = ["````", "```", "````", "", "---", "", "prose"].join("\n");
    expect(codeBlockRanges(text)).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 7 },
    ]);
    expect(lines(text)).toEqual([]);
  });

  test("keeps a --- that interrupts a list", () => {
    // CommonMark reads this as ending the list and drawing a rule, not as
    // underlining the item's paragraph.
    expect(lines(["- item", "---", "", "prose"].join("\n"))).toEqual([2]);
  });

  test("leaves a quoted --- alone", () => {
    // A break nested inside a blockquote is not drawn. Documented degradation:
    // the row keeps its raw characters rather than rendering wrongly.
    expect(lines(["> ---", "", "prose"].join("\n"))).toEqual([]);
  });
});

// A fixture mirroring the @pierre/diffs shadow DOM: a content column of
// [data-line] rows, one per display line — the same shape codeBlocks.test.ts builds.
function buildContent(lineCount: number): HTMLElement {
  const root = document.createElement("div");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  for (let n = 1; n <= lineCount; n++) {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(n));
    content.appendChild(row);
  }
  root.append(content);
  return root;
}

const tagged = (root: HTMLElement, line: number) =>
  root.querySelector(`[data-content] [data-line="${line}"]`)?.hasAttribute("data-md-rule") ?? false;

describe("tagThematicBreakRows", () => {
  test("tags the named rows and only those", () => {
    const root = buildContent(4);
    tagThematicBreakRows(root, new Set([2, 4]));
    expect([1, 2, 3, 4].map((n) => tagged(root, n))).toEqual([false, true, false, true]);
  });

  test("clears a stale tag when the breaks move", () => {
    const root = buildContent(3);
    tagThematicBreakRows(root, new Set([1]));
    tagThematicBreakRows(root, new Set([3]));
    expect([1, 2, 3].map((n) => tagged(root, n))).toEqual([false, false, true]);
  });

  test("tags a row a card has moved out of direct-child position", () => {
    // EXC-864's reviewer found four gutter rules stopped matching once table rows
    // were carded; every row rule in this sheet is a DESCENDANT selector for that
    // reason, and so is this pass's query.
    const root = buildContent(2);
    const content = root.querySelector("[data-content]") as HTMLElement;
    const card = document.createElement("div");
    content.insertBefore(card, content.firstChild);
    card.appendChild(root.querySelector('[data-content] [data-line="1"]') as HTMLElement);
    tagThematicBreakRows(root, new Set([1]));
    expect(tagged(root, 1)).toBe(true);
  });
});
