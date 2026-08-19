import "@ui/test-setup.ts";
import { expect, test } from "bun:test";

import { paintCardSelection } from "$lib/diffview/cardSelection.ts";
import { CARD_ATTR, GUTTER_CARD_ATTR } from "$lib/diffview/codeBlockScroll.ts";
import { TABLE_CARD_ATTR, TABLE_GUTTER_CARD_ATTR } from "$lib/diffview/tables.ts";

// paintCardSelection re-applies the library's own [data-selected-line] marks to the
// rows a card hides from it. @pierre/diffs' renderSelection walks [data-content]'s
// DIRECT children and skips anything with no line index, so a card is skipped whole and every row inside it goes unbanded (EXC-865). What is asserted
// here is the attribute vocabulary and the write discipline; that the band then
// PAINTS is layout, and lives in test/e2e/diff-surface.e2e.ts.

/** The library's grid for `total` lines, with `carded` (1-based, inclusive) moved into
 * a card and mirrored into the gutter — the shape codeBlockScroll.ts leaves behind,
 * or tables.ts's when `kind` names the table pair. */
function build(
  total: number,
  carded: { start: number; end: number },
  kind: [content: string, gutter: string] = [CARD_ATTR, GUTTER_CARD_ATTR],
): HTMLElement {
  const root = document.createElement("div");
  const gutter = document.createElement("div");
  gutter.setAttribute("data-gutter", "");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  const card = document.createElement("div");
  card.setAttribute(kind[0], String(carded.start));
  const mirror = document.createElement("div");
  mirror.setAttribute(kind[1], String(carded.start));
  for (let line = 1; line <= total; line++) {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(line));
    const cell = document.createElement("div");
    cell.setAttribute("data-column-number", String(line));
    const inCard = line >= carded.start && line <= carded.end;
    (inCard ? card : content).appendChild(row);
    (inCard ? mirror : gutter).appendChild(cell);
    if (line === carded.start) {
      content.appendChild(card);
      gutter.appendChild(mirror);
    }
  }
  root.append(gutter, content);
  return root;
}

/** Adds the library's annotation row for `line` and its gutter buffer, immediately
 * after that line's own cell in each column — wherever those now sit. */
function openComment(root: HTMLElement, line: number): void {
  const row = root.querySelector(`[data-content] [data-line="${line}"]`);
  const annotation = document.createElement("div");
  annotation.setAttribute("data-line-annotation", `0,${line}`);
  row?.parentElement?.insertBefore(annotation, row.nextSibling);
  const number = root.querySelector(`[data-gutter] [data-column-number="${line}"]`);
  const buffer = document.createElement("div");
  buffer.setAttribute("data-gutter-buffer", "annotation");
  number?.parentElement?.insertBefore(buffer, number.nextSibling);
}

/** Every selected element, as `<key>=<value>`, in document order. */
function selected(root: HTMLElement): string[] {
  return [...root.querySelectorAll("[data-selected-line]")].map((el) => {
    const key =
      el.getAttribute("data-line") ??
      el.getAttribute("data-column-number") ??
      (el.hasAttribute("data-line-annotation") ? "anno" : "buffer");
    return `${key}=${el.getAttribute("data-selected-line")}`;
  });
}

test("bands every carded row of a range that lies wholly inside a card", () => {
  const root = build(8, { start: 3, end: 7 });
  paintCardSelection(root, { start: 4, end: 6 });
  expect(selected(root)).toEqual(["4=first", "5=", "6=last", "4=first", "5=", "6=last"]);
});

test("bands a table's card too — a card is a card whatever wrapped it", () => {
  // tables.ts cards a table unconditionally, so its rows are hidden from
  // renderSelection exactly as an overflowing fenced block's are.
  const root = build(8, { start: 3, end: 7 }, [TABLE_CARD_ATTR, TABLE_GUTTER_CARD_ATTR]);
  paintCardSelection(root, { start: 4, end: 6 });
  expect(selected(root)).toEqual(["4=first", "5=", "6=last", "4=first", "5=", "6=last"]);
});

test("bands a single carded row as the whole band", () => {
  const root = build(8, { start: 3, end: 7 });
  paintCardSelection(root, { start: 5, end: 5 });
  expect(selected(root)).toEqual(["5=single", "5=single"]);
});

test("bands only the carded part of a range that starts outside the card", () => {
  // The library already banded lines 1-2 itself; this pass owns the card's share and
  // must not claim the range's first row, which is not in the card.
  const root = build(8, { start: 3, end: 7 });
  paintCardSelection(root, { start: 1, end: 4 });
  expect(selected(root)).toEqual(["3=", "4=last", "3=", "4=last"]);
});

test("bands only the carded part of a range that ends outside the card", () => {
  const root = build(8, { start: 3, end: 7 });
  paintCardSelection(root, { start: 6, end: 8 });
  expect(selected(root)).toEqual(["6=first", "7=", "6=first", "7="]);
});

test("clears a carded row the range no longer covers", () => {
  const root = build(8, { start: 3, end: 7 });
  paintCardSelection(root, { start: 4, end: 6 });
  paintCardSelection(root, { start: 5, end: 5 });
  expect(selected(root)).toEqual(["5=single", "5=single"]);
});

test("clears every carded row on a null range", () => {
  const root = build(8, { start: 3, end: 7 });
  paintCardSelection(root, { start: 4, end: 6 });
  paintCardSelection(root, null);
  expect(selected(root)).toEqual([]);
});

test("hands the band's trailing end to an open comment's own row", () => {
  // The library's own adjustment (InteractionManager.renderSelection): the annotation
  // row that follows a banded row takes the trailing marker so the band's rounded end
  // lands on the card rather than mid-thread. Mirrored here because the annotation row
  // now sits inside the card too — including the asymmetry, where only the CONTENT row
  // is demoted to "first" and its gutter cell keeps "single".
  const root = build(8, { start: 3, end: 7 });
  openComment(root, 5);
  paintCardSelection(root, { start: 5, end: 5 });
  // Gutter first: build() appends that column ahead of the content one.
  expect(selected(root)).toEqual(["5=single", "buffer=last", "5=first", "anno=last"]);
});

test("writes nothing when the marks are already right", () => {
  const root = build(8, { start: 3, end: 7 });
  paintCardSelection(root, { start: 4, end: 6 });
  let writes = 0;
  const observer = new MutationObserver((records) => {
    writes += records.length;
  });
  observer.observe(root, { attributes: true, subtree: true });
  paintCardSelection(root, { start: 4, end: 6 });
  // The pass is its own observer's trigger, so a settled repaint that still wrote the
  // same value would re-fire it forever.
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      observer.disconnect();
      expect(writes).toBe(0);
      resolve();
    }, 0);
  });
});

test("leaves a card whose mirror has diverged completely alone", () => {
  // A divergence is the state the library throws on; this pass must not paint into it
  // and make the two columns disagree about which rows are banded.
  const root = build(8, { start: 3, end: 7 });
  root.querySelector(`[${GUTTER_CARD_ATTR}]`)?.lastElementChild?.remove();
  paintCardSelection(root, { start: 4, end: 6 });
  expect(selected(root)).toEqual([]);
});
