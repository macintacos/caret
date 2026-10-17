import { describe, expect, test } from "bun:test";

import { createPreviewCursor, type PreviewCursorStore } from "@/state/previewCursor.ts";
import type { TextPoint } from "$lib/previewLines.ts";
import type { SoundEvent } from "$lib/sound.ts";

// Headings on 1 and 6, blanks on 2, 5 and 7; the paragraph 3–4 starts with a line that
// wraps once, and so does the body on 8.
const TEXT = "# A\n\npara one long\npara cont\n\n## B\n\nbody text\n";
const VISUAL: TextPoint[] = [
  { line: 1, column: 0 },
  { line: 3, column: 0 },
  { line: 3, column: 10 },
  { line: 4, column: 0 },
  { line: 6, column: 0 },
  { line: 8, column: 0 },
  { line: 8, column: 5 },
];

const at = (i: number): TextPoint => VISUAL[i] as TextPoint;

/** Fake geometry over VISUAL: a step moves through the list, a line maps to the first
 * visual line at or after it (a blank renders nothing). */
function build(
  store: PreviewCursorStore,
  over: { seed?: TextPoint | null; empty?: boolean; noRange?: boolean } = {},
) {
  const lines = VISUAL.slice(0, over.empty ? 0 : VISUAL.length);
  const indexOf = (p: TextPoint) =>
    lines.findIndex((v) => v.line === p.line && v.column === p.column);
  const steps: number[] = [];
  const follows: TextPoint[] = [];
  const jumps: TextPoint[] = [];
  const seeds = { count: 0 };
  const selections: [TextPoint, TextPoint][] = [];
  const comments: Range[] = [];
  const sounds: SoundEvent[] = [];
  const range = {} as Range;
  const cursor = createPreviewCursor(store, {
    lines: () => TEXT.split("\n"),
    headingLines: () => [1, 6],
    halfPage: () => 3,
    seed: () => {
      seeds.count++;
      return over.seed === undefined ? at(2) : over.seed;
    },
    step: (from, count) => {
      steps.push(count);
      return lines[Math.min(Math.max(indexOf(from) + count, 0), lines.length - 1)] as TextPoint;
    },
    pointForLine: (line) => lines.find((v) => v.line >= line) ?? null,
    last: () => lines.at(-1) ?? null,
    follow: (p) => follows.push(p),
    jump: (p) => jumps.push(p),
    selection: (from, to) => {
      selections.push([from, to]);
      return over.noRange ? null : range;
    },
    comment: (r) => comments.push(r),
    sound: (e) => sounds.push(e),
  });
  return { cursor, steps, follows, jumps, seeds, selections, comments, sounds, range };
}

const unplaced = (): PreviewCursorStore => ({
  cursorLine: null,
  cursorPoint: null,
  visualAnchor: null,
  visualAnchorPoint: null,
});
const placed = (p: TextPoint): PreviewCursorStore => ({
  ...unplaced(),
  cursorLine: p.line,
  cursorPoint: p,
});

describe("placeAt", () => {
  test("places the cursor on the point and follows it", () => {
    const store = unplaced();
    const h = build(store);
    const p = { line: 3, column: 7 };
    h.cursor.placeAt(p);
    expect(store.cursorLine).toBe(3);
    expect(store.cursorPoint).toEqual(p);
    expect(h.follows).toEqual([p]);
    expect(h.cursor.point()).toEqual(p);
  });
});

describe("an unplaced cursor", () => {
  for (const motion of ["down", "up", "halfDown", "halfUp"] as const) {
    test(`${motion} reveals at the reading position without stepping`, () => {
      const store = unplaced();
      const h = build(store);
      h.cursor.moveCursor(motion);
      expect(store.cursorPoint).toEqual(at(2));
      expect(h.steps).toEqual([]);
    });
  }

  test("stays unplaced when there is no reading position", () => {
    const store = unplaced();
    build(store, { seed: null }).cursor.moveCursor("down");
    expect(store.cursorLine).toBe(null);
  });
});

test("j/k step one visual line and Ctrl+d/Ctrl+u a half page", () => {
  const store = placed(at(3));
  const h = build(store);
  for (const m of ["down", "up", "halfDown", "halfUp"] as const) h.cursor.moveCursor(m);
  expect(h.steps).toEqual([1, -1, 3, -3]);
});

