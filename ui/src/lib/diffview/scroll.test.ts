import "../../../test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import {
  lineAtReadingZone,
  SCROLL_OFFSET_TOP,
  scrollLineIntoView,
  scrollToLine,
} from "$lib/diffview/scroll.ts";

// @pierre/diffs renders each source line as a <div data-line="N"> inside the
// container's shadow root. scrollToLine finds that row and scrolls the nearest
// scrollable ancestor so the row rests near the top; these tests build the
// shadow root and a scroll container by hand (no library mount needed). happy-dom
// has no layout, so getBoundingClientRect is all zeros and the computed target is
// 0 — enough to assert the call shape, container resolution, and fallback.

interface Harness {
  host: HTMLElement;
  scrollCalls: ScrollToOptions[];
}

/** A scroll container wrapping a shadow host whose root holds the given rows. */
function harness(lines: number[], scrollable = true): Harness {
  const scroller = document.createElement("div");
  if (scrollable) scroller.style.overflowY = "auto";
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  for (const n of lines) {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(n));
    root.append(row);
  }
  const scrollCalls: ScrollToOptions[] = [];
  scroller.scrollTo = ((opts: ScrollToOptions) =>
    scrollCalls.push(opts)) as typeof scroller.scrollTo;
  scroller.append(host);
  document.body.append(scroller);
  return { host, scrollCalls };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("scrollToLine", () => {
  test("scrolls the surrounding container to the matching row and returns true", () => {
    const { host, scrollCalls } = harness([1, 5, 9]);
    expect(scrollToLine(host, 5)).toBe(true);
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
    // Smooth by default (no reduced-motion preference in the test env).
    expect(scrollCalls[0]?.behavior).toBe("smooth");
    expect(typeof scrollCalls[0]?.top).toBe("number");
  });

  test("returns false when no row carries the requested line", () => {
    const { host, scrollCalls } = harness([1, 2, 3]);
    expect(scrollToLine(host, 99)).toBe(false);
    expect(scrollCalls.length).toBe(0);
  });

  test("returns false when the container has no shadow root", () => {
    const el = document.createElement("div");
    document.body.append(el);
    expect(scrollToLine(el, 1)).toBe(false);
  });

  test("falls back to the row's scrollIntoView when there is no scroll container", () => {
    const { host } = harness([1, 5, 9], false);
    const row = host.shadowRoot?.querySelector<HTMLElement>('[data-line="5"]');
    let scrolledIntoView = false;
    if (row != null) row.scrollIntoView = () => (scrolledIntoView = true);
    expect(scrollToLine(host, 5)).toBe(true);
    expect(scrolledIntoView).toBe(true);
  });
});

// Geometry fixture: the scroll container's top edge sits at `TOP` in viewport
// coordinates, and scrollToLine parks a jumped heading's top edge at
// `TOP + SCROLL_OFFSET_TOP` — so the row immediately above a parked heading ends
// with its bottom exactly on that park line. `bottom` values are in the same
// viewport coordinate space the component reads from getBoundingClientRect().
const TOP = 100;
const PARK = TOP + SCROLL_OFFSET_TOP; // where a jumped heading's top edge rests
const ROW = 18; // a representative source-line height

