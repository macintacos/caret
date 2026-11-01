import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { openComment } from "@ui/support/diffview-dom.ts";
import {
  applyCodeBlockReflow,
  CARD_ATTR,
  GUTTER_CARD_ATTR,
  markScrollingCards,
  REFLOW_ATTR,
  SCROLLS_ATTR,
  syncCodeBlockCards,
} from "$lib/diffview/codeBlockScroll.ts";
import type { CodeBlockRange } from "$lib/diffview/codeBlocks.ts";

// syncCodeBlockCards wraps every fenced block's rows in ONE per-block card. This suite pins
// the wrap / keep / retire decisions, the gutter mirror that balances them, and the comment
// row the card carries with its rows (EXC-1228).

interface RowSpec {
  code?: boolean;
  start?: boolean;
  end?: boolean;
}

/** Appends one [data-line] row for `spec` at `line`. */
function appendRow(content: HTMLElement, spec: RowSpec, line: string): void {
  const row = document.createElement("div");
  row.setAttribute("data-line", line);
  if (spec.code) row.setAttribute("data-code-line", "");
  if (spec.start) row.setAttribute("data-code-start", "");
  if (spec.end) row.setAttribute("data-code-end", "");
  content.appendChild(row);
}

function buildContent(specs: RowSpec[]): { root: HTMLElement; content: HTMLElement } {
  const root = document.createElement("div");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  specs.forEach((spec, i) => {
    appendRow(content, spec, String(i + 1));
  });
  root.appendChild(content);
  return { root, content };
}

const cardsIn = (content: HTMLElement) =>
  [...content.querySelectorAll(`:scope > [${CARD_ATTR}]`)] as HTMLElement[];
const directRows = (content: HTMLElement) =>
  [...content.querySelectorAll(":scope > [data-line]")] as HTMLElement[];
const linesInCard = (card: HTMLElement) =>
  [...card.querySelectorAll(":scope > [data-line]")].map((r) => r.getAttribute("data-line"));

// A three-line block (lines 1-3).
const block: RowSpec[] = [{ code: true, start: true }, { code: true }, { code: true, end: true }];
const blockRange: CodeBlockRange = { start: 1, end: 3 };

// Two blocks (1-2 and 4-5) either side of a prose line at 3, addressed together —
// shared by the tests below that sync both ranges in one pass.
const TWO_BLOCK_RANGES: CodeBlockRange[] = [
  { start: 1, end: 2 },
  { start: 4, end: 5 },
];
const TWO_BLOCKS: RowSpec[] = [
  { code: true, start: true },
  { code: true, end: true },
  {},
  { code: true, start: true },
  { code: true, end: true },
];

/** Asserts the content column carries no card and its rows are `lines`, in
 * order — the shared postcondition for a retired block. */
function expectContentUnwrapped(content: HTMLElement, lines: string[]): void {
  expect(cardsIn(content)).toHaveLength(0);
  expect(directRows(content).map((r) => r.getAttribute("data-line"))).toEqual(lines);
}

describe("syncCodeBlockCards", () => {
  test("wraps a block's rows in one card keyed by its start line", () => {
    const { root, content } = buildContent(block);
    syncCodeBlockCards(root, [blockRange]);

    const cards = cardsIn(content);
    expect(cards).toHaveLength(1);
    const card = cards[0] as HTMLElement;
    expect(card.getAttribute(CARD_ATTR)).toBe("1");
    // All three rows moved into the card, in document order.
    expect(linesInCard(card)).toEqual(["1", "2", "3"]);
    // ...and none are left as direct children of the content column.
    expect(directRows(content)).toHaveLength(0);
  });

  test("spans the card across the block's rows so subgrid keeps the gutter aligned", () => {
    const { root, content } = buildContent(block);
    syncCodeBlockCards(root, [blockRange]);
    const card = cardsIn(content)[0] as HTMLElement;
    expect(card.style.gridRow).toBe("span 3");
  });

  test("inserts the card at the block's position, preserving surrounding order", () => {
    // prose(1), block(2-4), prose(5)
    const { root, content } = buildContent([
      {},
      { code: true, start: true },
      { code: true },
      { code: true, end: true },
      {},
    ]);
    syncCodeBlockCards(root, [{ start: 2, end: 4 }]);
    const kids = [...content.children];
    // prose 1, then the card, then prose 5.
    expect(kids[0]?.getAttribute("data-line")).toBe("1");
    expect(kids[1]?.hasAttribute(CARD_ATTR)).toBe(true);
    expect(kids[2]?.getAttribute("data-line")).toBe("5");
  });

  test("gives each block its own card, and leaves the prose between them loose", () => {
    const { root, content } = buildContent(TWO_BLOCKS);
    syncCodeBlockCards(root, TWO_BLOCK_RANGES);
    const cards = cardsIn(content);
    expect(cards.map((c) => c.getAttribute(CARD_ATTR))).toEqual(["1", "4"]);
    expect(directRows(content).map((r) => r.getAttribute("data-line"))).toEqual(["3"]);
  });

  test("is idempotent — re-running reuses the card and mutates nothing", () => {
    const { root, content } = buildContent(block);
    syncCodeBlockCards(root, [blockRange]);
    const first = cardsIn(content)[0];
    syncCodeBlockCards(root, [blockRange]);
    const cards = cardsIn(content);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toBe(first); // same element reused, not re-created
    expect(linesInCard(cards[0] as HTMLElement)).toEqual(["1", "2", "3"]);
  });

  test("retires a card whose block no longer exists", () => {
    const { root, content } = buildContent(block);
    syncCodeBlockCards(root, [blockRange]);
    expect(cardsIn(content)).toHaveLength(1);
    // Re-run with no ranges (content replaced with prose) → orphaned card unwrapped.
    syncCodeBlockCards(root, []);
    expectContentUnwrapped(content, ["1", "2", "3"]);
  });
});