test("j moves onto the wrapped half of a line, keeping cursorLine on its source line", () => {
  const store = placed(at(1));
  build(store).cursor.moveCursor("down");
  expect(store.cursorPoint).toEqual(at(2));
  expect(store.cursorLine).toBe(3);
});

test("gg lands on the first line and G on the last visual line", () => {
  const store = placed(at(3));
  const h = build(store);
  h.cursor.moveCursor("top");
  expect(store.cursorPoint).toEqual(at(0));
  h.cursor.moveCursor("bottom");
  expect(store.cursorPoint).toEqual(at(6));
});

test("]] and [[ land on the next and previous heading and take the jump", () => {
  const store = placed(at(2));
  const h = build(store);
  h.cursor.moveCursor("nextHeading");
  expect(store.cursorPoint).toEqual(at(4));
  h.cursor.moveCursor("prevHeading");
  expect(store.cursorPoint).toEqual(at(0));
  expect(h.jumps).toEqual([at(4), at(0)]);
  expect(h.follows).toEqual([]);
});

test("every other motion takes the follow scroll", () => {
  const store = placed(at(1));
  const h = build(store);
  for (const m of ["down", "nextBlank", "top", "bottom", "prevBlank"] as const)
    h.cursor.moveCursor(m);
  expect(h.follows.length).toBe(5);
  expect(h.jumps).toEqual([]);
});

describe("paragraph motions", () => {
  test("} lands on the next paragraph's start", () => {
    const store = placed(at(2));
    build(store).cursor.moveCursor("nextBlank");
    expect(store.cursorPoint).toEqual(at(4));
  });

  test("{ inside a paragraph lands on its start", () => {
    const store = placed(at(3));
    build(store).cursor.moveCursor("prevBlank");
    expect(store.cursorPoint).toEqual(at(1));
  });

  test("{ at a paragraph's start lands on the previous paragraph's start", () => {
    const store = placed(at(4));
    build(store).cursor.moveCursor("prevBlank");
    expect(store.cursorPoint).toEqual(at(1));
  });

  test("{ at the first paragraph stays put", () => {
    const store = placed(at(0));
    const h = build(store);
    h.cursor.moveCursor("prevBlank");
    expect(store.cursorPoint).toEqual(at(0));
    expect(h.follows).toEqual([]);
  });

  test("} in the last paragraph stays put", () => {
    const store = placed(at(5));
    build(store).cursor.moveCursor("nextBlank");
    expect(store.cursorPoint).toEqual(at(5));
  });
});

test("no motion lands behind its direction", () => {
  const forward = ["down", "halfDown", "nextHeading", "nextBlank", "bottom"] as const;
  const backward = ["up", "halfUp", "prevHeading", "prevBlank", "top"] as const;
  const order = (p: TextPoint | null) =>
    p == null ? -1 : VISUAL.findIndex((v) => v.line === p.line && v.column === p.column);
  for (let i = 0; i < VISUAL.length; i++) {
    for (const m of forward) {
      const store = placed(at(i));
      build(store).cursor.moveCursor(m);
      expect(order(store.cursorPoint)).toBeGreaterThanOrEqual(i);
    }
    for (const m of backward) {
      const store = placed(at(i));
      build(store).cursor.moveCursor(m);
      expect(order(store.cursorPoint)).toBeLessThanOrEqual(i);
    }
  }
});

test("an empty preview leaves the cursor unchanged", () => {
  const store = unplaced();
  const h = build(store, { empty: true, seed: null });
  for (const m of ["top", "bottom", "nextHeading", "nextBlank"] as const) h.cursor.moveCursor(m);
  expect(store).toEqual(unplaced());
  expect(h.follows).toEqual([]);
});

test("a placed heading or paragraph motion never reads the reading position", () => {
  const store = placed(at(2));
  const h = build(store);
  for (const m of ["nextHeading", "prevHeading", "nextBlank", "prevBlank"] as const)
    h.cursor.moveCursor(m);
  expect(h.seeds.count).toBe(0);
});

test("reset() drops the column, so a return to its line starts at the line's start", () => {
  const store = placed(at(2));
  const h = build(store);
  h.cursor.reset();
  expect(store.cursorPoint).toBe(null);
  expect(h.cursor.point()).toEqual(at(1));
});

