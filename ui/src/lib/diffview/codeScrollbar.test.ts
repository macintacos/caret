import "../../../test-setup.ts";
import { describe, expect, test } from "bun:test";
import type { CodeBlockRange } from "./codeBlocks.ts";
import {
  BAR_LANE_PX,
  type MetricsReader,
  type RowMetrics,
  SCROLL_END_ATTR,
  SCROLLBAR_ATTR,
  syncCodeBlockScrollbars,
} from "./codeScrollbar.ts";

// EXC-729: making each fenced-code row its own scroll container gives a classic-scrollbar
// platform one bar per over-wide line. codeScrollbar.ts hides those and injects a SINGLE
// scrollbar per overflowing block instead. This suite drives the lifecycle with injected
// metrics — happy-dom reports 0 for scrollWidth/clientWidth/offset*, so without an injected
// reader every block would read as non-overflowing and nothing would ever be created.

interface RowSpec {
  code?: boolean;
  start?: boolean;
  end?: boolean;
  /** Fake layout metrics for this row (defaults to a fits-the-card 100x100 row). */
  metrics?: Partial<RowMetrics>;
}

function buildContent(specs: RowSpec[]): { root: HTMLElement; read: MetricsReader } {
  const root = document.createElement("div");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  const metricsByEl = new Map<Element, RowMetrics>();
  specs.forEach((spec, i) => {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(i + 1));
    if (spec.code) row.setAttribute("data-code-line", "");
    if (spec.start) row.setAttribute("data-code-start", "");
    if (spec.end) row.setAttribute("data-code-end", "");
    content.appendChild(row);
    metricsByEl.set(row, {
      scrollWidth: 100,
      clientWidth: 100,
      offsetTop: i * 20,
      offsetLeft: 36,
      offsetHeight: 20,
      ...spec.metrics,
    });
  });
  root.appendChild(content);
  const read: MetricsReader = (el) =>
    metricsByEl.get(el) ?? {
      scrollWidth: 0,
      clientWidth: 0,
      offsetTop: 0,
      offsetLeft: 0,
      offsetHeight: 0,
    };
  return { root, read };
}

const barsIn = (root: HTMLElement) =>
  [...root.querySelectorAll(`[${SCROLLBAR_ATTR}]`)] as HTMLElement[];

// A block (lines 1-3) whose widest line overflows the card: scrollWidth 800 vs clientWidth
// 300. The middle line overflows; the fences fit.
const overflowingBlock: RowSpec[] = [
  { code: true, start: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
  { code: true, metrics: { clientWidth: 300, scrollWidth: 800 } },
  { code: true, end: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
];
const overflowingRange: CodeBlockRange = { start: 1, end: 3 };

describe("syncCodeBlockScrollbars", () => {
  test("injects one scrollbar for an overflowing block, sized to its widest line", () => {
    const { root, read } = buildContent(overflowingBlock);
    syncCodeBlockScrollbars(root, [overflowingRange], read);

    const bars = barsIn(root);
    expect(bars).toHaveLength(1);
    const bar = bars[0] as HTMLElement;
    expect(bar.getAttribute(SCROLLBAR_ATTR)).toBe("1"); // keyed by the block's start line
    const spacer = bar.firstElementChild as HTMLElement;
    expect(spacer.style.width).toBe("800px"); // the widest line's scrollWidth
    expect(bar.style.width).toBe("300px"); // the card width
  });

  test("places the bar in the reserved lane under the block, card-aligned", () => {
    const { root, read } = buildContent(overflowingBlock);
    syncCodeBlockScrollbars(root, [overflowingRange], read);
    const bar = barsIn(root)[0] as HTMLElement;
    // end row: offsetTop 40, offsetHeight 20 → bottom 60; bar sits BAR_LANE_PX above it.
    expect(bar.style.top).toBe(`${60 - BAR_LANE_PX}px`);
    expect(bar.style.left).toBe("36px"); // the card's inset
  });

  test("marks the block's last row so the CSS reserves the lane", () => {
    const { root, read } = buildContent(overflowingBlock);
    syncCodeBlockScrollbars(root, [overflowingRange], read);
    const endRow = root.querySelector('[data-line="3"]');
    expect(endRow?.hasAttribute(SCROLL_END_ATTR)).toBe(true);
    // rows that aren't the last one carry no marker.
    expect(root.querySelector('[data-line="2"]')?.hasAttribute(SCROLL_END_ATTR)).toBe(false);
  });

  test("adds no scrollbar for a block that fits the card", () => {
    const { root, read } = buildContent([
      { code: true, start: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
      { code: true, metrics: { clientWidth: 300, scrollWidth: 280 } },
      { code: true, end: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
    ]);
    syncCodeBlockScrollbars(root, [overflowingRange], read);
    expect(barsIn(root)).toHaveLength(0);
    expect(root.querySelector(`[${SCROLL_END_ATTR}]`)).toBeNull();
  });

  test("is idempotent — re-running reuses the element, so no duplicate bars", () => {
    const { root, read } = buildContent(overflowingBlock);
    syncCodeBlockScrollbars(root, [overflowingRange], read);
    const first = barsIn(root)[0];
    syncCodeBlockScrollbars(root, [overflowingRange], read);
    const bars = barsIn(root);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toBe(first); // same element reused, not recreated
  });

  test("removes the scrollbar and its lane marker when the block stops overflowing", () => {
    const { root } = buildContent(overflowingBlock);
    // First pass overflows → bar exists.
    const overflow: MetricsReader = (el) => ({
      scrollWidth: el.getAttribute("data-line") === "2" ? 800 : 300,
      clientWidth: 300,
      offsetTop: 0,
      offsetLeft: 36,
      offsetHeight: 20,
    });
    syncCodeBlockScrollbars(root, [overflowingRange], overflow);
    expect(barsIn(root)).toHaveLength(1);

    // Second pass: everything now fits (e.g. the viewport widened) → bar and marker removed.
    const fits: MetricsReader = () => ({
      scrollWidth: 300,
      clientWidth: 300,
      offsetTop: 0,
      offsetLeft: 36,
      offsetHeight: 20,
    });
    syncCodeBlockScrollbars(root, [overflowingRange], fits);
    expect(barsIn(root)).toHaveLength(0);
    expect(root.querySelector(`[${SCROLL_END_ATTR}]`)).toBeNull();
  });

  test("retires a stale scrollbar whose block no longer exists", () => {
    const { root, read } = buildContent(overflowingBlock);
    syncCodeBlockScrollbars(root, [overflowingRange], read);
    expect(barsIn(root)).toHaveLength(1);
    // Re-run with no ranges (content replaced with prose) → the orphaned bar is removed.
    syncCodeBlockScrollbars(root, [], read);
    expect(barsIn(root)).toHaveLength(0);
  });

  test("gives each overflowing block its own scrollbar", () => {
    const { root, read } = buildContent([
      { code: true, start: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
      { code: true, end: true, metrics: { clientWidth: 300, scrollWidth: 900 } },
      {},
      { code: true, start: true, metrics: { clientWidth: 300, scrollWidth: 300 } },
      { code: true, end: true, metrics: { clientWidth: 300, scrollWidth: 700 } },
    ]);
    syncCodeBlockScrollbars(
      root,
      [
        { start: 1, end: 2 },
        { start: 4, end: 5 },
      ],
      read,
    );
    const bars = barsIn(root);
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.getAttribute(SCROLLBAR_ATTR)).sort()).toEqual(["1", "4"]);
  });
});
