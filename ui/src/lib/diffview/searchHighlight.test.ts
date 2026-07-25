import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import {
  clearSearchHighlights,
  paintSearchHighlights,
  rangeForSpan,
} from "$lib/diffview/searchHighlight.ts";

function row(html: string): Element {
  const el = document.createElement("div");
  el.setAttribute("data-line", "1");
  el.innerHTML = html;
  return el;
}

describe("rangeForSpan", () => {
  test("maps columns to a range on a single-token row", () => {
    const el = row("<span>the quick brown fox</span>");
    const range = rangeForSpan(el, 4, 9); // "quick"
    expect(range?.toString()).toBe("quick");
  });

  test("spans a match that crosses two token boundaries", () => {
    // shiki can split a line into several token spans; "abcdef" as "abc"+"def",
    // so matching "cde" must cross the boundary between them.
    const el = row("<span>abc</span><span>def</span>");
    const range = rangeForSpan(el, 2, 5);
    expect(range?.toString()).toBe("cde");
  });

  test("returns null when the span runs past the row text", () => {
    const el = row("<span>short</span>");
    // Boolean form: a failing toBeNull would hang bun serializing the Range.
    expect(rangeForSpan(el, 10, 15) === null).toBe(true);
  });
});

describe("paint/clear degrade without the Custom Highlight API", () => {
  // happy-dom has no CSS.highlights, so both are safe no-ops — the cursor still
  // moves on commit/n/N even when highlights can't paint.
  test("paint is a no-op that does not throw", () => {
    const container = document.createElement("div");
    container.appendChild(row("<span>hello world</span>"));
    expect(() =>
      paintSearchHighlights(container, [{ line: 1, startCol: 0, endCol: 5 }], 0),
    ).not.toThrow();
  });

  test("clear is a no-op that does not throw", () => {
    expect(() => clearSearchHighlights()).not.toThrow();
  });
});
