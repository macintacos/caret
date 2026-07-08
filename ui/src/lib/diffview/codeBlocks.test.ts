import "../../../test-setup.ts";
import { describe, expect, test } from "bun:test";
import { codeBlockRanges, tagCodeBlockRows } from "./codeBlocks.ts";

// codeBlockRanges classifies which lines of a rendered plan belong to a fenced
// code block, so the source view can decorate those rows as a panel (EXC-692).
// Ranges are 1-based and inclusive, spanning the opening fence line through the
// closing fence line, matching the simple fence-toggle semantics buildLinkLayer
// (links.ts) already uses so the two layers agree on what "code" is.
describe("codeBlockRanges", () => {
  test("returns no ranges when there is no fence", () => {
    expect(codeBlockRanges("just prose\nmore prose\n")).toEqual([]);
  });

  test("spans one block from its opening fence to its closing fence", () => {
    const text = ["intro", "```ts", "const x = 1;", "```", "outro"].join("\n");
    // opening fence is line 2, closing fence is line 4 (both inclusive).
    expect(codeBlockRanges(text)).toEqual([{ start: 2, end: 4 }]);
  });

  test("returns a separate range per block", () => {
    const text = ["```ts", "a", "```", "prose", "```sh", "b", "```"].join("\n");
    expect(codeBlockRanges(text)).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 7 },
    ]);
  });

  test("treats tilde fences the same as backtick fences", () => {
    const text = ["~~~python", "x = 1", "~~~"].join("\n");
    expect(codeBlockRanges(text)).toEqual([{ start: 1, end: 3 }]);
  });

  test("runs an unclosed fence to the end of the document", () => {
    const text = ["prose", "```ts", "still code", "and code"].join("\n");
    expect(codeBlockRanges(text)).toEqual([{ start: 2, end: 4 }]);
  });

  test("detects a fence indented up to three spaces", () => {
    const text = ["   ```ts", "code", "   ```"].join("\n");
    expect(codeBlockRanges(text)).toEqual([{ start: 1, end: 3 }]);
  });

  test("toggles on every fence line (matching the link layer)", () => {
    // A ``` inside a longer ```` fence still toggles, mirroring buildLinkLayer's
    // stateless fence detection: each fence line flips the in-code state.
    const text = ["````", "```", "````", "```"].join("\n");
    expect(codeBlockRanges(text)).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]);
  });
});

// A fixture mirroring the @pierre/diffs shadow DOM: a gutter of [data-column-number]
// cells and a content column of [data-line] rows, one per source line.
function buildContent(lineCount: number): HTMLElement {
  const root = document.createElement("div");
  const gutter = document.createElement("div");
  gutter.setAttribute("data-gutter", "");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  for (let n = 1; n <= lineCount; n++) {
    const num = document.createElement("div");
    num.setAttribute("data-column-number", String(n));
    gutter.appendChild(num);
    const row = document.createElement("div");
    row.setAttribute("data-line", String(n));
    content.appendChild(row);
  }
  root.append(gutter, content);
  return root;
}

function rowAttrs(root: HTMLElement, line: number) {
  const row = root.querySelector(`[data-content] > [data-line="${line}"]`);
  return {
    code: row?.hasAttribute("data-code-line") ?? false,
    start: row?.hasAttribute("data-code-start") ?? false,
    end: row?.hasAttribute("data-code-end") ?? false,
  };
}

describe("tagCodeBlockRows", () => {
  test("marks every content line in a block, and its first/last", () => {
    const root = buildContent(5);
    tagCodeBlockRows(root, [{ start: 2, end: 4 }]);
    expect(rowAttrs(root, 1)).toEqual({ code: false, start: false, end: false });
    expect(rowAttrs(root, 2)).toEqual({ code: true, start: true, end: false });
    expect(rowAttrs(root, 3)).toEqual({ code: true, start: false, end: false });
    expect(rowAttrs(root, 4)).toEqual({ code: true, start: false, end: true });
    expect(rowAttrs(root, 5)).toEqual({ code: false, start: false, end: false });
  });

  test("never tags the gutter number cells", () => {
    const root = buildContent(3);
    tagCodeBlockRows(root, [{ start: 1, end: 3 }]);
    const numbers = root.querySelectorAll("[data-column-number]");
    for (const n of numbers) expect(n.hasAttribute("data-code-line")).toBe(false);
  });

  test("clears stale tags when the ranges change", () => {
    const root = buildContent(5);
    tagCodeBlockRows(root, [{ start: 1, end: 2 }]);
    // Re-tag with a different block: lines 1-2 must be cleared, 4-5 marked.
    tagCodeBlockRows(root, [{ start: 4, end: 5 }]);
    expect(rowAttrs(root, 1)).toEqual({ code: false, start: false, end: false });
    expect(rowAttrs(root, 2)).toEqual({ code: false, start: false, end: false });
    expect(rowAttrs(root, 4)).toEqual({ code: true, start: true, end: false });
    expect(rowAttrs(root, 5)).toEqual({ code: true, start: false, end: true });
  });
});