describe("lineAtReadingZone", () => {
  test("after a jump, returns the parked heading — not the row above it", () => {
    // Heading (line 6) parked with its top at PARK, so line 5's bottom rests on the
    // park line. Probing at the container's top edge (the old behavior) would pick
    // line 5; the reading-zone probe must pick line 6.
    const rows = [
      { line: 5, bottom: PARK }, // prior row's bottom touches the park line
      { line: 6, bottom: PARK + ROW }, // the jumped heading
      { line: 7, bottom: PARK + ROW * 2 },
    ];
    expect(lineAtReadingZone(rows, TOP)).toBe(6);
  });

  test("excludes a prior row whose bottom rounds a sub-pixel past the park line", () => {
    // Smooth scrollTo rounds scrollTop to device pixels, so a parked heading can rest
    // a fraction low and the prior row's bottom lands just past PARK. The slop margin
    // must still exclude it, or the off-by-one returns intermittently.
    const rows = [
      { line: 5, bottom: PARK + 0.5 },
      { line: 6, bottom: PARK + ROW + 0.5 },
    ];
    expect(lineAtReadingZone(rows, TOP)).toBe(6);
  });

  test("excludes a prior row whose bottom sits one slop-width past the park line", () => {
    // The boundary case: a row ending exactly on the reading-zone line (park + slop)
    // is within the margin, so the heading below it still wins.
    const rows = [
      { line: 5, bottom: PARK + 1 },
      { line: 6, bottom: PARK + ROW },
    ];
    expect(lineAtReadingZone(rows, TOP)).toBe(6);
  });

  test("returns the row straddling the reading-zone line while scrolling", () => {
    const rows = [
      { line: 20, bottom: PARK - 4 }, // ends above the reading zone
      { line: 21, bottom: PARK + 14 }, // spans across the reading-zone line
      { line: 22, bottom: PARK + 32 },
    ];
    expect(lineAtReadingZone(rows, TOP)).toBe(21);
  });

  test("returns null when no rows are present", () => {
    expect(lineAtReadingZone([], TOP)).toBe(null);
  });

  test("returns null when every row ends above the reading zone", () => {
    const rows = [
      { line: 1, bottom: PARK - 20 },
      { line: 2, bottom: PARK - 2 },
    ];
    expect(lineAtReadingZone(rows, TOP)).toBe(null);
  });
});

// scrollLineIntoView is scrollToLine's "only if off-screen" wrapper for cursor
// motion: it no-ops when the row is already visible and otherwise delegates.
// happy-dom has no layout, so each test stubs the row/scroller rects to drive
// the visibility decision (the same DOMRect space getBoundingClientRect reads).
describe("scrollLineIntoView", () => {
  function rect(top: number, bottom: number): DOMRect {
    return {
      top,
      bottom,
      left: 0,
      right: 0,
      width: 0,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON() {},
    } as DOMRect;
  }

  /** A scroller (top 100, bottom 500) wrapping a shadow host with the given rows. */
  function harnessWithRects(lines: number[]): {
    host: HTMLElement;
    scrollCalls: ScrollToOptions[];
  } {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    scroller.getBoundingClientRect = () => rect(100, 500);
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    for (const n of lines) {
      const row = document.createElement("div");
      row.setAttribute("data-line", String(n));
      root.append(row);
    }
    const scrollCalls: ScrollToOptions[] = [];
    scroller.scrollTo = ((opts: ScrollToOptions) =>
      scrollCalls.push(opts)) as typeof scroller.scrollTo;
    scroller.append(host);
    document.body.append(scroller);
    return { host, scrollCalls };
  }

  function stubRow(host: HTMLElement, line: number, top: number, bottom: number): void {
    const row = host.shadowRoot?.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (row != null) row.getBoundingClientRect = () => rect(top, bottom);
  }

  test("does not scroll when the row is already fully in view", () => {
    const { host, scrollCalls } = harnessWithRects([1, 5, 9]);
    stubRow(host, 5, 200, 218); // inside [100 + offset, 500]
    expect(scrollLineIntoView(host, 5)).toBe(true);
    expect(scrollCalls.length).toBe(0);
  });

  test("scrolls when the row sits below the viewport", () => {
    const { host, scrollCalls } = harnessWithRects([1, 5, 9]);
    stubRow(host, 5, 600, 618);
    expect(scrollLineIntoView(host, 5)).toBe(true);
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("scrolls when the row sits above the reading zone", () => {
    const { host, scrollCalls } = harnessWithRects([1, 5, 9]);
    stubRow(host, 5, 104, 122); // top above the park line (100 + SCROLL_OFFSET_TOP)
    expect(SCROLL_OFFSET_TOP).toBeGreaterThan(0);
    expect(scrollLineIntoView(host, 5)).toBe(true);
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("returns false when the requested line is not rendered", () => {
    const { host, scrollCalls } = harnessWithRects([1, 2, 3]);
    expect(scrollLineIntoView(host, 99)).toBe(false);
    expect(scrollCalls.length).toBe(0);
  });

  test("returns false when the container has no shadow root", () => {
    const el = document.createElement("div");
    document.body.append(el);
    expect(scrollLineIntoView(el, 1)).toBe(false);
  });
});
