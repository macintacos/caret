import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { selectionIn, selectionText } from "$lib/diffview/selectionCopy.ts";

// Chromium's clipboard serializer reads the layout tree, so a blank source line —
// a row with no text in it — generates no line box and is dropped from a copied
// selection, fusing the paragraphs on either side of it. This module rebuilds the
// text from the selection's own rows instead, breaking where the row changes.

/** A rendered row: tokens directly under [data-line]. The text node is appended
 * rather than assigned, because a blank line's token holds an EMPTY one — which is
 * what the walk below breaks on, and which `textContent = ""` would not create. */
function row(line: number, ...tokens: string[]): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-line", String(line));
  for (const t of tokens) {
    const span = document.createElement("span");
    span.appendChild(document.createTextNode(t));
    el.appendChild(span);
  }
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

function content(...rows: HTMLElement[]): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-content", "");
  el.append(...rows);
  return el;
}

describe("selectionText", () => {
  test("joins a row's own tokens with no break between them", () => {
    const one = row(1, "a bold ", "**word**", " here");
    expect(selectionText(selectionOver(content(one), one, one))).toBe("a bold **word** here");
  });

  test("breaks between rows, once per row", () => {
    const [one, two] = [row(1, "first"), row(2, "second")];
    const host = content(one, two);
    expect(selectionText(selectionOver(host, one, two))).toBe("first\nsecond");
  });

  // The whole reason this module outlived the tables it was written for: the blank
  // row carries an empty token, which the serializer skips and this walk does not.
  test("keeps the blank line between two paragraphs", () => {
    const [one, blank, two] = [row(1, "first"), row(2, ""), row(3, "second")];
    const host = content(one, blank, two);
    expect(selectionText(selectionOver(host, one, two))).toBe("first\n\nsecond");
  });

  test("breaks between gutter numbers, which are not [data-line] rows", () => {
    const gutter = document.createElement("div");
    for (const n of ["1", "2"]) {
      const cell = document.createElement("div");
      cell.setAttribute("data-column-number", n);
      cell.textContent = n;
      gutter.appendChild(cell);
    }
    const [first, second] = [...gutter.children] as HTMLElement[];
    expect(selectionText(selectionOver(gutter, first as Node, second as Node))).toBe("1\n2");
  });

  test("stands down for a collapsed or absent selection", () => {
    expect(selectionText(null)).toBeNull();
    const one = row(1, "x");
    const selection = selectionOver(content(one), one, one);
    selection.collapseToStart();
    expect(selectionText(selection)).toBeNull();
  });
});

describe("selectionIn", () => {
  test("prefers the shadow root's own selection over the document's", () => {
    const own = { rangeCount: 0 } as unknown as Selection;
    const root = { getSelection: () => own } as unknown as ShadowRoot;
    expect(selectionIn(root)).toBe(own);
  });

  test("falls back to the document's where the root has none", () => {
    expect(selectionIn(null)).toBe(document.getSelection());
    expect(selectionIn({} as ShadowRoot)).toBe(document.getSelection());
  });
});
