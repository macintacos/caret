import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { CELL_ATTR, splitTokens, tokenChildren } from "$lib/diffview/rowTokens.ts";

// Every pass that decorates a rendered row locates a token by walking the row's
// tokens in column order and accumulating text length. A table row (EXC-864) puts
// its tokens inside cell elements, so "the row's tokens" is no longer "the row's
// children" — these two helpers are what keep that one level of nesting invisible
// to inlineDecorate.ts, fileRefTag.ts and tables.ts alike.

/** A row of `<span>` tokens whose text concatenates to `parts.join("")`. */
function row(...parts: string[]): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-line", "1");
  for (const part of parts) {
    const span = document.createElement("span");
    span.textContent = part;
    el.appendChild(span);
  }
  return el;
}

/** The same tokens, grouped into cells at the given part boundaries. */
function celledRow(...cells: string[][]): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-line", "1");
  for (const parts of cells) {
    const cell = document.createElement("span");
    cell.setAttribute(CELL_ATTR, "");
    for (const part of parts) {
      const span = document.createElement("span");
      span.textContent = part;
      cell.appendChild(span);
    }
    el.appendChild(cell);
  }
  return el;
}

const texts = (els: Element[]): string[] => els.map((el) => el.textContent ?? "");

describe("tokenChildren", () => {
  test("returns a plain row's own children", () => {
    expect(texts(tokenChildren(row("ab", "cd")))).toEqual(["ab", "cd"]);
  });

  test("returns a celled row's tokens flattened in column order", () => {
    expect(texts(tokenChildren(celledRow(["| ", "a"], ["| ", "b", " |"])))).toEqual([
      "| ",
      "a",
      "| ",
      "b",
      " |",
    ]);
  });

  test("concatenates back to the line's text, which is what the walks index", () => {
    const celled = celledRow(["| ", "a "], ["| ", "b ", "|"]);
    expect(texts(tokenChildren(celled)).join("")).toBe(celled.textContent);
  });

  test("returns nothing for an empty row", () => {
    expect(tokenChildren(row())).toEqual([]);
  });
});

describe("splitTokens", () => {
  test("splits a token that a cut falls strictly inside", () => {
    const el = row("abcd");
    splitTokens(el, [2]);
    expect(texts(tokenChildren(el))).toEqual(["ab", "cd"]);
  });

  test("splits a token at several interior cuts at once", () => {
    const el = row("abcdef");
    splitTokens(el, [2, 4]);
    expect(texts(tokenChildren(el))).toEqual(["ab", "cd", "ef"]);
  });

  test("leaves a token alone when a cut lands on its edge", () => {
    const el = row("ab", "cd");
    const before = [...tokenChildren(el)];
    splitTokens(el, [0, 2, 4]);
    // Same nodes, not replacements: an already-correct row must mutate nothing, or
    // SourceView's MutationObserver would re-fire on every pass forever.
    expect(tokenChildren(el)).toEqual(before);
  });

  test("splits inside a cell without disturbing the cells themselves", () => {
    const el = celledRow(["| ", "abcd"], ["| b |"]);
    splitTokens(el, [4]);
    expect(texts(tokenChildren(el))).toEqual(["| ", "ab", "cd", "| b |"]);
    expect(el.children).toHaveLength(2);
  });

  test("carries the split token's attributes onto every piece", () => {
    const el = row("abcd");
    el.children[0]?.setAttribute("style", "color:red");
    splitTokens(el, [2]);
    for (const piece of tokenChildren(el)) {
      expect(piece.getAttribute("style")).toBe("color:red");
    }
  });

  test("renumbers data-char so each piece reports its own start column", () => {
    // data-char is POSITIONAL: the library reads a token's range back as
    // [data-char, data-char + text.length). Carried over verbatim, every piece
    // would claim the undivided token's start — so a piece past the first
    // reports the right width in the wrong place, and a span sitting there is
    // never resolved (EXC-1192: a mid-sentence reference decorated but not
    // clickable).
    const el = row("abcdef");
    el.children[0]?.setAttribute("data-char", "0");
    splitTokens(el, [2, 4]);
    expect(tokenChildren(el).map((piece) => piece.getAttribute("data-char"))).toEqual([
      "0",
      "2",
      "4",
    ]);
  });

  test("renumbers data-char from the token's own start, not the row's", () => {
    // The second token starts at column 3, so its interior cut is at 5 — the
    // numbering is absolute across the row, which is the coordinate the span
    // columns are in.
    const el = row("abc", "defg");
    el.children[1]?.setAttribute("data-char", "3");
    splitTokens(el, [5]);
    expect(tokenChildren(el).map((piece) => piece.getAttribute("data-char"))).toEqual([
      null,
      "3",
      "5",
    ]);
  });

  test("adds no data-char to a token that never carried one", () => {
    const el = row("abcd");
    splitTokens(el, [2]);
    for (const piece of tokenChildren(el)) {
      expect(piece.hasAttribute("data-char")).toBe(false);
    }
  });

  test("skips a token holding elements of its own", () => {
    const el = document.createElement("div");
    const outer = document.createElement("span");
    outer.innerHTML = "<b>abcd</b>";
    el.appendChild(outer);
    splitTokens(el, [2]);
    expect(el.children).toHaveLength(1);
  });
});
