import { describe, expect, test } from "bun:test";

import { createPreviewCursor, type PreviewCursorStore } from "@/state/previewCursor.ts";
import { type CommentStop, deriveStops, type FocusedStop } from "$lib/diffview/commentStops.ts";
import type { CursorPlacement } from "$lib/diffview/types.ts";
import { type SlotGap, slotRanks } from "$lib/previewComments.ts";
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
  over: {
    seed?: TextPoint | null;
    empty?: boolean;
    noRange?: boolean;
    stops?: CommentStop[];
    focused?: FocusedStop | null;
    ranks?: ReturnType<typeof slotRanks>;
  } = {},
) {
  let focusedStop = over.focused ?? null;
  const followedStops: CommentStop[] = [];
  const lines = VISUAL.slice(0, over.empty ? 0 : VISUAL.length);
  const indexOf = (p: TextPoint) =>
    lines.findIndex((v) => v.line === p.line && v.column === p.column);
  const steps: number[] = [];
  const follows: TextPoint[] = [];
  const jumps: TextPoint[] = [];
  const places: Array<[TextPoint, CursorPlacement]> = [];
  const seeds = { count: 0 };
  const selections: [TextPoint, TextPoint][] = [];
  const comments: Range[] = [];
  const opened: [number, number][] = [];
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
    place: (p, where) => places.push([p, where]),
    selection: (from, to) => {
      selections.push([from, to]);
      return over.noRange ? null : range;
    },
    comment: (r) => comments.push(r),
    openComposer: (start, end) => opened.push([start, end]),
    sound: (e) => sounds.push(e),
    stops: () => over.stops ?? [],
    focusedStop: () => focusedStop,
    setFocusedStop: (s) => {
      focusedStop = s;
    },
    followStop: (s) => followedStops.push(s),
    slotOf: over.ranks ? over.ranks.slotAt : (p) => blockOf(p.line),
    slotEdge: (slot, edge) => {
      const gap = over.ranks?.gapOf(slot);
      if (gap !== undefined && "before" in gap)
        return edge === "first-after" ? gap.before : (lines[indexOf(gap.before) - 1] ?? null);
      const block = gap?.block ?? slot;
      return edge === "first-after"
        ? (lines.find((v) => blockOf(v.line) > block) ?? null)
        : (lines.findLast((v) => blockOf(v.line) === block) ?? null);
    },
  });
  return {
    cursor,
    steps,
    follows,
    jumps,
    places,
    seeds,
    selections,
    comments,
    opened,
    sounds,
    range,
    followedStops,
    focused: () => focusedStop,
  };
}

// Blocks start on lines 1, 3, 6 and 7, so a line's block is its slot.
const BLOCK_STARTS = [1, 3, 6, 7];
const blockOf = (line: number) =>
  Math.max(
    0,
    BLOCK_STARTS.findLastIndex((start) => start <= line),
  );

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

