import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { gutterContentRoot } from "@ui/support/diffview-dom.ts";
import { codeBlockRanges, codeBlockText, tagCodeBlockRows } from "$lib/diffview/codeBlocks.ts";

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

describe("codeBlockText", () => {
  test("returns the code between the fences, fences stripped", () => {
    const text = ["intro", "```ts", "const x = 1;", "return x;", "```", "outro"].join("\n");
    expect(codeBlockText(text, { start: 2, end: 5 })).toBe("const x = 1;\nreturn x;");
  });

  test("preserves interior blank lines and indentation", () => {
    const text = ["```py", "def f():", "", "    return 1", "```"].join("\n");
    expect(codeBlockText(text, { start: 1, end: 5 })).toBe("def f():\n\n    return 1");
  });

  test("handles a single code line", () => {
    const text = ["```", "solo", "```"].join("\n");
    expect(codeBlockText(text, { start: 1, end: 3 })).toBe("solo");
  });

  test("returns empty for an empty fenced block", () => {
    const text = ["```ts", "```"].join("\n");
    expect(codeBlockText(text, { start: 1, end: 2 })).toBe("");
  });

  test("keeps the last line when the fence is unclosed at EOF", () => {
    const text = ["```ts", "still code"].join("\n");
    expect(codeBlockText(text, { start: 1, end: 2 })).toBe("still code");
  });
});

// A fixture mirroring the @pierre/diffs shadow DOM: a gutter of [data-column-number]
// cells and a content column of [data-line] rows, one per source line.
function buildContent(lineCount: number): HTMLElement {
  const { root, gutter, content } = gutterContentRoot();
  for (let n = 1; n <= lineCount; n++) {
    const num = document.createElement("div");
    num.setAttribute("data-column-number", String(n));
    gutter.appendChild(num);
    const row = document.createElement("div");
    row.setAttribute("data-line", String(n));
    content.appendChild(row);
  }
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

  // The gutter number cells carry data-code-line too (start/end stay content-only)
  // so the focused-line cursor and hover band can brighten the gutter half to match
  // the content on a code row — CSS can't relate a gutter cell to its content
  // sibling across the two grid columns, so the tag is the bridge.
  const gutterCode = (root: HTMLElement, line: number) =>
    root
      .querySelector(`[data-gutter] > [data-column-number="${line}"]`)
      ?.hasAttribute("data-code-line");

  test("tags the gutter number cell of each code line, and only those", () => {
    const root = buildContent(5);
    tagCodeBlockRows(root, [{ start: 2, end: 4 }]);
    expect(gutterCode(root, 1)).toBe(false);
    expect(gutterCode(root, 2)).toBe(true);
    expect(gutterCode(root, 3)).toBe(true);
    expect(gutterCode(root, 4)).toBe(true);
    expect(gutterCode(root, 5)).toBe(false);
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
    // The gutter tags track the same way (line 1 cleared, line 4 marked).
    expect(gutterCode(root, 1)).toBe(false);
    expect(gutterCode(root, 4)).toBe(true);
  });

  test("tags rows even when a scroll card has moved them out of direct-child position", () => {
    // An overflowing block's rows get wrapped in a scroll card (codeBlockScroll.ts), so the
    // repaint pass after wrapping re-tags rows that are no longer direct children of the
    // content column. Simulate that by nesting the block's rows one level deep.
    const root = buildContent(4);
    const content = root.querySelector("[data-content]") as HTMLElement;
    const card = document.createElement("div");
    card.setAttribute("data-code-card", "1");
    content.insertBefore(card, content.firstChild);
    for (let n = 1; n <= 3; n++) {
      card.appendChild(root.querySelector(`[data-content] [data-line="${n}"]`) as HTMLElement);
    }
    tagCodeBlockRows(root, [{ start: 1, end: 3 }]);
    // The nested rows are still tagged as a block.
    const nested = (line: number) => {
      const row = root.querySelector(`[data-content] [data-line="${line}"]`);
      return {
        code: row?.hasAttribute("data-code-line") ?? false,
        start: row?.hasAttribute("data-code-start") ?? false,
        end: row?.hasAttribute("data-code-end") ?? false,
      };
    };
    expect(nested(1)).toEqual({ code: true, start: true, end: false });
    expect(nested(2)).toEqual({ code: true, start: false, end: false });
    expect(nested(3)).toEqual({ code: true, start: false, end: true });
  });
});

// Fills a content row with shiki-shaped token spans (one <span> per token, no
// classes — matching how @pierre/diffs renders a highlighted line). Used to
// exercise the token-level tagging that lets the panel CSS nudge individual
// glyphs to the row's vertical center.
function setRowTokens(root: HTMLElement, line: number, tokens: string[]): void {
  const row = root.querySelector(`[data-content] > [data-line="${line}"]`);
  if (row == null) throw new Error(`no row ${line}`);
  for (const t of tokens) {
    const span = document.createElement("span");
    span.textContent = t;
    row.appendChild(span);
  }
}

