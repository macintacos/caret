import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { bracketBox, type RectReader } from "$lib/diffview/bracket.ts";

// bracketBox computes a comment-span rail's box from the shadow `[data-line]`
// rows the source view paints, in the scroll container's content frame. happy-dom
// has no layout (getBoundingClientRect is all zeros), so the rect reader is
// injected: the host's rows and the scroller get stub rects, and the box is
// asserted against those. The action that drives the overlay (resize re-measure,
// DOM reconciliation, color propagation) is real-browser behavior covered by e2e.

interface Built {
  host: HTMLElement;
  scroller: HTMLElement;
  read: RectReader;
}

/**
 * A shadow host of `[data-line]` rows inside a scroll container. The reader
 * places each present row 20px tall stacked from `rowTop` (viewport coords) and
 * the scroller's top at `scrollerTop`; `scrollTop` is the container's scroll
 * offset. The content-frame origin is `scrollerTop - scrollTop`, so a row at
 * viewport `rowTop` lands at content offset `rowTop - (scrollerTop - scrollTop)`.
 */
function build(
  lines: number[],
  opts: { rowTop?: number; scrollerTop?: number; scrollTop?: number } = {},
): Built {
  const rowTop = opts.rowTop ?? 0;
  const scrollerTop = opts.scrollerTop ?? 0;
  const scroller = document.createElement("div");
  scroller.scrollTop = opts.scrollTop ?? 0;
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  scroller.append(host);
  const tops = new Map<HTMLElement, { top: number; bottom: number }>();
  tops.set(scroller, { top: scrollerTop, bottom: scrollerTop + 1000 });
  lines.forEach((n, i) => {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(n));
    root.append(row);
    const top = rowTop + i * 20;
    tops.set(row, { top, bottom: top + 20 });
  });
  const read: RectReader = (el) => tops.get(el) ?? { top: 0, bottom: 0 };
  return { host, scroller, read };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("bracketBox", () => {
  test("spans the top of the first row to the bottom of the last in the range", () => {
    // Rows 1..6 stacked 20px each from the content origin; a 2–4 span covers rows
    // at indices 1,2,3 → top 20, bottom of row 4 is 80, so height 60.
    const { host, scroller, read } = build([1, 2, 3, 4, 5, 6]);
    expect(bracketBox(host, scroller, { startLine: 2, endLine: 4 }, read)).toEqual({
      top: 20,
      height: 60,
    });
  });

  test("a single-line span yields a one-row box", () => {
    const { host, scroller, read } = build([1, 2, 3]);
    expect(bracketBox(host, scroller, { startLine: 3, endLine: 3 }, read)).toEqual({
      top: 40,
      height: 20,
    });
  });

  test("expresses the box in content coords, so a scroll leaves it unchanged", () => {
    // Scrolled down 100px: the content (rows) moves up 100 while the scroller box
    // stays put, so a row's viewport top drops by 100 and scrollTop is 100 — the
    // content-frame box is identical to the unscrolled case.
    const unscrolled = build([1, 2, 3, 4]);
    const scrolled = build([1, 2, 3, 4], { rowTop: -100, scrollerTop: 0, scrollTop: 100 });
    const a = bracketBox(
      unscrolled.host,
      unscrolled.scroller,
      { startLine: 1, endLine: 2 },
      unscrolled.read,
    );
    const b = bracketBox(
      scrolled.host,
      scrolled.scroller,
      { startLine: 1, endLine: 2 },
      scrolled.read,
    );
    expect(b).toEqual(a);
    expect(b).toEqual({ top: 0, height: 40 });
  });

  test("normalizes a reversed range (endLine before startLine)", () => {
    const { host, scroller, read } = build([1, 2, 3, 4]);
    const forward = bracketBox(host, scroller, { startLine: 2, endLine: 4 }, read);
    const reversed = bracketBox(host, scroller, { startLine: 4, endLine: 2 }, read);
    expect(reversed).toEqual(forward);
  });

  test("clamps to the rows that are present when an endpoint is off-window", () => {
    // Only rows 3..6 are rendered; a 1–4 span draws from the first present row
    // (3, top 0) to the bottom of row 4 (40) — the off-window 1,2 are skipped.
    const { host, scroller, read } = build([3, 4, 5, 6]);
    expect(bracketBox(host, scroller, { startLine: 1, endLine: 4 }, read)).toEqual({
      top: 0,
      height: 40,
    });
  });

  test("returns null when no row in the range is rendered", () => {
    const { host, scroller, read } = build([10, 11, 12]);
    expect(bracketBox(host, scroller, { startLine: 1, endLine: 3 }, read)).toBeNull();
  });

  test("returns null when the host has no shadow root", () => {
    const bare = document.createElement("div");
    const scroller = document.createElement("div");
    expect(bracketBox(bare, scroller, { startLine: 1, endLine: 2 })).toBeNull();
  });
});