describe("comment stops", () => {
  // Two comments end on different lines of the paragraph block (slot 1); one ends on the
  // last line.
  const STOPS = deriveStops(
    [
      { line: 3, annotations: [{ id: "a", startLine: 3, endLine: 3 }] },
      { line: 4, annotations: [{ id: "b", startLine: 4, endLine: 4 }] },
      { line: 8, annotations: [{ id: "c", startLine: 8, endLine: 8 }] },
    ],
    [],
    blockOf,
  );
  const onStop = (id: string, line: number): FocusedStop => ({
    ref: { kind: "comment", id },
    line,
  });

  test("j off a block's last visual line lands on the block's first comment", () => {
    const h = build(placed(at(3)), { stops: STOPS });
    h.cursor.moveCursor("down");
    expect(h.focused()).toEqual(onStop("a", 3));
    expect(h.followedStops.map((s) => s.ref)).toEqual([{ kind: "comment", id: "a" }]);
  });

  test("j within a block passes no comment", () => {
    const store = placed(at(1));
    const h = build(store, { stops: STOPS });
    h.cursor.moveCursor("down");
    expect(h.focused() === null).toBe(true);
    expect(store.cursorPoint).toEqual(at(2));
  });

  test("k from the next block lands on the block's last comment", () => {
    const h = build(placed(at(4)), { stops: STOPS });
    h.cursor.moveCursor("up");
    expect(h.focused()).toEqual(onStop("b", 4));
  });

  test("j and k step between a block's comments, then leave them for its edges", () => {
    const store = placed(at(1));
    store.cursorLine = 3;
    const h = build(store, { stops: STOPS, focused: onStop("a", 3) });
    h.cursor.moveCursor("down");
    expect(h.focused()).toEqual(onStop("b", 4));
    h.cursor.moveCursor("down");
    expect(h.focused() === null).toBe(true);
    expect(store.cursorPoint).toEqual(at(4));

    const back = placed(at(1));
    const k = build(back, { stops: STOPS, focused: onStop("a", 3) });
    k.cursor.moveCursor("up");
    expect(k.focused() === null).toBe(true);
    expect(back.cursorPoint).toEqual(at(3));
  });

  test("a comment on the last line is reachable, and j stays on it", () => {
    const h = build(placed(at(6)), { stops: STOPS });
    h.cursor.moveCursor("down");
    expect(h.focused()).toEqual(onStop("c", 8));
    h.cursor.moveCursor("down");
    expect(h.focused()).toEqual(onStop("c", 8));
  });

  test("j in visual mode passes over comments", () => {
    const store = { ...placed(at(3)), visualAnchor: 3, visualAnchorPoint: at(1) };
    const h = build(store, { stops: STOPS });
    h.cursor.moveCursor("down");
    expect(h.focused() === null).toBe(true);
    expect(store.cursorPoint).toEqual(at(4));
  });

  test("G leaves a hovered comment for a line", () => {
    const h = build(placed(at(1)), { stops: STOPS, focused: onStop("a", 3) });
    h.cursor.moveCursor("bottom");
    expect(h.focused() === null).toBe(true);
  });

  test("V on a hovered comment anchors at its last line and leaves it", () => {
    const store = placed(at(0));
    const h = build(store, { stops: STOPS, focused: onStop("b", 4) });
    h.cursor.enterVisualMode();
    expect(store.visualAnchor).toBe(4);
    expect(h.focused() === null).toBe(true);
  });

  test("landOnLine leaves the hovered comment and places the line's point", () => {
    const store = placed(at(0));
    const h = build(store, { stops: STOPS, focused: onStop("a", 3) });
    h.cursor.landOnLine(6);
    expect(h.focused() === null).toBe(true);
    expect(store.cursorPoint).toEqual(at(4));
  });

  test("]c and [c jump from the cursor's block to the comments around it", () => {
    const h = build(placed(at(4)), { stops: STOPS });
    h.cursor.stepComment(1);
    expect(h.focused()).toEqual(onStop("c", 8));

    const k = build(placed(at(4)), { stops: STOPS });
    k.cursor.stepComment(-1);
    expect(k.focused()).toEqual(onStop("b", 4));
  });

  test("[c from the first comment wraps to the last", () => {
    const h = build(placed(at(1)), { stops: STOPS, focused: onStop("a", 3) });
    h.cursor.stepComment(-1);
    expect(h.focused()).toEqual(onStop("c", 8));
  });

  test("]c with no comments leaves the cursor where it is", () => {
    const store = placed(at(1));
    const h = build(store, { stops: [] });
    h.cursor.stepComment(1);
    expect(h.focused() === null).toBe(true);
    expect(store.cursorPoint).toEqual(at(1));
  });

  test("placeOnStop exits visual mode and puts the cursor on the stop's line", () => {
    const store = { ...placed(at(0)), visualAnchor: 1, visualAnchorPoint: at(0) };
    const h = build(store, { stops: STOPS });
    h.cursor.placeOnStop(STOPS[2] as CommentStop);
    expect(store.visualAnchor === null).toBe(true);
    expect(store.cursorLine).toBe(8);
    expect(h.focused()).toEqual(onStop("c", 8));
  });

  test("a motion after enterStop resolves from the stop's line, without following it", () => {
    const store = placed(at(0));
    const h = build(store, { stops: STOPS });
    h.cursor.enterStop(STOPS[0] as CommentStop);
    expect(h.followedStops).toEqual([]);
    h.cursor.moveCursor("nextBlank");
    expect(store.cursorPoint).toEqual(at(4));
  });
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

describe("comment stops at a gap inside a block", () => {
  // The comment on line 3 opens its gap before the paragraph's second row, 3:10; the one
  // on 8 after the last block.
  const GAPS = new Map<number, SlotGap>([
    [3, { before: at(2) }],
    [8, { block: 3 }],
  ]);
  const ranks = slotRanks(
    BLOCK_STARTS.map((start, i) => ({ start, end: (BLOCK_STARTS[i + 1] ?? 9) - 1 })),
    GAPS,
  );
  const STOPS = deriveStops(
    [
      { line: 3, annotations: [{ id: "m", startLine: 3, endLine: 3 }] },
      { line: 8, annotations: [{ id: "c", startLine: 8, endLine: 8 }] },
    ],
    [],
    ranks.slotOf,
  );
  const onM: FocusedStop = { ref: { kind: "comment", id: "m" }, line: 3 };
  const build2 = (store: PreviewCursorStore, focused: FocusedStop | null = null) =>
    build(store, { stops: STOPS, focused, ranks });

  test("j onto the row above the gap's lands on its comment, and k back from below", () => {
    const down = build2(placed(at(1)));
    down.cursor.moveCursor("down");
    expect(down.focused()).toEqual(onM);

    const up = build2(placed(at(2)));
    up.cursor.moveCursor("up");
    expect(up.focused()).toEqual(onM);
  });

  test("j and k between the rows below the gap pass no comment", () => {
    const store = placed(at(3));
    const h = build2(store);
    h.cursor.moveCursor("up");
    expect(h.focused() === null).toBe(true);
    expect(store.cursorPoint).toEqual(at(2));
    h.cursor.moveCursor("down");
    expect(h.focused() === null).toBe(true);
    expect(store.cursorPoint).toEqual(at(3));
  });

  test("j off the comment lands on the row below its gap, k on the row above", () => {
    const below = placed(at(0));
    build2(below, onM).cursor.moveCursor("down");
    expect(below.cursorPoint).toEqual(at(2));

    const above = placed(at(0));
    build2(above, onM).cursor.moveCursor("up");
    expect(above.cursorPoint).toEqual(at(1));
  });

  test("]c and [c count the gap from where it opens", () => {
    const fromAbove = build2(placed(at(1)));
    fromAbove.cursor.stepComment(1);
    expect(fromAbove.focused()).toEqual(onM);

    const fromBelow = build2(placed(at(2)));
    fromBelow.cursor.stepComment(1);
    expect(fromBelow.focused()?.ref).toEqual({ kind: "comment", id: "c" });

    const back = build2(placed(at(2)));
    back.cursor.stepComment(-1);
    expect(back.focused()).toEqual(onM);
  });
});

describe("c and V on a hovered stop", () => {
  const STOPS = deriveStops(
    [{ line: 4, annotations: [{ id: "a", startLine: 3, endLine: 4 }] }],
    [{ key: "k", startLine: 3, endLine: 4 }],
    blockOf,
  );
  const comment: FocusedStop = { ref: { kind: "comment", id: "a" }, line: 4 };
  const resume: FocusedStop = { ref: { kind: "resume", key: "k" }, line: 4 };

  test("c on a comment opens the composer over its anchored lines", () => {
    const h = build(placed(at(1)), { stops: STOPS, focused: comment });
    h.cursor.comment();
    expect(h.opened).toEqual([[3, 4]]);
    expect(h.comments).toEqual([]);
  });

  test("c on a Resume marker opens nothing", () => {
    const h = build(placed(at(1)), { stops: STOPS, focused: resume });
    h.cursor.comment();
    expect(h.opened).toEqual([]);
    expect(h.comments).toEqual([]);
  });

  test("V on a Resume marker does nothing", () => {
    const store = placed(at(1));
    const h = build(store, { stops: STOPS, focused: resume });
    h.cursor.enterVisualMode();
    expect(store.visualAnchor).toBeNull();
    expect(h.focused()).toEqual(resume);
  });
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

describe("scrollCursor", () => {
  test("places the cursor's point, leaving the cursor and anchor unchanged", () => {
    const p = { line: 4, column: 17 };
    const anchor = { line: 3, column: 0 };
    const store: PreviewCursorStore = {
      cursorLine: 4,
      cursorPoint: p,
      visualAnchor: 3,
      visualAnchorPoint: anchor,
    };
    const h = build(store);
    h.cursor.scrollCursor("bottom");
    expect(h.places).toEqual([[p, "bottom"]]);
    expect(store).toEqual({
      cursorLine: 4,
      cursorPoint: p,
      visualAnchor: 3,
      visualAnchorPoint: anchor,
    });
  });

  test("a blank-line cursor places the next text line's point and keeps its line", () => {
    const store: PreviewCursorStore = { ...unplaced(), cursorLine: 5 };
    const h = build(store);
    h.cursor.scrollCursor("center");
    expect(h.places).toEqual([[at(4), "center"]]);
    expect(store.cursorLine).toBe(5);
  });

  test("an unplaced cursor lands on the seed, then places it", () => {
    const seed = { line: 9, column: 0 };
    const store = unplaced();
    const h = build(store, { seed });
    h.cursor.scrollCursor("top");
    expect(store.cursorLine).toBe(9);
    expect(store.cursorPoint).toEqual(seed);
    expect(h.places).toEqual([[seed, "top"]]);
  });

  test("with nothing to seed it does nothing", () => {
    const store = unplaced();
    const h = build(store, { seed: null });
    h.cursor.scrollCursor("center");
    expect(h.places).toEqual([]);
    expect(h.follows).toEqual([]);
    expect(store.cursorLine).toBe(null);
  });
});