// EXC-744 follow-up: @pierre/diffs' selection walk (InteractionManager.renderSelection) pairs
// the gutter and content columns by direct-child index and throws when their child counts
// differ. A content card collapses a block's N rows into ONE child, so without a matching
// gutter card the counts diverge and the library throws — killing the drag-selection highlight
// for the WHOLE view whenever any block is carded. So each content card gets a parallel,
// display:contents gutter card wrapping the block's line-number cells: purely structural (the
// cells still map to the shared subgrid row tracks), it only rebalances the columns. These
// tests build BOTH columns; the earlier suite builds content only, exercising the wrap logic
// in isolation (the mirror is skipped when there is no gutter).
function buildColumns(specs: RowSpec[]): {
  root: HTMLElement;
  gutter: HTMLElement;
  content: HTMLElement;
} {
  const root = document.createElement("div");
  const code = document.createElement("div");
  const gutter = document.createElement("div");
  gutter.setAttribute("data-gutter", "");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  specs.forEach((spec, i) => {
    const n = String(i + 1);
    const cell = document.createElement("div");
    cell.setAttribute("data-column-number", n);
    gutter.appendChild(cell);
    appendRow(content, spec, n);
  });
  code.append(gutter, content);
  root.appendChild(code);
  return { root, gutter, content };
}

describe("syncCodeBlockCards — gutter mirror (keeps the library's selection walk balanced)", () => {
  const gutterCardsIn = (gutter: HTMLElement) =>
    [...gutter.querySelectorAll(`:scope > [${GUTTER_CARD_ATTR}]`)] as HTMLElement[];
  const cellsInGutterCard = (card: HTMLElement) =>
    [...card.querySelectorAll(":scope > [data-column-number]")].map((c) =>
      c.getAttribute("data-column-number"),
    );
  const gutterCells = (gutter: HTMLElement) =>
    [...gutter.querySelectorAll(":scope > [data-column-number]")].map((c) =>
      c.getAttribute("data-column-number"),
    );

  /** Asserts the gutter carries no card, its cells are `lines` in order, and the
   * two columns still balance — the shared postcondition for a retired block. */
  function expectGutterUnwrapped(gutter: HTMLElement, content: HTMLElement, lines: string[]): void {
    expect(gutterCardsIn(gutter)).toHaveLength(0);
    expect(gutterCells(gutter)).toEqual(lines);
    expect(gutter.children.length).toBe(content.children.length);
  }

  test("wraps the block's gutter cells in a parallel display:contents card, restoring parity", () => {
    const { root, gutter, content } = buildColumns(block);
    syncCodeBlockCards(root, [blockRange]);

    const gcards = gutterCardsIn(gutter);
    expect(gcards).toHaveLength(1);
    const gcard = gcards[0] as HTMLElement;
    expect(gcard.getAttribute(GUTTER_CARD_ATTR)).toBe("1"); // keyed like its content card
    expect(gcard.style.display).toBe("contents"); // structural only, never a scroll box
    expect(cellsInGutterCard(gcard)).toEqual(["1", "2", "3"]);
    // The library asserts gutter.children.length === content.children.length.
    expect(gutter.children.length).toBe(content.children.length);
  });

  test("mirrors each block, leaving the prose cell between them loose", () => {
    const { root, gutter, content } = buildColumns(TWO_BLOCKS);
    syncCodeBlockCards(root, TWO_BLOCK_RANGES);
    expect(gutterCardsIn(gutter).map((c) => c.getAttribute(GUTTER_CARD_ATTR))).toEqual(["1", "4"]);
    expect(gutterCells(gutter)).toEqual(["3"]);
    expect(gutter.children.length).toBe(content.children.length);
  });

  test("is idempotent — a re-run reuses the gutter card, mutating nothing", () => {
    const { root, gutter } = buildColumns(block);
    syncCodeBlockCards(root, [blockRange]);
    const first = gutterCardsIn(gutter)[0];
    syncCodeBlockCards(root, [blockRange]);
    const gcards = gutterCardsIn(gutter);
    expect(gcards).toHaveLength(1);
    expect(gcards[0]).toBe(first);
    expect(cellsInGutterCard(gcards[0] as HTMLElement)).toEqual(["1", "2", "3"]);
  });

  test("retires the gutter card when the block no longer exists", () => {
    const { root, gutter, content } = buildColumns(block);
    syncCodeBlockCards(root, [blockRange]);
    expect(gutterCardsIn(gutter)).toHaveLength(1);
    syncCodeBlockCards(root, []);
    expectGutterUnwrapped(gutter, content, ["1", "2", "3"]);
  });
});

