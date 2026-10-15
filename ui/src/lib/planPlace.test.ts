import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { SCROLL_OFFSET_TOP } from "$lib/layout.ts";
import { blockIndexForLine, holdPlace, previewTopLine } from "$lib/planPlace.ts";

// happy-dom has no layout, so every rect is stubbed in the viewport space
// getBoundingClientRect reads from.
const rect = (top: number, bottom = top) => new DOMRect(0, top, 0, bottom - top);

const TOP = 100;
const ZONE = TOP + SCROLL_OFFSET_TOP;
const BLOCK = 40;

afterEach(() => {
  document.body.replaceChildren();
});

describe("blockIndexForLine", () => {
  const blocks = [
    { start: 1, end: 3 },
    { start: 5, end: 5 },
    { start: 8, end: 12 },
  ];

  test("returns the block holding the line, on its start, end and inner lines", () => {
    expect(blockIndexForLine(blocks, 1)).toBe(0);
    expect(blockIndexForLine(blocks, 2)).toBe(0);
    expect(blockIndexForLine(blocks, 3)).toBe(0);
    expect(blockIndexForLine(blocks, 10)).toBe(2);
    expect(blockIndexForLine(blocks, 12)).toBe(2);
  });

  test("a one-line block holds its line", () => {
    expect(blockIndexForLine(blocks, 5)).toBe(1);
  });

  test("a line in a gap takes the next block", () => {
    expect(blockIndexForLine(blocks, 4)).toBe(1);
    expect(blockIndexForLine(blocks, 7)).toBe(2);
  });

  test("a line before the first block takes the first", () => {
    expect(blockIndexForLine([{ start: 3, end: 4 }], 1)).toBe(0);
  });

  test("a line past the last block takes the last", () => {
    expect(blockIndexForLine(blocks, 99)).toBe(2);
  });

  test("no blocks gives null", () => {
    expect(blockIndexForLine([], 1) === null).toBe(true);
  });
});

/** A preview of `n` stacked blocks, the first block's top at `firstTop`. Counts
 * every child rect read. */
function preview(n: number, firstTop: number) {
  const box = document.createElement("div");
  const reads = { count: 0 };
  for (let i = 0; i < n; i++) {
    const child = document.createElement("div");
    const top = firstTop + i * BLOCK;
    child.getBoundingClientRect = () => {
      reads.count += 1;
      return rect(top, top + BLOCK);
    };
    box.append(child);
  }
  const blocks = Array.from({ length: n }, (_, i) => ({ start: i * 3 + 1, end: i * 3 + 2 }));
  return { box, blocks, reads };
}

describe("previewTopLine", () => {
  test("returns the start of the block crossing the reading zone, as a linear scan would", () => {
    for (const firstTop of [
      ZONE,
      ZONE - 10,
      ZONE - BLOCK,
      ZONE - BLOCK - 5,
      ZONE - 3 * BLOCK + 1,
    ]) {
      const { box, blocks } = preview(6, firstTop);
      const linear = blocks.find((_, i) => firstTop + (i + 1) * BLOCK > ZONE + 1);
      expect(previewTopLine(TOP, box, blocks)).toBe(linear?.start ?? null);
    }
  });

  test("returns the last block's start when every block sits above the zone", () => {
    const { box, blocks } = preview(4, ZONE - 10 * BLOCK);
    expect(previewTopLine(TOP, box, blocks)).toBe(blocks[3]?.start ?? -1);
  });

  test("returns null with no blocks", () => {
    const { box } = preview(0, 0);
    expect(previewTopLine(TOP, box, [])).toBe(null);
  });

  test("reads at most 11 block rects over a 1,000-block preview", () => {
    const { box, blocks, reads } = preview(1000, ZONE - 500 * BLOCK - 5);
    expect(previewTopLine(TOP, box, blocks)).toBe(blocks[500]?.start ?? -1);
    expect(reads.count).toBeLessThanOrEqual(11);
  });
});

describe("holdPlace", () => {
  /** A hold whose target sits at `targetTop` (mutable) and whose observer the
   * test fires by hand. */
  function arrange() {
    const scroller = document.createElement("div");
    scroller.getBoundingClientRect = () => rect(TOP);
    const content = document.createElement("div");
    const target = document.createElement("div");
    const geo = { targetTop: TOP + 500 };
    target.getBoundingClientRect = () => rect(geo.targetTop - scroller.scrollTop);
    content.append(target);
    scroller.append(content);
    document.body.append(scroller);
    const observer = { fire: () => {}, disconnects: 0, observed: null as Element | null };
    const observe = (el: Element, onResize: () => void) => {
      observer.observed = el;
      observer.fire = onResize;
      return () => {
        observer.disconnects += 1;
      };
    };
    let resolved: Element | null = target;
    const release = holdPlace({ scroller, content, target: () => resolved }, observe);
    return {
      scroller,
      content,
      geo,
      observer,
      release,
      drop: () => {
        resolved = null;
      },
    };
  }

  test("parks the target immediately and watches the content", () => {
    const { scroller, content, observer } = arrange();
    expect(scroller.scrollTop).toBe(500 - SCROLL_OFFSET_TOP);
    expect(observer.observed === content).toBe(true);
  });

  test("re-parks on every content resize", () => {
    const { scroller, geo, observer } = arrange();
    geo.targetTop += 80; // an image above loaded and pushed the target down
    observer.fire();
    expect(scroller.scrollTop).toBe(500 + 80 - SCROLL_OFFSET_TOP);
  });

  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    test(`a reader's ${type} releases the hold`, () => {
      const { scroller, geo, observer } = arrange();
      document.dispatchEvent(new Event(type));
      expect(observer.disconnects).toBe(1);
      geo.targetTop += 80;
      observer.fire();
      expect(scroller.scrollTop).toBe(500 - SCROLL_OFFSET_TOP);
    });
  }

  test("releases itself when the content is detached", () => {
    const { scroller, content, observer } = arrange();
    content.remove();
    const before = scroller.scrollTop;
    observer.fire();
    expect(observer.disconnects).toBe(1);
    expect(scroller.scrollTop).toBe(before);
  });

  test("releases itself when the target no longer resolves", () => {
    const { observer, drop } = arrange();
    drop();
    observer.fire();
    expect(observer.disconnects).toBe(1);
  });

  test("an observer that fires during observe releases cleanly when the target is gone", () => {
    const scroller = document.createElement("div");
    const content = document.createElement("div");
    scroller.append(content);
    document.body.append(scroller);
    let disconnects = 0;
    const observe = (_el: Element, onResize: () => void) => {
      onResize();
      return () => {
        disconnects += 1;
      };
    };
    holdPlace({ scroller, content, target: () => null }, observe);
    expect(disconnects).toBe(1);
  });

  test("a second release is harmless and disconnects once", () => {
    const { observer, release } = arrange();
    release();
    release();
    document.dispatchEvent(new Event("wheel"));
    expect(observer.disconnects).toBe(1);
  });
});
