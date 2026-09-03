import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { fillLines, scrolledOffsetReader } from "@ui/test-diffview-dom.ts";
import { codeBlockAtPoint, copyAnchor, type RectReader } from "$lib/diffview/codeCopy.ts";

// A host with a shadow root of [data-content] > [data-line] rows, matching the
// @pierre/diffs structure codeCopy reads.
function makeHost(lineCount: number): HTMLElement {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  fillLines(content, lineCount);
  root.appendChild(content);
  return host;
}

// Lays each row on a vertical grid: row n spans y [ (n-1)*10, n*10 ], x [100, 300].
function gridReader(scroller: HTMLElement): RectReader {
  return (el) => {
    if (el === scroller) return { top: 0, bottom: 1000, left: 0, right: 400 };
    const n = Number(el.getAttribute("data-line"));
    return { top: (n - 1) * 10, bottom: n * 10, left: 100, right: 300 };
  };
}

describe("codeBlockAtPoint", () => {
  test("returns the block whose row span contains the point", () => {
    const host = makeHost(8);
    // Rows 2-4 span y [10,40]; point (150, 25) is inside, x within [100,300].
    expect(codeBlockAtPoint(host, [{ start: 2, end: 4 }], 150, 25, gridReader(host))).toEqual({
      start: 2,
      end: 4,
    });
  });

  test("returns null above the block and right of the column", () => {
    const host = makeHost(8);
    const read = gridReader(host);
    expect(codeBlockAtPoint(host, [{ start: 2, end: 4 }], 150, 5, read)).toBeNull();
    expect(codeBlockAtPoint(host, [{ start: 2, end: 4 }], 350, 25, read)).toBeNull();
  });

  test("selects the block the point is in when several exist", () => {
    const host = makeHost(10);
    const ranges = [
      { start: 1, end: 3 },
      { start: 6, end: 8 },
    ];
    // y=65 is within rows 6-8 (y [50,80]).
    expect(codeBlockAtPoint(host, ranges, 150, 65, gridReader(host))).toEqual({ start: 6, end: 8 });
  });
});

describe("copyAnchor", () => {
  test("returns the opening row's top-right in scroller content coords", () => {
    const host = makeHost(5);
    const scroller = document.createElement("div");
    const read: RectReader = (el) =>
      el === scroller
        ? { top: 0, bottom: 1000, left: 0, right: 400 }
        : (() => {
            const n = Number(el.getAttribute("data-line"));
            return { top: (n - 1) * 10, bottom: n * 10, left: 100, right: 300 };
          })();
    // Block opens at line 3: row top=20, right=300; scroller at origin, unscrolled.
    expect(copyAnchor(host, scroller, { start: 3, end: 5 }, read)).toEqual({ top: 20, left: 300 });
  });

  test("accounts for the scroller's viewport offset and scroll", () => {
    const host = makeHost(5);
    const scroller = document.createElement("div");
    const read = scrolledOffsetReader(scroller);
    // top = 100 - (5 - 50) = 145 ; left = 300 - (8 - 10) = 302
    expect(copyAnchor(host, scroller, { start: 1, end: 3 }, read)).toEqual({ top: 145, left: 302 });
  });
});
