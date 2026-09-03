import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import {
  CARD_ATTR,
  GUTTER_CARD_ATTR,
  type MetricsReader,
  type RowMetrics,
  syncCodeBlockCards,
} from "$lib/diffview/codeBlockScroll.ts";
import type { CodeBlockRange } from "$lib/diffview/codeBlocks.ts";

// EXC-729: a fenced code block renders as independent [data-line] rows (no wrapper), and
// EXC-692 caps each at a reading width, so an over-wide line broke out of the panel. The fix
// wraps an overflowing block's rows in ONE per-block card that is a single native horizontal
// scroll container (subgrid rows keep the gutter aligned): the whole block scrolls as one
// unit with one scrollbar, so short lines scroll too and there is no per-row jelly. This
// module does the wrapping; the card styling and scrollbar live in coreStyles.ts. A block
// that fits is left as plain direct-child rows (EXC-692 styles those). Overflow is measured
// through an injectable reader because happy-dom reports 0 for every layout metric — without
// it every block would read as fitting and nothing would ever wrap.

interface RowSpec {
  code?: boolean;
  start?: boolean;
  end?: boolean;
  /** Fake layout metrics for this row (defaults to a fits-the-card 100x100 row). */
  metrics?: Partial<RowMetrics>;
}

/** Appends one [data-line] row for `spec` at `line`, recording its fake metrics. */
function appendRow(
  content: HTMLElement,
  spec: RowSpec,
  line: string,
  rowMetrics: Map<Element, RowMetrics>,
): void {
  const row = document.createElement("div");
  row.setAttribute("data-line", line);
  if (spec.code) row.setAttribute("data-code-line", "");
  if (spec.start) row.setAttribute("data-code-start", "");
  if (spec.end) row.setAttribute("data-code-end", "");
  content.appendChild(row);
  rowMetrics.set(row, { scrollWidth: 100, clientWidth: 100, ...spec.metrics });
}

function buildContent(specs: RowSpec[]): {
  root: HTMLElement;
  content: HTMLElement;
  rowMetrics: Map<Element, RowMetrics>;
} {
  const root = document.createElement("div");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  const rowMetrics = new Map<Element, RowMetrics>();
  specs.forEach((spec, i) => {
    appendRow(content, spec, String(i + 1), rowMetrics);
  });
  root.appendChild(content);
  return { root, content, rowMetrics };
}

// A reader keyed so tests can control both a row's metrics (does it overflow its capped box?)
// and a card's metrics (does the wrapped block still overflow?). A card is created by the
// module, so it is keyed by its CARD_ATTR value — the block's start line, which tests know.
function makeReader(
  rowMetrics: Map<Element, RowMetrics>,
  cardMetrics: Record<string, RowMetrics> = {},
): MetricsReader {
  return (el) => {
    if (el.hasAttribute(CARD_ATTR)) {
      return cardMetrics[el.getAttribute(CARD_ATTR) ?? ""] ?? { scrollWidth: 0, clientWidth: 0 };
    }
    return rowMetrics.get(el) ?? { scrollWidth: 0, clientWidth: 0 };
  };
}

const cardsIn = (content: HTMLElement) =>
  [...content.querySelectorAll(`:scope > [${CARD_ATTR}]`)] as HTMLElement[];
const directRows = (content: HTMLElement) =>
  [...content.querySelectorAll(":scope > [data-line]")] as HTMLElement[];
const linesInCard = (card: HTMLElement) =>
  [...card.querySelectorAll(":scope > [data-line]")].map((r) => r.getAttribute("data-line"));