// EXC-1228: the library emits a comment's annotation row as a sibling of the row it is
// anchored to, carrying no data-line — so gathering a block's rows by data-line alone left
// that row behind, and a comment inside a carded block rendered below the whole block. The card takes the contiguous RUN of its column's children instead,
// the way tables.ts already did, so the comment rides inside the card at its anchor.
describe("syncCodeBlockCards — an open comment inside a carded block", () => {
  /** A column's children as their keying attribute, or `annotation` for the rows the
   * library interleaves — the shape both columns must agree on. */
  const slotOrder = (parent: Element | null | undefined, attr: string): string[] =>
    [...(parent?.children ?? [])].map((el) => el.getAttribute(attr) ?? "annotation");

  const contentCard = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(`[data-content] > [${CARD_ATTR}="1"]`);

  test("carries a mid-block comment's row into the card, in place", () => {
    const { root } = buildColumns(block);
    // A repaint rebuilds the column flat and re-emits the annotation row, so the pass
    // always meets this case unwrapped.
    openComment(root, 2);
    syncCodeBlockCards(root, [blockRange]);
    expect(slotOrder(contentCard(root), "data-line")).toEqual(["1", "2", "annotation", "3"]);
    expect(root.querySelector("[data-content] > [data-line-annotation]")).toBeNull();
  });

  test("carries the comment's gutter buffer into the mirror at the same index", () => {
    const { root } = buildColumns(block);
    openComment(root, 2);
    syncCodeBlockCards(root, [blockRange]);
    const mirror = root.querySelector(`[${GUTTER_CARD_ATTR}="1"]`);
    expect(slotOrder(mirror, "data-column-number")).toEqual(["1", "2", "annotation", "3"]);
  });

  test("carries a comment on the block's LAST line into the card too", () => {
    // For a fenced block the last line is the closing fence, which a reviewer can comment on
    // like any other. Left outside, it would land in the right place but at the uncarded
    // width, so two comments on one block would not match.
    const { root } = buildColumns(block);
    openComment(root, 3);
    syncCodeBlockCards(root, [blockRange]);
    expect(slotOrder(contentCard(root), "data-line")).toEqual(["1", "2", "3", "annotation"]);
    const mirror = root.querySelector(`[${GUTTER_CARD_ATTR}="1"]`);
    expect(slotOrder(mirror, "data-column-number")).toEqual(["1", "2", "3", "annotation"]);
  });

  test("keeps the two columns matching with a comment open", () => {
    const { root, gutter, content } = buildColumns(block);
    openComment(root, 2);
    syncCodeBlockCards(root, [blockRange]);
    expect(gutter.children.length).toBe(content.children.length);
  });

  test("spans the card across every child it took, not just the block's lines", () => {
    // grid-row is what maps the card's children onto the parent's row tracks, so a span
    // short by one drops the extra child into an implicit track and walks the gutter out
    // of alignment.
    const { root } = buildColumns(block);
    openComment(root, 2);
    syncCodeBlockCards(root, [blockRange]);
    expect(contentCard(root)?.style.gridRow).toBe("span 4");
  });

  test("returns a carded comment's row to its column when the block is retired", () => {
    const { root, content } = buildColumns(block);
    openComment(root, 2);
    syncCodeBlockCards(root, [blockRange]);
    syncCodeBlockCards(root, []);
    expect(slotOrder(content, "data-line")).toEqual(["1", "2", "annotation", "3"]);
  });

  test("mutates nothing on a settled pass with a comment open", () => {
    const { root } = buildColumns(block);
    openComment(root, 2);
    syncCodeBlockCards(root, [blockRange]);
    const settled = root.innerHTML;
    syncCodeBlockCards(root, [blockRange]);
    expect(root.innerHTML).toBe(settled);
  });
});