describe("point()", () => {
  test("is the stored point while it sits on cursorLine", () => {
    expect(build(placed(at(2))).cursor.point()).toEqual(at(2));
  });

  test("resolves a cursorLine moved elsewhere to that line's start", () => {
    const store: PreviewCursorStore = { ...unplaced(), cursorLine: 8, cursorPoint: at(2) };
    expect(build(store).cursor.point()).toEqual(at(5));
  });

  test("is null when unplaced", () => {
    expect(build(unplaced()).cursor.point()).toBe(null);
  });
});

describe("visual mode and keyboard comments", () => {
  test("V on a placed cursor anchors at its point, follows it and plays visualEntered", () => {
    const store = placed(at(2));
    const h = build(store);
    h.cursor.enterVisualMode();
    expect(store.visualAnchor).toBe(3);
    expect(store.visualAnchorPoint).toEqual(at(2));
    expect(h.follows).toEqual([at(2)]);
    expect(h.sounds).toEqual(["visualEntered"]);
  });

  test("V on an unplaced cursor places it at the reading position and anchors there", () => {
    const store = unplaced();
    build(store).cursor.enterVisualMode();
    expect(store.cursorLine).toBe(3);
    expect(store.cursorPoint).toEqual(at(2));
    expect(store.visualAnchorPoint).toEqual(at(2));
  });

  test("V with nothing to seed changes nothing and plays nothing", () => {
    const store = unplaced();
    const h = build(store, { seed: null });
    h.cursor.enterVisualMode();
    expect(store).toEqual(unplaced());
    expect(h.sounds).toEqual([]);
  });

  test("V again exits visual mode and plays visualExited", () => {
    const store = placed(at(2));
    const h = build(store);
    h.cursor.enterVisualMode();
    h.cursor.enterVisualMode();
    expect(store.visualAnchor).toBe(null);
    expect(h.sounds).toEqual(["visualEntered", "visualExited"]);
  });

  test("anchor() is null outside visual mode", () => {
    expect(build(placed(at(2))).cursor.anchor()).toBe(null);
  });

  test("anchor() stays on the point V anchored at as the cursor moves", () => {
    const h = build(placed(at(2)));
    h.cursor.enterVisualMode();
    h.cursor.moveCursor("down");
    expect(h.cursor.anchor()).toEqual(at(2));
    expect(h.cursor.point()).toEqual(at(3));
  });

  test("an anchor whose point is not on its line reads as that line's start", () => {
    for (const visualAnchorPoint of [null, at(2)]) {
      const store = { ...placed(at(6)), visualAnchor: 6, visualAnchorPoint };
      expect(build(store).cursor.anchor()).toEqual(at(4));
    }
  });

  test("c outside visual mode comments on the cursor's visual line", () => {
    const h = build(placed(at(2)));
    h.cursor.comment();
    expect(h.selections).toEqual([[at(2), at(2)]]);
    expect(h.comments).toEqual([h.range]);
  });

  test("c on an unplaced cursor comments on the reading position's line", () => {
    const h = build(unplaced());
    h.cursor.comment();
    expect(h.selections).toEqual([[at(2), at(2)]]);
  });

  test("c in visual mode comments on the selection and exits silently", () => {
    const store = placed(at(3));
    const h = build(store);
    h.cursor.enterVisualMode();
    h.cursor.moveCursor("up");
    h.cursor.comment();
    expect(h.selections).toEqual([[at(2), at(3)]]);
    expect(h.comments).toEqual([h.range]);
    expect(store.visualAnchor).toBe(null);
    expect(h.sounds).toEqual(["visualEntered"]);
  });

  test("c with nothing to select opens no composer but still exits visual mode", () => {
    const store = placed(at(2));
    const h = build(store, { noRange: true });
    h.cursor.enterVisualMode();
    h.cursor.comment();
    expect(h.comments).toEqual([]);
    expect(store.visualAnchor).toBe(null);
  });

  test("reset() drops the anchor's column too", () => {
    const store = placed(at(2));
    const h = build(store);
    h.cursor.enterVisualMode();
    h.cursor.reset();
    expect(store.visualAnchorPoint).toBe(null);
  });
});