// A block (lines 1-3) whose widest line overflows the capped card: the middle line's
// scrollWidth 800 exceeds its clientWidth 300; the fences fit.
const overflowingBlock: RowSpec[] = [
  { code: true, start: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
  { code: true, metrics: { clientWidth: 300, scrollWidth: 800 } },
  { code: true, end: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
];
const overflowingRange: CodeBlockRange = { start: 1, end: 3 };
// A card that reports overflow, for re-runs on an already-wrapped block.
const cardOverflows = { "1": { scrollWidth: 800, clientWidth: 300 } };

// Two blocks (1-2 and 4-5) either side of a prose line at 3, addressed together —
// shared by the tests below that sync both ranges in one pass.
const TWO_BLOCK_RANGES: CodeBlockRange[] = [
  { start: 1, end: 2 },
  { start: 4, end: 5 },
];

// A fitting block (1-2), prose (3), then an overflowing block (4-5) — shared by
// the content-only and gutter-mirror suites, which assert the same wrap decision
// through their own column.
const FITTING_THEN_OVERFLOWING_BLOCK: RowSpec[] = [
  { code: true, start: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
  { code: true, end: true, metrics: { clientWidth: 300, scrollWidth: 280 } },
  {},
  { code: true, start: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
  { code: true, end: true, metrics: { clientWidth: 300, scrollWidth: 900 } },
];

/** Asserts the content column carries no card and its rows are `lines`, in
 * order — the shared postcondition for a block that unwrapped or never carded. */
function expectContentUnwrapped(content: HTMLElement, lines: string[]): void {
  expect(cardsIn(content)).toHaveLength(0);
  expect(directRows(content).map((r) => r.getAttribute("data-line"))).toEqual(lines);
}

describe("syncCodeBlockCards", () => {
  test("wraps an overflowing block's rows in one card keyed by its start line", () => {
    const { root, content, rowMetrics } = buildContent(overflowingBlock);
    syncCodeBlockCards(root, [overflowingRange], makeReader(rowMetrics));

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
    const { root, content, rowMetrics } = buildContent(overflowingBlock);
    syncCodeBlockCards(root, [overflowingRange], makeReader(rowMetrics));
    const card = cardsIn(content)[0] as HTMLElement;
    expect(card.style.gridRow).toBe("span 3");
  });

  test("inserts the card at the block's position, preserving surrounding order", () => {
    // prose(1), block(2-4), prose(5)
    const { root, content, rowMetrics } = buildContent([
      {},
      { code: true, start: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
      { code: true, metrics: { clientWidth: 300, scrollWidth: 900 } },
      { code: true, end: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
      {},
    ]);
    syncCodeBlockCards(root, [{ start: 2, end: 4 }], makeReader(rowMetrics));
    const kids = [...content.children];
    // prose 1, then the card, then prose 5.
    expect(kids[0]?.getAttribute("data-line")).toBe("1");
    expect(kids[1]?.hasAttribute(CARD_ATTR)).toBe(true);
    expect(kids[2]?.getAttribute("data-line")).toBe("5");
  });

  test("does not wrap a block that fits the card", () => {
    const { root, content, rowMetrics } = buildContent([
      { code: true, start: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
      { code: true, metrics: { clientWidth: 300, scrollWidth: 280 } },
      { code: true, end: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
    ]);
    syncCodeBlockCards(root, [overflowingRange], makeReader(rowMetrics));
    expect(cardsIn(content)).toHaveLength(0);
    expect(directRows(content)).toHaveLength(3); // rows stay as direct children
  });

  test("gives each overflowing block its own card", () => {
    const { root, content, rowMetrics } = buildContent([
      { code: true, start: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
      { code: true, end: true, metrics: { clientWidth: 300, scrollWidth: 900 } },
      {},
      { code: true, start: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
      { code: true, end: true, metrics: { clientWidth: 300, scrollWidth: 700 } },
    ]);
    syncCodeBlockCards(root, TWO_BLOCK_RANGES, makeReader(rowMetrics));
    const cards = cardsIn(content);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.getAttribute(CARD_ATTR)).sort()).toEqual(["1", "4"]);
  });

  test("is idempotent — re-running reuses the card and mutates nothing", () => {
    const { root, content, rowMetrics } = buildContent(overflowingBlock);
    const read = makeReader(rowMetrics, cardOverflows);
    syncCodeBlockCards(root, [overflowingRange], read);
    const first = cardsIn(content)[0];
    syncCodeBlockCards(root, [overflowingRange], read);
    const cards = cardsIn(content);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toBe(first); // same element reused, not re-created
    expect(linesInCard(cards[0] as HTMLElement)).toEqual(["1", "2", "3"]);
  });

  test("unwraps a block that no longer overflows, returning its rows to the content", () => {
    const { root, content, rowMetrics } = buildContent(overflowingBlock);
    // First pass overflows → wrapped.
    syncCodeBlockCards(root, [overflowingRange], makeReader(rowMetrics, cardOverflows));
    expect(cardsIn(content)).toHaveLength(1);
    // Second pass: the card now fits (e.g. the viewport widened) → unwrapped.
    const cardFits = { "1": { scrollWidth: 300, clientWidth: 300 } };
    syncCodeBlockCards(root, [overflowingRange], makeReader(rowMetrics, cardFits));
    // Rows come back as direct children, in order.
    expectContentUnwrapped(content, ["1", "2", "3"]);
  });

  test("retires a card whose block no longer exists", () => {
    const { root, content, rowMetrics } = buildContent(overflowingBlock);
    syncCodeBlockCards(root, [overflowingRange], makeReader(rowMetrics, cardOverflows));
    expect(cardsIn(content)).toHaveLength(1);
    // Re-run with no ranges (content replaced with prose) → orphaned card unwrapped.
    syncCodeBlockCards(root, [], makeReader(rowMetrics, cardOverflows));
    expectContentUnwrapped(content, ["1", "2", "3"]);
  });

  test("leaves a fitting block and prose untouched while wrapping only the overflowing one", () => {
    const { root, content, rowMetrics } = buildContent(FITTING_THEN_OVERFLOWING_BLOCK);
    syncCodeBlockCards(root, TWO_BLOCK_RANGES, makeReader(rowMetrics));
    const cards = cardsIn(content);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute(CARD_ATTR)).toBe("4"); // only the overflowing block
    // The fitting block's rows and the prose row stay as direct children.
    expect(directRows(content).map((r) => r.getAttribute("data-line"))).toEqual(["1", "2", "3"]);
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
  rowMetrics: Map<Element, RowMetrics>;
} {
  const root = document.createElement("div");
  const code = document.createElement("div");
  const gutter = document.createElement("div");
  gutter.setAttribute("data-gutter", "");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  const rowMetrics = new Map<Element, RowMetrics>();
  specs.forEach((spec, i) => {
    const n = String(i + 1);
    const cell = document.createElement("div");
    cell.setAttribute("data-column-number", n);
    gutter.appendChild(cell);
    appendRow(content, spec, n, rowMetrics);
  });
  code.append(gutter, content);
  root.appendChild(code);
  return { root, gutter, content, rowMetrics };
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
   * two columns still balance — the shared postcondition for a block that
   * unwrapped or never carded. */
  function expectGutterUnwrapped(gutter: HTMLElement, content: HTMLElement, lines: string[]): void {
    expect(gutterCardsIn(gutter)).toHaveLength(0);
    expect(gutterCells(gutter)).toEqual(lines);
    expect(gutter.children.length).toBe(content.children.length);
  }

  test("wraps the block's gutter cells in a parallel display:contents card, restoring parity", () => {
    const { root, gutter, content, rowMetrics } = buildColumns(overflowingBlock);
    syncCodeBlockCards(root, [overflowingRange], makeReader(rowMetrics));

    const gcards = gutterCardsIn(gutter);
    expect(gcards).toHaveLength(1);
    const gcard = gcards[0] as HTMLElement;
    expect(gcard.getAttribute(GUTTER_CARD_ATTR)).toBe("1"); // keyed like its content card
    expect(gcard.style.display).toBe("contents"); // structural only, never a scroll box
    expect(cellsInGutterCard(gcard)).toEqual(["1", "2", "3"]);
    // The library asserts gutter.children.length === content.children.length.
    expect(gutter.children.length).toBe(content.children.length);
  });

  test("mirrors only the overflowing block; a fitting block's gutter cells stay loose", () => {
    const { root, gutter, content, rowMetrics } = buildColumns(FITTING_THEN_OVERFLOWING_BLOCK);
    syncCodeBlockCards(root, TWO_BLOCK_RANGES, makeReader(rowMetrics));
    const gcards = gutterCardsIn(gutter);
    expect(gcards).toHaveLength(1);
    expect(gcards[0]?.getAttribute(GUTTER_CARD_ATTR)).toBe("4");
    expect(gutter.children.length).toBe(content.children.length);
  });

  test("is idempotent — a re-run reuses the gutter card, mutating nothing", () => {
    const { root, gutter, rowMetrics } = buildColumns(overflowingBlock);
    const read = makeReader(rowMetrics, cardOverflows);
    syncCodeBlockCards(root, [overflowingRange], read);
    const first = gutterCardsIn(gutter)[0];
    syncCodeBlockCards(root, [overflowingRange], read);
    const gcards = gutterCardsIn(gutter);
    expect(gcards).toHaveLength(1);
    expect(gcards[0]).toBe(first);
    expect(cellsInGutterCard(gcards[0] as HTMLElement)).toEqual(["1", "2", "3"]);
  });

  test("unwraps the gutter card when the block fits again, returning cells in order", () => {
    const { root, gutter, content, rowMetrics } = buildColumns(overflowingBlock);
    syncCodeBlockCards(root, [overflowingRange], makeReader(rowMetrics, cardOverflows));
    expect(gutterCardsIn(gutter)).toHaveLength(1);
    const cardFits = { "1": { scrollWidth: 300, clientWidth: 300 } };
    syncCodeBlockCards(root, [overflowingRange], makeReader(rowMetrics, cardFits));
    expectGutterUnwrapped(gutter, content, ["1", "2", "3"]);
  });

  test("retires the gutter card when the block no longer exists", () => {
    const { root, gutter, content, rowMetrics } = buildColumns(overflowingBlock);
    syncCodeBlockCards(root, [overflowingRange], makeReader(rowMetrics, cardOverflows));
    expect(gutterCardsIn(gutter)).toHaveLength(1);
    syncCodeBlockCards(root, [], makeReader(rowMetrics, cardOverflows));
    expectGutterUnwrapped(gutter, content, ["1", "2", "3"]);
  });
});