// EXC-1386: the reviewer soft-wraps ONE block by marking its content card and
// gutter mirror with REFLOW_ATTR; this pass re-marks a card the frame a repaint rebuilds it.
describe("applyCodeBlockReflow", () => {
  const contentCardFor = (root: HTMLElement, key: string) =>
    root.querySelector<HTMLElement>(`[data-content] > [${CARD_ATTR}="${key}"]`);
  const gutterCardFor = (root: HTMLElement, key: string) =>
    root.querySelector<HTMLElement>(`[data-gutter] > [${GUTTER_CARD_ATTR}="${key}"]`);

  /** A carded block (1-3) in both columns, ready to be reflowed. */
  function rootWithCardedBlock(): HTMLElement {
    const { root } = buildColumns(block);
    syncCodeBlockCards(root, [blockRange]);
    return root;
  }

  test("marks both the content card and its gutter mirror", () => {
    const root = rootWithCardedBlock();
    applyCodeBlockReflow(root, new Set([1]));
    expect(contentCardFor(root, "1")?.hasAttribute(REFLOW_ATTR)).toBe(true);
    expect(gutterCardFor(root, "1")?.hasAttribute(REFLOW_ATTR)).toBe(true);
  });

  test("clears the mark from both when the block leaves the set", () => {
    const root = rootWithCardedBlock();
    applyCodeBlockReflow(root, new Set([1]));
    applyCodeBlockReflow(root, new Set());
    expect(contentCardFor(root, "1")?.hasAttribute(REFLOW_ATTR)).toBe(false);
    expect(gutterCardFor(root, "1")?.hasAttribute(REFLOW_ATTR)).toBe(false);
  });

  test("marks only the blocks in the set", () => {
    const { root } = buildColumns(TWO_BLOCKS);
    syncCodeBlockCards(root, TWO_BLOCK_RANGES);
    applyCodeBlockReflow(root, new Set([4]));
    expect(contentCardFor(root, "1")?.hasAttribute(REFLOW_ATTR)).toBe(false);
    expect(contentCardFor(root, "4")?.hasAttribute(REFLOW_ATTR)).toBe(true);
  });

  test("mutates nothing on a settled re-run", () => {
    const root = rootWithCardedBlock();
    applyCodeBlockReflow(root, new Set([1]));
    const settled = root.innerHTML;
    applyCodeBlockReflow(root, new Set([1]));
    expect(root.innerHTML).toBe(settled);
  });

  test("re-marks a card the repaint rebuilt, since the mark rides the same pass", () => {
    // A repaint returns the rows to the column flat; syncCodeBlockCards re-cards them and
    // this pass, running right after it, puts the mark back on the fresh card.
    const { root } = buildColumns(block);
    syncCodeBlockCards(root, [blockRange]);
    applyCodeBlockReflow(root, new Set([1]));
    const staleCard = contentCardFor(root, "1");
    syncCodeBlockCards(root, []); // repaint retires the card
    syncCodeBlockCards(root, [blockRange]); // ...and rebuilds it
    applyCodeBlockReflow(root, new Set([1]));
    const rebuiltCard = contentCardFor(root, "1");
    expect(rebuiltCard).not.toBe(staleCard);
    expect(rebuiltCard?.hasAttribute(REFLOW_ATTR)).toBe(true);
  });
});

// A card whose code is wider than it is marked, with its gutter mirror, so the sheet can clear
// the scrollbar's lane beside the card's last row (coreStyles.ts).
describe("markScrollingCards", () => {
  function stubWidths(el: Element, scrollWidth: number, clientWidth: number): void {
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  }

  /** Two carded blocks in both columns, with their content cards and gutter mirrors. */
  function twoCards() {
    const { root, content, gutter } = buildColumns(TWO_BLOCKS);
    syncCodeBlockCards(root, TWO_BLOCK_RANGES);
    const [first, second] = cardsIn(content) as [HTMLElement, HTMLElement];
    const mirrors = [...gutter.querySelectorAll(`:scope > [${GUTTER_CARD_ATTR}]`)];
    return { root, first, second, mirrors };
  }

  test("marks a card whose code is wider than it, and its gutter mirror, and only those", () => {
    const { root, first, second, mirrors } = twoCards();
    stubWidths(first, 900, 300);
    stubWidths(second, 300, 300);
    markScrollingCards(root);
    expect([first, second].map((c) => c.hasAttribute(SCROLLS_ATTR))).toEqual([true, false]);
    expect(mirrors.map((c) => c.hasAttribute(SCROLLS_ATTR))).toEqual([true, false]);
  });

  test("clears the mark from both once the code fits", () => {
    const { root, first, mirrors } = twoCards();
    stubWidths(first, 900, 300);
    markScrollingCards(root);
    stubWidths(first, 300, 300);
    markScrollingCards(root);
    expect(first.hasAttribute(SCROLLS_ATTR)).toBe(false);
    expect(mirrors[0]?.hasAttribute(SCROLLS_ATTR)).toBe(false);
  });
});
