// Single per-block horizontal scrollbar for the plan source view's fenced-code panels
// (EXC-729). @pierre/diffs renders each source line as an independent [data-line] cell, so
// making each code row its own scroll container gives a classic-scrollbar platform ONE bar
// per over-wide line — visually terrible. Instead the per-row scrollbars are hidden (CSS)
// and this module injects a SINGLE scrollbar element at the bottom of each block that
// overflows. codeScroll.ts drives the rows from it (and it from a row's trackpad scroll),
// so the whole block scrolls as one unit.
//
// The scrollbar is absolutely positioned inside [data-content] (position: relative) so it
// consumes no subgrid row — a normal in-flow child would push the rows below out of step
// with their gutter line numbers. Space for it is reserved by a padding rule keyed on the
// data-code-scroll-end marker this module sets on an overflowing block's last row (the
// gutter's matching cell grows with it via subgrid, so alignment holds). The library wipes
// injected children on every repaint, so this re-runs after each one (SourceView's
// MutationObserver); it is idempotent — an unchanged block reuses its existing element, so
// a re-run makes no DOM mutation and can't re-trigger that observer.

import type { CodeBlockRange } from "./codeBlocks.ts";

/** Marks the injected scrollbar; its value is the block's 1-based start line, the key that
 * ties it to its block for reuse and for codeScroll.ts's sync. */
export const SCROLLBAR_ATTR = "data-code-scrollbar";
/** Set on an overflowing block's last row so the CSS reserves the scrollbar's lane under
 * it. Only content rows are touched, so the gutter cell grows in step via subgrid. */
export const SCROLL_END_ATTR = "data-code-scroll-end";

/** Height (px) of the reserved lane under an overflowing block — must match the
 * padding-block-end the CSS applies to [data-code-scroll-end]. */
export const BAR_LANE_PX = 16;

/**
 * The layout metrics a block needs to decide whether it overflows and where its scrollbar
 * sits. Injectable so the lifecycle unit-tests without real layout — happy-dom reports 0
 * for every one of these, which would otherwise make every block read as non-overflowing.
 */
export interface RowMetrics {
  scrollWidth: number;
  clientWidth: number;
  offsetTop: number;
  offsetLeft: number;
  offsetHeight: number;
}

export type MetricsReader = (el: HTMLElement) => RowMetrics;

const readMetrics: MetricsReader = (el) => ({
  scrollWidth: el.scrollWidth,
  clientWidth: el.clientWidth,
  offsetTop: el.offsetTop,
  offsetLeft: el.offsetLeft,
  offsetHeight: el.offsetHeight,
});

/** The rendered content rows of a block, in document order. Reads by 1-based data-line so
 * it works whether or not the rows are tagged yet. */
function blockRowsInRange(content: Element, range: CodeBlockRange): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (let n = range.start; n <= range.end; n++) {
    const row = content.querySelector<HTMLElement>(`:scope > [data-line="${n}"]`);
    if (row != null) rows.push(row);
  }
  return rows;
}

/** Finds or creates the scrollbar element for the block keyed by `key`. The element holds
 * one spacer child sized to the block's widest line, so its native scrollbar spans the
 * block's full scroll range. */
function ensureScrollbar(content: Element, key: string): HTMLElement {
  const existing = content.querySelector<HTMLElement>(`[${SCROLLBAR_ATTR}="${key}"]`);
  if (existing != null) return existing;
  const bar = document.createElement("div");
  bar.setAttribute(SCROLLBAR_ATTR, key);
  bar.appendChild(document.createElement("div")); // spacer — width set to the widest line
  content.appendChild(bar);
  return bar;
}

/**
 * Ensures every overflowing fenced block has one horizontal scrollbar at its bottom, sized
 * and positioned to the block, and that blocks which fit (or no longer exist) have none.
 * Idempotent: reuses an existing block's element and only writes styles/attributes, so a
 * re-run on an unchanged layout mutates no child list. `read` is injectable for tests.
 */
export function syncCodeBlockScrollbars(
  root: ParentNode,
  ranges: CodeBlockRange[],
  read: MetricsReader = readMetrics,
): void {
  const content = root.querySelector<HTMLElement>("[data-content]");
  if (content == null) return;

  const wanted = new Set<string>();
  for (const range of ranges) {
    const rows = blockRowsInRange(content, range);
    if (rows.length === 0) continue;
    const endRow = rows[rows.length - 1] as HTMLElement;
    const metrics = rows.map(read);
    const cardWidth = Math.max(...metrics.map((m) => m.clientWidth));
    const maxScroll = Math.max(...metrics.map((m) => m.scrollWidth));

    // Fits within the card: no bar, and drop the reserved lane if it had one.
    if (maxScroll <= cardWidth) {
      endRow.removeAttribute(SCROLL_END_ATTR);
      continue;
    }

    const key = String(range.start);
    wanted.add(key);
    endRow.toggleAttribute(SCROLL_END_ATTR, true);

    const bar = ensureScrollbar(content, key);
    const spacer = bar.firstElementChild as HTMLElement | null;
    if (spacer != null) spacer.style.width = `${maxScroll}px`;

    // Place the bar in the reserved lane under the block, aligned to the card box. The end
    // row's offsets are in [data-content]'s coordinate space (its offsetParent once the
    // sheet makes it position: relative), the same space the absolute bar is placed in.
    const em = read(endRow);
    bar.style.top = `${em.offsetTop + em.offsetHeight - BAR_LANE_PX}px`;
    bar.style.left = `${em.offsetLeft}px`;
    bar.style.width = `${em.clientWidth}px`;
  }

  // Retire scrollbars whose block no longer overflows or no longer exists.
  for (const bar of content.querySelectorAll<HTMLElement>(`[${SCROLLBAR_ATTR}]`)) {
    if (!wanted.has(bar.getAttribute(SCROLLBAR_ATTR) ?? "")) bar.remove();
  }
}
