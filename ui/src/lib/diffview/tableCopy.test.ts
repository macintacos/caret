import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { CELL_ATTR } from "$lib/diffview/rowTokens.ts";
import { selectionIn, tableSelectionText } from "$lib/diffview/tableCopy.ts";

// A table's cells are grid items, and Chromium's clipboard serializer emits a
// newline at every block box — so copying a table row comes back broken at each
// cell boundary. This module rebuilds the text for exactly that case; everything
// else is left to the browser, which already gets it right.

/** A rendered table row: cells of tokens under a [data-line]. */
function row(line: number, cells: string[][]): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-line", String(line));
  for (const tokens of cells) {
    const cell = document.createElement("span");
    cell.setAttribute(CELL_ATTR, "");
    for (const t of tokens) {
      const span = document.createElement("span");
      span.textContent = t;
      cell.appendChild(span);
    }
    el.appendChild(cell);
  }
  return el;
}

/** An ordinary (non-table) row: tokens directly under [data-line]. */
function prose(line: number, text: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-line", String(line));
  const span = document.createElement("span");
  span.textContent = text;
  el.appendChild(span);
  return el;
}

/** A selection over `container`'s children from `from` to `to` inclusive. */
function selectionOver(container: Node, from: Node, to: Node): Selection {
  document.body.replaceChildren(container as ChildNode);
  const range = document.createRange();
  range.setStartBefore(from);
  range.setEndAfter(to);
  const selection = document.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function card(...rows: HTMLElement[]): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-table-card", "1");
  el.append(...rows);
  return el;
}

describe("tableSelectionText", () => {
  test("joins a row's cells with no break between them", () => {
    const r = row(1, [
      ["| ", "a "],
      ["| ", "b ", "|"],
    ]);
    expect(tableSelectionText(selectionOver(card(r), r, r))).toBe("| a | b |");
  });

  test("keeps one break between table rows", () => {
    const head = row(1, [["| a "], ["| b |"]]);
    const body = row(2, [["| 1 "], ["| 2 |"]]);
    expect(tableSelectionText(selectionOver(card(head, body), head, body))).toBe(
      "| a | b |\n| 1 | 2 |",
    );
  });

  test("breaks between a table row and the prose around it", () => {
    const before = prose(1, "intro");
    const table = row(2, [["| a "], ["| b |"]]);
    const after = prose(3, "outro");
    const wrap = card(before, table, after);
    expect(tableSelectionText(selectionOver(wrap, before, after))).toBe("intro\n| a | b |\noutro");
  });

  test("stands down when the selection touches no table cell", () => {
    // Nothing to repair — the browser's own serialization is already right, and
    // taking it over would risk changing copy everywhere else in the view.
    const a = prose(1, "one");
    const b = prose(2, "two");
    expect(tableSelectionText(selectionOver(card(a, b), a, b))).toBeNull();
  });

  test("stands down inside a single cell, where no break is inserted anyway", () => {
    const r = row(1, [["| ", "abc"]]);
    const token = r.querySelector("span span") as HTMLElement;
    expect(tableSelectionText(selectionOver(card(r), token, token))).toBeNull();
  });

  test("stands down on a collapsed selection", () => {
    const r = row(1, [["| a "], ["| b |"]]);
    document.body.replaceChildren(card(r));
    const selection = document.getSelection() as Selection;
    selection.removeAllRanges();
    expect(tableSelectionText(selection)).toBeNull();
  });

  test("stands down when there is no selection at all", () => {
    expect(tableSelectionText(null)).toBeNull();
  });

  test("keeps each gutter number on its own line", () => {
    // A drag can cross the gutter, and its cells are not [data-line] rows. Without
    // treating them as their own group the numbers would run together.
    const gutterCell = (n: number) => {
      const el = document.createElement("div");
      el.setAttribute("data-column-number", String(n));
      el.textContent = String(n);
      return el;
    };
    const wrap = card(gutterCell(1), gutterCell(2), row(1, [["| a "], ["| b |"]]));
    const [first, , last] = [...wrap.children] as HTMLElement[];
    expect(tableSelectionText(selectionOver(wrap, first as Node, last as Node))).toBe(
      "1\n2\n| a | b |",
    );
  });
});

describe("selectionIn", () => {
  test("falls back to the document's selection when the root has no extension", () => {
    // happy-dom ships no ShadowRoot.getSelection, which is the fallback path — in
    // Chromium the shadow root answers and the document one is never consulted.
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    expect(selectionIn(host.attachShadow({ mode: "open" }))).toBe(document.getSelection());
  });

  test("falls back for a view that has not mounted its shadow root yet", () => {
    expect(selectionIn(null)).toBe(document.getSelection());
  });
});
