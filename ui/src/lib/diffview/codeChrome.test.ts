import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { fillLines, scrolledOffsetReader } from "@ui/support/diffview-dom.ts";
import { CARD_ATTR, REFLOW_ATTR } from "$lib/diffview/codeBlockScroll.ts";
import {
  codeBlockAtPoint,
  codeChromeAnchors,
  previewCodeBlockAtPoint,
  previewCodeChromeAnchors,
} from "$lib/diffview/codeChrome.ts";
import type { RectReader } from "$lib/geometry.ts";
import { renderPlanMarkdown } from "$lib/planMarkdown.ts";

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

/** Moves lines `start`..`end` into a card, as codeBlockScroll.ts does for every block —
 * the shape that makes the block's rows non-direct children. Returns the card. */
function wrapInCard(host: HTMLElement, start: number, end: number): HTMLElement {
  const content = host.shadowRoot?.querySelector("[data-content]") as HTMLElement;
  const rows = [];
  for (let n = start; n <= end; n++) {
    rows.push(content.querySelector(`[data-line="${n}"]`) as HTMLElement);
  }
  const card = document.createElement("div");
  card.setAttribute(CARD_ATTR, String(start));
  content.insertBefore(card, rows[0] ?? null);
  for (const row of rows) card.appendChild(row);
  return card;
}

function stubWidths(el: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
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

  test("hits a carded block through its card", () => {
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
      { start: 1, top: 0, left: 300, wrappable: false },
      { start: 6, top: 50, left: 300, wrappable: false },
    ]);
  });

  test("accounts for the scroller's viewport offset and scroll", () => {
    const host = makeHost(5);
    const scroller = document.createElement("div");
    const read = scrolledOffsetReader(scroller);
    // top = 100 - (5 - 50) = 145 ; left = 300 - (8 - 10) = 302
    expect(codeChromeAnchors(host, scroller, [{ start: 1, end: 3 }], read)).toEqual([
      { start: 1, top: 145, left: 302, wrappable: false },
    ]);
  });

  test("anchors a carded block to its card's visible edge, not its max-content row", () => {
    const host = makeHost(8);
    wrapInCard(host, 2, 4);
    const scroller = document.createElement("div");
    expect(
      codeChromeAnchors(host, scroller, [{ start: 2, end: 4 }], gridReader(scroller)).map(
        ({ top, left }) => ({ top, left }),
      ),
    ).toEqual([{ top: 10, left: 250 }]);
  });

  test("offers the wrap on a card that overflows or is wrapped, not on one that fits", () => {
    const host = makeHost(10);
    const wide = wrapInCard(host, 1, 3);
    const fits = wrapInCard(host, 6, 8);
    stubWidths(wide, 500, 200);
    stubWidths(fits, 200, 200);
    const scroller = document.createElement("div");
    const ranges = [
      { start: 1, end: 3 },
      { start: 6, end: 8 },
    ];
    const wrappable = () =>
      codeChromeAnchors(host, scroller, ranges, gridReader(scroller)).map((a) => a.wrappable);
    expect(wrappable()).toEqual([true, false]);
    fits.setAttribute(REFLOW_ATTR, "");
    expect(wrappable()).toEqual([true, true]);
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

describe("preview code chrome", () => {
  // Two fences: the first opens on line 3, the second on line 8.
  const PLAN = ["intro", "", "```ts", "a", "```", "", "between", "```", "b", "```", ""].join("\n");

  function mountPreview(): { root: HTMLElement; pres: HTMLElement[] } {
    const root = document.createElement("div");
    root.innerHTML = renderPlanMarkdown(PLAN).html;
    document.body.append(root);
    const pres = [...root.querySelectorAll<HTMLElement>("pre")];
    return { root, pres };
  }

  // The first pre spans y [10,30], the second y [50,70], both x [100,300].
  function previewReader(pres: readonly Element[], scroller: HTMLElement): RectReader {
    return (el) => {
      if (el === scroller) return { top: 5, bottom: 1000, left: 8, right: 400 };
      const i = pres.indexOf(el);
      return { top: 10 + i * 40, bottom: 30 + i * 40, left: 100, right: 300 };
    };
  }

  test("anchors each block at its pre's top-right in scrolled scroller content coords", () => {
    const { root, pres } = mountPreview();
    const scroller = document.createElement("div");
    scroller.scrollTop = 50;
    scroller.scrollLeft = 10;
    for (const pre of pres) stubWidths(pre, 100, 100);
    const read = previewReader(pres, scroller);
    // top = 10 - (5 - 50) = 55 ; left = 300 - (8 - 10) = 302
    expect(previewCodeChromeAnchors(root, scroller, new Set(), read)).toEqual([
      { start: 3, top: 55, left: 302, wrappable: false, text: "a" },
      { start: 8, top: 95, left: 302, wrappable: false, text: "b" },
    ]);
    root.remove();
  });

  test("offers the wrap on an overflowing block and a wrapped one, not a fitting one", () => {
    const { root, pres } = mountPreview();
    const scroller = document.createElement("div");
    stubWidths(pres[0]!, 500, 200);
    stubWidths(pres[1]!, 200, 200);
    const read = previewReader(pres, scroller);
    const wrappable = (reflowed: ReadonlySet<number>) =>
      previewCodeChromeAnchors(root, scroller, reflowed, read).map((a) => a.wrappable);
    expect(wrappable(new Set())).toEqual([true, false]);
    expect(wrappable(new Set([8]))).toEqual([true, true]);
    root.remove();
  });

  function previewTexts(plan: string): (string | undefined)[] {
    const root = document.createElement("div");
    root.innerHTML = renderPlanMarkdown(plan).html;
    const scroller = document.createElement("div");
    return previewCodeChromeAnchors(root, scroller, new Set()).map((a) => a.text);
  }

  test("carries the block's own text when it quotes a shorter fence", () => {
    const plan = ["````md", "```ts", "const a = 1;", "```", "````", ""].join("\n");
    expect(previewTexts(plan)).toEqual(["```ts\nconst a = 1;\n```"]);
  });

  test("carries a list-nested block's text de-indented", () => {
    const plan = ["- item", "", "  ```", "  x", "  y", "  ```", ""].join("\n");
    expect(previewTexts(plan)).toEqual(["x\ny"]);
  });

  test("hits the block under the point, and nothing between blocks", () => {
    const { root, pres } = mountPreview();
    const read = previewReader(pres, document.createElement("div"));
    expect(previewCodeBlockAtPoint(root, 150, 60, read)).toBe(8);
    expect(previewCodeBlockAtPoint(root, 150, 40, read)).toBeUndefined();
    root.remove();
  });
});
