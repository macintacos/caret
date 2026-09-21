import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { fillLines, scrolledOffsetReader } from "@ui/support/diffview-dom.ts";
import { CARD_ATTR } from "$lib/diffview/codeBlockScroll.ts";
import { codeBlockAtPoint, codeChromeAnchors, type RectReader } from "$lib/diffview/codeChrome.ts";

// A host with a shadow root of [data-content] > [data-line] rows, matching the
// @pierre/diffs structure codeChrome reads.
function makeHost(lineCount: number): HTMLElement {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  fillLines(content, lineCount);
  root.appendChild(content);
  return host;
}

/** Moves lines `start`..`end` into a scroll card, as codeBlockScroll.ts does for an
 * overflowing block — the shape that makes the block's rows non-direct children. */
function wrapInCard(host: HTMLElement, start: number, end: number): void {
  const content = host.shadowRoot?.querySelector("[data-content]") as HTMLElement;
  const rows = [];
  for (let n = start; n <= end; n++) {
    rows.push(content.querySelector(`[data-line="${n}"]`) as HTMLElement);
  }
  const card = document.createElement("div");
  card.setAttribute(CARD_ATTR, String(start));
  content.insertBefore(card, rows[0] ?? null);
  for (const row of rows) card.appendChild(row);
}

// Lays each row on a vertical grid: row n spans y [ (n-1)*10, n*10 ], x [100, 300]. A card
// is NARROWER than the rows it holds (x [100, 250]) — a carded row is max-content wide, so
// its right edge sits off past the card's visible edge, which is the distinction the
// card-first box exists to draw.
function gridReader(scroller: HTMLElement): RectReader {
  return (el) => {
    if (el === scroller) return { top: 0, bottom: 1000, left: 0, right: 400 };
    const key = el.getAttribute(CARD_ATTR);
    if (key !== null) {
      const n = Number(key);
      return { top: (n - 1) * 10, bottom: n * 10 + 20, left: 100, right: 250 };
    }
    const n = Number(el.getAttribute("data-line"));
    return { top: (n - 1) * 10, bottom: n * 10, left: 100, right: 300 };
  };
}

// codeBlockAtPoint takes no scroller, so nothing it reads matches the sentinel.
const POINT_READER = gridReader(document.createElement("div"));

describe("codeBlockAtPoint", () => {
  test("returns the block whose row span contains the point", () => {
    const host = makeHost(8);
    // Rows 2-4 span y [10,40]; point (150, 25) is inside, x within [100,300].
    expect(codeBlockAtPoint(host, [{ start: 2, end: 4 }], 150, 25, POINT_READER)).toEqual({
      start: 2,
      end: 4,
    });
  });

  test("returns null above the block and right of the column", () => {
    const host = makeHost(8);
    expect(codeBlockAtPoint(host, [{ start: 2, end: 4 }], 150, 5, POINT_READER)).toBeNull();
    expect(codeBlockAtPoint(host, [{ start: 2, end: 4 }], 350, 25, POINT_READER)).toBeNull();
  });

  test("selects the block the point is in when several exist", () => {
    const host = makeHost(10);
    const ranges = [
      { start: 1, end: 3 },
      { start: 6, end: 8 },
    ];
    // y=65 is within rows 6-8 (y [50,80]).
    expect(codeBlockAtPoint(host, ranges, 150, 65, POINT_READER)).toEqual({ start: 6, end: 8 });
  });

  test("hits an overflowing block through its scroll card", () => {
    const host = makeHost(8);
    wrapInCard(host, 2, 4);
    // The card spans y [10,60], x [100,250].
    expect(codeBlockAtPoint(host, [{ start: 2, end: 4 }], 150, 25, POINT_READER)).toEqual({
      start: 2,
      end: 4,
    });
  });

  test("returns null beyond a carded block's visible edge, not its max-content rows", () => {
    const host = makeHost(8);
    wrapInCard(host, 2, 4);
    // x=280 is inside a row's max-content box but past the card the reviewer can see.
    expect(codeBlockAtPoint(host, [{ start: 2, end: 4 }], 280, 25, POINT_READER)).toBeNull();
  });
});

describe("codeChromeAnchors", () => {
  test("anchors each rendered block at its top-right in scroller content coords", () => {
    const host = makeHost(10);
    const scroller = document.createElement("div");
    const read = gridReader(scroller);
    expect(
      codeChromeAnchors(
        host,
        scroller,
        [
          { start: 1, end: 3 },
          { start: 6, end: 8 },
        ],
        read,
      ),
    ).toEqual([
      { start: 1, top: 0, left: 300, carded: false },
      { start: 6, top: 50, left: 300, carded: false },
    ]);
  });

  test("accounts for the scroller's viewport offset and scroll", () => {
    const host = makeHost(5);
    const scroller = document.createElement("div");
    const read = scrolledOffsetReader(scroller);
    // top = 100 - (5 - 50) = 145 ; left = 300 - (8 - 10) = 302
    expect(codeChromeAnchors(host, scroller, [{ start: 1, end: 3 }], read)).toEqual([
      { start: 1, top: 145, left: 302, carded: false },
    ]);
  });

  test("anchors a carded block to its card's visible edge, not its max-content row", () => {
    const host = makeHost(8);
    wrapInCard(host, 2, 4);
    const scroller = document.createElement("div");
    expect(codeChromeAnchors(host, scroller, [{ start: 2, end: 4 }], gridReader(scroller))).toEqual(
      [{ start: 2, top: 10, left: 250, carded: true }],
    );
  });

  test("skips a block whose rows are not rendered", () => {
    const host = makeHost(4);
    const scroller = document.createElement("div");
    const read = gridReader(scroller);
    expect(
      codeChromeAnchors(
        host,
        scroller,
        [
          { start: 1, end: 2 },
          { start: 20, end: 22 },
        ],
        read,
      ).map((a) => a.start),
    ).toEqual([1]);
  });
});