// The fence line carries two distinct tokens once the theme splits their colors:
// the backtick/tilde markers and, on the opening line, the language tag. shiki
// attaches no classes, so tagCodeBlockRows marks the language token (data-code-lang)
// and BOTH fences' markers (data-code-fence) imperatively. The panel CSS draws the
// marker chip off data-code-fence (EXC-869) and nudges the closing markers and the
// language tag to their row's vertical center (EXC-692).
describe("tagCodeBlockRows token tagging", () => {
  const langOf = (root: HTMLElement, line: number) =>
    root.querySelector(`[data-content] > [data-line="${line}"] [data-code-lang]`);
  const fenceOf = (root: HTMLElement, line: number) =>
    root.querySelector(`[data-content] > [data-line="${line}"] [data-code-fence]`);

  test("tags the opening language token and both fences' markers", () => {
    const root = buildContent(3);
    setRowTokens(root, 1, ["```", "ts"]);
    setRowTokens(root, 2, ["const x = 1;"]);
    setRowTokens(root, 3, ["```"]);
    tagCodeBlockRows(root, [{ start: 1, end: 3 }]);

    expect(langOf(root, 1)?.textContent).toBe("ts");
    // Both delimiters carry the chip hook; the language token is not the fence.
    expect(fenceOf(root, 1)?.textContent).toBe("```");
    expect(fenceOf(root, 3)?.textContent).toBe("```");
    // The code line's own token is never mistaken for a language or fence.
    expect(langOf(root, 2)).toBeNull();
    expect(fenceOf(root, 2)).toBeNull();
  });

  test("tags a tilde fence's language and markers the same way", () => {
    const root = buildContent(3);
    setRowTokens(root, 1, ["~~~", "python"]);
    setRowTokens(root, 2, ["x = 1"]);
    setRowTokens(root, 3, ["~~~"]);
    tagCodeBlockRows(root, [{ start: 1, end: 3 }]);
    expect(langOf(root, 1)?.textContent).toBe("python");
    expect(fenceOf(root, 1)?.textContent).toBe("~~~");
    expect(fenceOf(root, 3)?.textContent).toBe("~~~");
  });

  test("tags a longer fence's delimiters, and leaves an interior fence alone", () => {
    // Only a block's own start/end rows are scanned, so the ``` shown INSIDE a ````
    // block is content and never takes the chip.
    const root = buildContent(3);
    setRowTokens(root, 1, ["````", "md"]);
    setRowTokens(root, 2, ["```"]);
    setRowTokens(root, 3, ["````"]);
    tagCodeBlockRows(root, [{ start: 1, end: 3 }]);
    expect(fenceOf(root, 1)?.textContent).toBe("````");
    expect(fenceOf(root, 2)).toBeNull();
    expect(fenceOf(root, 3)?.textContent).toBe("````");
  });

  test("tags an indented fence's markers", () => {
    const root = buildContent(2);
    setRowTokens(root, 1, ["   ```", "ts"]);
    setRowTokens(root, 2, ["   ```"]);
    tagCodeBlockRows(root, [{ start: 1, end: 2 }]);
    expect(fenceOf(root, 1)?.textContent).toBe("   ```");
    expect(fenceOf(root, 2)?.textContent).toBe("   ```");
  });

  test("tags no markers when shiki merges the fence and its language into one token", () => {
    // The marker span must be markers alone. Were the two ever to tokenize as one
    // (they do not today — caret-theme.ts colors them apart), skipping the chip beats
    // painting it under the language tag, which keeps its own prominent treatment.
    const root = buildContent(2);
    setRowTokens(root, 1, ["```ts"]);
    setRowTokens(root, 2, ["```"]);
    tagCodeBlockRows(root, [{ start: 1, end: 2 }]);
    expect(fenceOf(root, 1)).toBeNull();
    expect(langOf(root, 1)?.textContent).toBe("```ts");
    expect(fenceOf(root, 2)?.textContent).toBe("```");
  });

  test("tags no language when the opening fence has none", () => {
    const root = buildContent(2);
    setRowTokens(root, 1, ["```"]);
    setRowTokens(root, 2, ["```"]);
    tagCodeBlockRows(root, [{ start: 1, end: 2 }]);
    expect(root.querySelector("[data-code-lang]")).toBeNull();
    // A bare opening fence still carries the marker tag, as does the close.
    expect(fenceOf(root, 1)?.textContent).toBe("```");
    expect(fenceOf(root, 2)?.textContent).toBe("```");
  });

  // An unclosed block runs to the last line of the document (codeBlockRanges), so its
  // data-code-end row is prose rather than a fence.
  test("tags no fence markers on an unclosed block's non-fence last row", () => {
    const root = buildContent(2);
    setRowTokens(root, 1, ["```", "ts"]);
    setRowTokens(root, 2, ["const a = ", "`x`", ";"]);
    tagCodeBlockRows(root, [{ start: 1, end: 2 }]);
    expect(fenceOf(root, 1)?.textContent).toBe("```");
    expect(fenceOf(root, 2)).toBeNull();
  });

  test("clears stale token tags when the block goes away", () => {
    const root = buildContent(3);
    setRowTokens(root, 1, ["```", "ts"]);
    setRowTokens(root, 3, ["```"]);
    tagCodeBlockRows(root, [{ start: 1, end: 3 }]);
    expect(root.querySelector("[data-code-lang]")).not.toBeNull();
    expect(root.querySelector("[data-code-fence]")).not.toBeNull();

    tagCodeBlockRows(root, []);
    expect(root.querySelector("[data-code-lang]")).toBeNull();
    expect(root.querySelector("[data-code-fence]")).toBeNull();
  });
});
