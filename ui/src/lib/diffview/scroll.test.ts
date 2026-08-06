import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import {
  CURSOR_SCROLLOFF,
  followCursorLine,
  followScrollDelta,
  lineAtReadingZone,
  REVEAL_MARGIN_BOTTOM,
  revealCard,
  revealScrollDelta,
  SCROLL_OFFSET_TOP,
  scrollToDiffLine,
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

// scrollToDiffLine addresses a line on a named side of a two-document diff.
// @pierre/diffs wraps each rendered column in a <code> carrying data-unified (one
// column) or data-deletions + data-additions (two), and stamps every row with
// data-line (its own side's number), data-alt-line (the other side's, absent on a
// change row) and data-line-type. These tests build both layouts by hand; happy-dom
// has no layout, so each row's rect is stubbed with a distinct top and the resolved
// row is named by the scroll target it produces (rowTop - SCROLL_OFFSET_TOP, since
// the unstubbed scroller reports an all-zero rect and scrollTop 0).
describe("scrollToDiffLine", () => {
  function rect(top: number): DOMRect {
    return {
      top,
      bottom: top,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: top,
      toJSON() {},
    } as DOMRect;
  }

  interface DiffRow {
    /** data-line: this row's own side's 1-based number. */
    line: number;
    /** data-alt-line: the other side's number. Omitted on a change row. */
    altLine?: number;
    /** data-line-type — one of the library's LineTypes: change-deletion,
     * change-addition, context, context-expanded. */
    type: string;
    /** Viewport top the stubbed rect reports, so assertions can name the row. */
    top: number;
  }

  /** A scroll container wrapping a shadow host whose root holds the library's
   * per-layout <code> columns, keyed by their data-* marker. */
  function diffHarness(columns: Record<string, DiffRow[]>): Harness {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    for (const [column, rows] of Object.entries(columns)) {
      const code = document.createElement("code");
      code.setAttribute(`data-${column}`, "");
      for (const spec of rows) {
        const row = document.createElement("div");
        row.setAttribute("data-line", String(spec.line));
        if (spec.altLine != null) row.setAttribute("data-alt-line", String(spec.altLine));
        row.setAttribute("data-line-type", spec.type);
        row.getBoundingClientRect = () => rect(spec.top);
        code.append(row);
      }
      root.append(code);
    }
    const scrollCalls: ScrollToOptions[] = [];
    scroller.scrollTo = ((opts: ScrollToOptions) =>
      scrollCalls.push(opts)) as typeof scroller.scrollTo;
    scroller.append(host);
    document.body.append(scroller);
    return { host, scrollCalls };
  }

  // One change at line 2: the same number addresses a different row on each side.
  const split = (): Harness =>
    diffHarness({
      deletions: [{ line: 2, type: "change-deletion", top: 100 }],
      additions: [{ line: 2, type: "change-addition", top: 300 }],
    });

  // The same diff in one column, plus an addition that offsets the numbering:
  // before 1 ctx / 2 changed / 3 ctx, after 1 ctx / 2 changed / 3 added / 4 ctx.
  // So before-line 3 and after-line 3 are different rows — the case that only the
  // data-alt-line term can resolve.
  const unified = (): Harness =>
    diffHarness({
      unified: [
        { line: 1, altLine: 1, type: "context", top: 50 },
        { line: 2, type: "change-deletion", top: 100 },
        { line: 2, type: "change-addition", top: 150 },
        { line: 3, type: "change-addition", top: 200 },
        { line: 4, altLine: 3, type: "context", top: 250 },
      ],
    });

  test("split: the after side resolves the additions column", () => {
    const { host, scrollCalls } = split();
    expect(scrollToDiffLine(host, 2, "after")).toBe(true);
    expect(scrollCalls[0]?.top).toBe(300 - SCROLL_OFFSET_TOP);
  });

  test("split: the before side resolves the deletions column", () => {
    const { host, scrollCalls } = split();
    expect(scrollToDiffLine(host, 2, "before")).toBe(true);
    expect(scrollCalls[0]?.top).toBe(100 - SCROLL_OFFSET_TOP);
  });

  test("unified: the after side resolves an addition row", () => {
    const { host, scrollCalls } = unified();
    expect(scrollToDiffLine(host, 3, "after")).toBe(true);
    expect(scrollCalls[0]?.top).toBe(200 - SCROLL_OFFSET_TOP);
  });

  test("unified: the before side resolves a deletion row", () => {
    const { host, scrollCalls } = unified();
    expect(scrollToDiffLine(host, 2, "before")).toBe(true);
    expect(scrollCalls[0]?.top).toBe(100 - SCROLL_OFFSET_TOP);
  });

  test("unified: the after side skips the deletion row sharing the line number", () => {
    // The change-deletion row carries data-line 2 too and comes first in document
    // order, so only the line-type exclusion lands the jump on the addition.
    const { host, scrollCalls } = unified();
    expect(scrollToDiffLine(host, 2, "after")).toBe(true);
    expect(scrollCalls[0]?.top).toBe(150 - SCROLL_OFFSET_TOP);
  });

  test("unified: the before side resolves a context row by its data-alt-line number", () => {
    // Before-line 3 is context, rendered once carrying the after number (4) in
    // data-line — the row is only reachable through data-alt-line.
    const { host, scrollCalls } = unified();
    expect(scrollToDiffLine(host, 3, "before")).toBe(true);
    expect(scrollCalls[0]?.top).toBe(250 - SCROLL_OFFSET_TOP);
  });

  test("returns false when no row carries the requested line on that side", () => {
    // The before document ends at line 3; nothing renders for a before-line 4.
    const { host, scrollCalls } = unified();
    expect(scrollToDiffLine(host, 4, "before")).toBe(false);
    expect(scrollCalls.length).toBe(0);
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

// followCursorLine keeps the keyboard cursor within a scrolloff band of the
// viewport edges: it scrolls by the exact overshoot (one row at a time under a
// held j/k) rather than yanking the row to the top, so the cursor never leaves
// the screen and the view follows it with no jump. followScrollDelta is the
// pure geometry; followCursorLine measures the row + scroller and applies it.
// happy-dom has no layout, so the DOM tests stub the rects (the same DOMRect
// space getBoundingClientRect reads).
describe("followScrollDelta", () => {
  // A 600px-tall viewport [100, 700] with 20px rows and scrolloff 5 → 100px
  // margins, so the comfortable band the cursor is kept inside is [200, 600].
  const base = { rowHeight: 20, viewTop: 100, viewBottom: 700, scrolloff: 5 };

  test("does not scroll when the row sits comfortably inside the band", () => {
    expect(followScrollDelta({ ...base, rowTop: 300, rowBottom: 320 })).toBe(0);
  });

  test("scrolls down by the overshoot when the row passes the bottom margin", () => {
    // rowBottom 610 is 10px past the 600 bottom bound → scroll down 10.
    expect(followScrollDelta({ ...base, rowTop: 590, rowBottom: 610 })).toBe(10);
  });

  test("scrolls up by the overshoot when the row passes the top margin", () => {
    // rowTop 150 is 50px above the 200 top bound → scroll up 50.
    expect(followScrollDelta({ ...base, rowTop: 150, rowBottom: 170 })).toBe(-50);
  });

  test("follows one row at a time — a row one step past the bound scrolls one row, not a page", () => {
    // The whole-page yank this replaces would scroll ~600px; the follow scrolls
    // exactly one row-height (20) when the cursor steps one row past the bound.
    expect(followScrollDelta({ ...base, rowTop: 600, rowBottom: 620 })).toBe(20);
  });

  test("treats the band edges as inclusive — no scroll with the row exactly on a bound", () => {
    expect(followScrollDelta({ ...base, rowTop: 200, rowBottom: 220 })).toBe(0); // on the top bound
    expect(followScrollDelta({ ...base, rowTop: 580, rowBottom: 600 })).toBe(0); // on the bottom bound
  });
});

describe("followCursorLine", () => {
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

  /** A scroller (top 100, bottom 700 → 600px tall) wrapping a shadow host. */
  function harness(lines: number[]): { host: HTMLElement; scrollBys: ScrollToOptions[] } {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    scroller.getBoundingClientRect = () => rect(100, 700);
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    for (const n of lines) {
      const row = document.createElement("div");
      row.setAttribute("data-line", String(n));
      root.append(row);
    }
    const scrollBys: ScrollToOptions[] = [];
    scroller.scrollBy = ((opts: ScrollToOptions) =>
      scrollBys.push(opts)) as typeof scroller.scrollBy;
    scroller.append(host);
    document.body.append(scroller);
    return { host, scrollBys };
  }

  function stubRow(host: HTMLElement, line: number, top: number, bottom: number): void {
    const row = host.shadowRoot?.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (row != null) row.getBoundingClientRect = () => rect(top, bottom);
  }

  test("scrolls by the follow delta, instantly, when the row passes the bottom band", () => {
    const { host, scrollBys } = harness([1, 5, 9]);
    stubRow(host, 5, 650, 670); // below the [200,600] band (margin CURSOR_SCROLLOFF*20)
    expect(followCursorLine(host, 5)).toBe(true);
    expect(scrollBys.length).toBe(1);
    expect(scrollBys[0]?.top).toBe(670 - (700 - CURSOR_SCROLLOFF * 20)); // overshoot past bottom bound
    expect(scrollBys[0]?.behavior).toBe("auto"); // instant — no smooth lag under held motion
  });

  test("does not scroll when the row is comfortably inside the band", () => {
    const { host, scrollBys } = harness([1, 5, 9]);
    stubRow(host, 5, 300, 320);
    expect(followCursorLine(host, 5)).toBe(true);
    expect(scrollBys.length).toBe(0);
  });

  test("returns false when the requested line is not rendered", () => {
    const { host, scrollBys } = harness([1, 2, 3]);
    expect(followCursorLine(host, 99)).toBe(false);
    expect(scrollBys.length).toBe(0);
  });

  test("returns false when the container has no shadow root", () => {
    const el = document.createElement("div");
    document.body.append(el);
    expect(followCursorLine(el, 1)).toBe(false);
  });

  test("falls back to the row's scrollIntoView when there is no scroll container", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const row = document.createElement("div");
    row.setAttribute("data-line", "5");
    root.append(row);
    document.body.append(host);
    let scrolledIntoView = false;
    row.scrollIntoView = () => (scrolledIntoView = true);
    expect(followCursorLine(host, 5)).toBe(true);
    expect(scrolledIntoView).toBe(true);
  });
});

// revealCard scrolls a freshly-mounted composer card fully into view, moving the
// plan as little as it can. revealScrollDelta is the pure geometry; revealCard
// waits for the card's height to settle (the editor builds inside its own effect),
// measures, and applies it. happy-dom has no layout, so the DOM test stubs the
// rects the same way the followCursorLine block does.
describe("revealScrollDelta", () => {
  // The same 600px-tall viewport [100, 700], with the production bottom margin.
  const base = { viewTop: 100, viewBottom: 700, margin: REVEAL_MARGIN_BOTTOM };

  test("does not move the view when the card already fits above the margin", () => {
    expect(revealScrollDelta({ ...base, cardTop: 300, cardBottom: 400 })).toBe(0);
  });

  test("does not move the view when the card's bottom rests exactly on the margin", () => {
    expect(
      revealScrollDelta({ ...base, cardTop: 400, cardBottom: 700 - REVEAL_MARGIN_BOTTOM }),
    ).toBe(0);
  });

  test("scrolls by exactly the overshoot when the card is clipped at the bottom", () => {
    // Bottom 720 is 20px past the viewport, plus the 12px margin → 32.
    expect(revealScrollDelta({ ...base, cardTop: 500, cardBottom: 720 })).toBe(
      20 + REVEAL_MARGIN_BOTTOM,
    );
  });

  test("takes the same path for a card entirely below the fold — no special case", () => {
    // Lands the card flush at the bottom with the margin: 900 - 212 === 700 - 12.
    expect(revealScrollDelta({ ...base, cardTop: 750, cardBottom: 900 })).toBe(
      900 + REVEAL_MARGIN_BOTTOM - 700,
    );
  });

  test("clamps a card taller than the viewport so its top is not pushed off-screen", () => {
    // Raw overshoot would be 312 and shove the card's label past the top edge;
    // clamping at cardTop - viewTop reveals it from its top down instead.
    expect(revealScrollDelta({ ...base, cardTop: 200, cardBottom: 1000 })).toBe(100);
  });

  test("never scrolls up — a card already starting above the viewport stays put", () => {
    expect(revealScrollDelta({ ...base, cardTop: 50, cardBottom: 720 })).toBe(0);
  });
});

describe("revealCard", () => {
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

  /** A card inside a scroller (top 100, bottom 700), clipped 20px past the bottom. */
  function harness(scrollable = true): { card: HTMLElement; scrollBys: ScrollToOptions[] } {
    const scroller = document.createElement("div");
    if (scrollable) scroller.style.overflowY = "auto";
    scroller.getBoundingClientRect = () => rect(100, 700);
    const card = document.createElement("div");
    card.getBoundingClientRect = () => rect(500, 720);
    const scrollBys: ScrollToOptions[] = [];
    scroller.scrollBy = ((opts: ScrollToOptions) =>
      scrollBys.push(opts)) as typeof scroller.scrollBy;
    scroller.append(card);
    document.body.append(scroller);
    return { card, scrollBys };
  }

  /** Resolves after `n` animation frames, so the settle retry can run to completion. */
  function frames(n: number): Promise<void> {
    return new Promise((resolve) => {
      let left = n;
      const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  }

  test("scrolls the card's scroll container by the reveal delta, smoothly", async () => {
    const { card, scrollBys } = harness();
    revealCard(card);
    await frames(4);
    expect(scrollBys.length).toBe(1);
    expect(scrollBys[0]?.top).toBe(20 + REVEAL_MARGIN_BOTTOM);
    expect(scrollBys[0]?.behavior).toBe("smooth"); // a one-shot move, unlike the cursor follow
  });

  test("the disposer cancels a pending measurement, so a dismissed composer never scrolls", async () => {
    const { card, scrollBys } = harness();
    revealCard(card)();
    await frames(4);
    expect(scrollBys.length).toBe(0);
  });

  test("does nothing when the card has no scroll container", async () => {
    const { card, scrollBys } = harness(false);
    revealCard(card);
    await frames(4);
    expect(scrollBys.length).toBe(0);
  });

  test("does not scroll when the card already fits", async () => {
    const { card, scrollBys } = harness();
    card.getBoundingClientRect = () => rect(300, 400);
    revealCard(card);
    await frames(4);
    expect(scrollBys.length).toBe(0);
  });

  test("measures the settled height, not the height on the mount frame", async () => {
    // The composer's editor builds in its own effect, so the card grows for a few
    // frames after mount. Measuring the mount frame's 60px-tall box would compute
    // a delta of 0 (it fits); only the settled 220px box is clipped.
    const { card, scrollBys } = harness();
    const heights = [60, 120, 180, 220]; // grows for three frames, then holds
    let call = 0;
    card.getBoundingClientRect = () => {
      const height = heights[Math.min(call, heights.length - 1)] ?? 0;
      call += 1;
      return rect(500, 500 + height);
    };
    revealCard(card);
    await frames(8);
    expect(scrollBys.length).toBe(1);
    expect(scrollBys[0]?.top).toBe(20 + REVEAL_MARGIN_BOTTOM);
  });

  test("measures anyway once the settle budget is spent", async () => {
    // A card whose height never stops changing must not retry forever — the cap
    // gives up and measures, exactly once.
    const { card, scrollBys } = harness();
    let grown = 0;
    card.getBoundingClientRect = () => {
      grown += 1;
      return rect(500, 720 + grown);
    };
    revealCard(card);
    await frames(40);
    expect(scrollBys.length).toBe(1);
  });
});
