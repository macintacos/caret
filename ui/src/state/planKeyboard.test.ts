import "@ui/test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import { createPlanKeyboard, type PlanKeyboardStore } from "@/state/planKeyboard.svelte.ts";
import type { CursorMotion } from "$lib/diffview/lineCursor.ts";

// A plan whose lines carry known "alpha" matches: line 3 has two, line 5 has one
// (the same fixture DiffPlanView.test.ts uses to prove the "1/3" counter). Split on
// "\n" yields 6 entries — the trailing newline leaves a final "" that is not a match.
const PLAN = "# Title\n\nalpha beta alpha\n\nalpha gamma\n";

function makeStore(over: Partial<PlanKeyboardStore> = {}): PlanKeyboardStore {
  return {
    cursorLine: null,
    visualAnchor: null,
    searchOpen: false,
    searchCommitted: false,
    searchQuery: "",
    searchIndex: -1,
    lastQuery: "",
    searchClosing: false,
    ...over,
  };
}

/** Fake deps around a mutable text/reading/hints control surface, capturing the
 * effects (follow and jump lines, focus/blur counts) and the scheduled close timers
 * so a test can fire them by hand — no real DOM, no real setTimeout. */
function build(
  store: PlanKeyboardStore,
  over: {
    text?: string;
    reading?: number | null;
    hints?: boolean;
    headings?: number[];
    halfPage?: number;
  } = {},
) {
  let text = over.text ?? "";
  let reading: number | null = over.reading ?? null;
  let hints = over.hints ?? true;
  const headings = over.headings ?? [];
  const halfPage = over.halfPage ?? 5;
  const followed: number[] = [];
  const jumped: number[] = [];
  const composerOpens: Array<{ startLine: number; endLine: number }> = [];
  const scheduled: Array<{ fn: () => void; handle: number }> = [];
  let nextHandle = 1;
  let focused = 0;
  let blurred = 0;

  const keyboard = createPlanKeyboard(store, {
    lines: () => text.split("\n"),
    headingLines: () => headings,
    readingLine: () => reading,
    halfPage: () => halfPage,
    follow: (line) => followed.push(line),
    jump: (line) => jumped.push(line),
    openComposer: (startLine, endLine) => {
      composerOpens.push({ startLine, endLine });
      // Mirror the component's openRange, which relocates the cursor onto the opened line.
      store.cursorLine = endLine;
    },
    focusField: () => {
      focused += 1;
    },
    blur: () => {
      blurred += 1;
    },
    hintsShown: () => hints,
    setTimer: (fn) => {
      const handle = nextHandle++;
      scheduled.push({ fn, handle });
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (h) => {
      const i = scheduled.findIndex((s) => s.handle === (h as unknown as number));
      if (i >= 0) scheduled.splice(i, 1);
    },
  });

  return {
    keyboard,
    followed,
    jumped,
    composerOpens,
    focusCount: () => focused,
    blurCount: () => blurred,
    pendingTimers: () => scheduled.length,
    setText: (t: string) => {
      text = t;
    },
    setReading: (l: number | null) => {
      reading = l;
    },
    setHints: (on: boolean) => {
      hints = on;
    },
    /** Fire (and drain) the scheduled close callbacks, as the collapse timeout would. */
    runTimers: () => {
      for (const { fn } of scheduled.splice(0)) fn();
    },
  };
}

let store: PlanKeyboardStore;

beforeEach(() => {
  store = makeStore();
});

describe("matches", () => {
  test("an empty query matches nothing", () => {
    const { keyboard } = build(store, { text: PLAN });
    expect(keyboard.matches()).toEqual([]);
  });

  test("finds every literal occurrence across the rendered lines", () => {
    store.searchQuery = "alpha";
    const { keyboard } = build(store, { text: PLAN });
    // Two on line 3, one on line 5.
    expect(keyboard.matches().map((m) => m.line)).toEqual([3, 3, 5]);
  });
});

describe("openSearch", () => {
  test("opens uncommitted, seeded from the remembered query, and focuses the field", () => {
    store.lastQuery = "beta";
    const h = build(store, { text: PLAN });
    h.keyboard.openSearch();
    expect(store.searchOpen).toBe(true);
    expect(store.searchCommitted).toBe(false);
    expect(store.searchQuery).toBe("beta");
    expect(store.searchIndex).toBe(-1);
    expect(h.focusCount()).toBe(1);
  });

  test("cancels a pending close when reopening mid-collapse", () => {
    store.searchOpen = true;
    const h = build(store, { text: PLAN });
    h.keyboard.closeSearch(); // hints on → defers, marks closing
    expect(store.searchClosing).toBe(true);
    expect(h.pendingTimers()).toBe(1);
    h.keyboard.openSearch();
    expect(store.searchClosing).toBe(false);
    expect(h.pendingTimers()).toBe(0);
    expect(store.searchOpen).toBe(true);
  });
});

describe("retrackToNearest", () => {
  test("lands the index on the nearest match at or after the reading position", () => {
    store.searchQuery = "alpha";
    const h = build(store, { text: PLAN, reading: 4 });
    h.keyboard.retrackToNearest();
    // Nearest match on/after line 4 is the line-5 occurrence (index 2).
    expect(store.searchIndex).toBe(2);
  });

  test("seeds from the placed cursor over the reading position", () => {
    store.searchQuery = "alpha";
    store.cursorLine = 1;
    const h = build(store, { text: PLAN, reading: 4 });
    h.keyboard.retrackToNearest();
    // Cursor at line 1 wins over reading 4 → first match (index 0).
    expect(store.searchIndex).toBe(0);
  });
});

describe("commitSearch", () => {
  test("remembers the query, lands the cursor on the nearest match, and blurs", () => {
    store.searchQuery = "alpha";
    const h = build(store, { text: PLAN, reading: 4 });
    h.keyboard.commitSearch();
    expect(store.lastQuery).toBe("alpha");
    expect(store.searchIndex).toBe(2);
    expect(store.cursorLine).toBe(5); // the line-5 match
    expect(h.followed).toEqual([5]);
    expect(store.searchCommitted).toBe(true);
    expect(h.blurCount()).toBe(1);
  });

  test("is a no-op when the query matches nothing", () => {
    store.searchQuery = "zzz";
    const h = build(store, { text: PLAN, reading: 1 });
    h.keyboard.commitSearch();
    expect(store.lastQuery).toBe("");
    expect(store.searchCommitted).toBe(false);
    expect(store.searchIndex).toBe(-1);
    expect(h.followed).toEqual([]);
  });
});

describe("stepSearch", () => {
  test("steps the committed index with wraparound", () => {
    store.searchQuery = "alpha";
    store.searchOpen = true;
    store.searchCommitted = true;
    store.searchIndex = 0;
    const h = build(store, { text: PLAN });
    h.keyboard.stepSearch(1); // 0 → 1 (still line 3)
    expect(store.searchIndex).toBe(1);
    h.keyboard.stepSearch(1); // 1 → 2 (line 5)
    expect(store.searchIndex).toBe(2);
    h.keyboard.stepSearch(1); // 2 → 0 (wrap, line 3)
    expect(store.searchIndex).toBe(0);
    expect(h.followed).toEqual([3, 5, 3]);
  });

  test("N wraps backwards past the first match", () => {
    store.searchQuery = "alpha";
    store.searchOpen = true;
    store.searchCommitted = true;
    store.searchIndex = 0;
    const h = build(store, { text: PLAN });
    h.keyboard.stepSearch(-1);
    expect(store.searchIndex).toBe(2);
  });

  test("resumes a remembered query from the reading position when the pill is closed", () => {
    store.lastQuery = "alpha";
    const h = build(store, { text: PLAN, reading: 3 });
    h.keyboard.stepSearch(1);
    expect(store.searchOpen).toBe(true);
    expect(store.searchCommitted).toBe(true);
    expect(store.searchQuery).toBe("alpha");
    // From reading line 3, the first match strictly after it is line 5 (index 2).
    expect(store.searchIndex).toBe(2);
    expect(store.cursorLine).toBe(5);
  });

  test("does nothing when closed with no remembered query", () => {
    const h = build(store, { text: PLAN });
    h.keyboard.stepSearch(1);
    expect(store.searchOpen).toBe(false);
    expect(h.followed).toEqual([]);
  });

  test("does nothing when open with no matches", () => {
    store.searchQuery = "zzz";
    store.searchOpen = true;
    store.searchCommitted = true;
    store.searchIndex = -1;
    const h = build(store, { text: PLAN });
    h.keyboard.stepSearch(1);
    expect(store.searchIndex).toBe(-1);
    expect(h.followed).toEqual([]);
  });
});

describe("closeSearch", () => {
  test("resets immediately when the collapse chip is not shown", () => {
    store.searchOpen = true;
    store.searchQuery = "alpha";
    store.searchIndex = 1;
    const h = build(store, { text: PLAN, hints: false });
    h.keyboard.closeSearch();
    expect(h.blurCount()).toBe(1);
    expect(store.searchOpen).toBe(false);
    expect(store.searchCommitted).toBe(false);
    expect(store.searchQuery).toBe("");
    expect(store.searchIndex).toBe(-1);
    expect(store.searchClosing).toBe(false);
    expect(h.pendingTimers()).toBe(0);
  });

  test("defers teardown through the collapse animation when the chip is shown", () => {
    store.searchOpen = true;
    store.searchQuery = "alpha";
    const h = build(store, { text: PLAN, hints: true });
    h.keyboard.closeSearch();
    // Still mounted, now playing the collapse animation.
    expect(store.searchClosing).toBe(true);
    expect(store.searchOpen).toBe(true);
    expect(h.pendingTimers()).toBe(1);
    // The scheduled teardown tears it down.
    h.runTimers();
    expect(store.searchOpen).toBe(false);
    expect(store.searchClosing).toBe(false);
    expect(store.searchQuery).toBe("");
  });

  test("keeps the remembered query across a close, so / reopens where you left off", () => {
    store.searchOpen = true;
    store.searchQuery = "alpha";
    store.lastQuery = "alpha";
    const h = build(store, { text: PLAN, hints: false });
    h.keyboard.closeSearch();
    expect(store.searchQuery).toBe("");
    expect(store.lastQuery).toBe("alpha");
  });
});

describe("cancelClose", () => {
  test("cancels a pending close without resetting the search", () => {
    store.searchOpen = true;
    store.searchQuery = "alpha";
    const h = build(store, { text: PLAN, hints: true });
    h.keyboard.closeSearch();
    h.keyboard.cancelClose();
    expect(store.searchClosing).toBe(false);
    expect(h.pendingTimers()).toBe(0);
    expect(store.searchOpen).toBe(true);
    expect(store.searchQuery).toBe("alpha");
  });
});

describe("clearForContentSwitch", () => {
  test("drops cursor, visual, and search but keeps the remembered query", () => {
    store.cursorLine = 5;
    store.visualAnchor = 3;
    store.searchOpen = true;
    store.searchQuery = "alpha";
    store.searchIndex = 1;
    store.lastQuery = "alpha";
    const h = build(store, { text: PLAN });
    h.keyboard.clearForContentSwitch();
    expect(store.cursorLine).toBeNull();
    expect(store.visualAnchor).toBeNull();
    expect(store.searchOpen).toBe(false);
    expect(store.searchCommitted).toBe(false);
    expect(store.searchQuery).toBe("");
    expect(store.searchIndex).toBe(-1);
    expect(store.lastQuery).toBe("alpha");
  });
});

// Two headings (lines 1 and 5) and three blank lines (2, 4, 6); split on "\n" yields 8
// entries, the last a trailing "" — so lineCount is 7 and `G` must land there, not on 8.
const CURSOR_PLAN = "# Alpha\n\nbody one\n\n## Beta\n\nbody two\n";
const CURSOR_HEADINGS = [1, 5];

describe("moveCursor", () => {
  test("reveals an unplaced cursor at the reading position, then steps from there", () => {
    const h = build(store, { text: CURSOR_PLAN, reading: 3, headings: CURSOR_HEADINGS });
    h.keyboard.moveCursor("down"); // unplaced → reveal at the reading line
    expect(store.cursorLine).toBe(3);
    h.keyboard.moveCursor("down"); // 3 → 4
    expect(store.cursorLine).toBe(4);
    expect(h.followed).toEqual([3, 4]);
  });

  test("G lands on the last real line, not past a trailing newline", () => {
    store.cursorLine = 2;
    const h = build(store, { text: CURSOR_PLAN, headings: CURSOR_HEADINGS });
    h.keyboard.moveCursor("bottom");
    expect(store.cursorLine).toBe(7); // 7 real lines; the trailing "" (would-be 8) is not a row
  });

  test("gg lands on the first line", () => {
    store.cursorLine = 6;
    const h = build(store, { text: CURSOR_PLAN, headings: CURSOR_HEADINGS });
    h.keyboard.moveCursor("top");
    expect(store.cursorLine).toBe(1);
  });

  test("a half-page motion steps by the injected half-page size", () => {
    store.cursorLine = 1;
    const h = build(store, { text: CURSOR_PLAN, headings: CURSOR_HEADINGS, halfPage: 3 });
    h.keyboard.moveCursor("halfDown"); // 1 + 3
    expect(store.cursorLine).toBe(4);
  });

  test("heading motions jump between the heading lines, taking the shared jump", () => {
    store.cursorLine = 1;
    const h = build(store, { text: CURSOR_PLAN, headings: CURSOR_HEADINGS });
    h.keyboard.moveCursor("nextHeading"); // 1 → 5
    expect(store.cursorLine).toBe(5);
    h.keyboard.moveCursor("prevHeading"); // 5 → 1
    expect(store.cursorLine).toBe(1);
    expect(h.jumped).toEqual([5, 1]);
    expect(h.followed).toEqual([]);
  });

  test("stepping and page motions keep the scrolloff follow", () => {
    store.cursorLine = 1;
    const h = build(store, { text: CURSOR_PLAN, headings: CURSOR_HEADINGS, halfPage: 3 });
    h.keyboard.moveCursor("down"); // 1 → 2
    h.keyboard.moveCursor("halfDown"); // 2 → 5
    h.keyboard.moveCursor("top"); // → 1
    expect(h.followed).toEqual([2, 5, 1]);
    expect(h.jumped).toEqual([]);
  });

  test("exactly the two heading motions take the jump — every other motion follows", () => {
    // The whole CursorMotion union, so the EXCLUSION is pinned rather than left to
    // the two cases above: `{`/`}` and `G` navigate somewhere explicit too, and
    // reading JUMP_MOTIONS' rule that broadly would wrongly sweep them in.
    const motions: CursorMotion[] = [
      "down",
      "up",
      "halfDown",
      "halfUp",
      "top",
      "bottom",
      "nextHeading",
      "prevHeading",
      "nextBlank",
      "prevBlank",
    ];
    const jumping = motions.filter((motion) => {
      const h = build(
        { ...store, cursorLine: 3 },
        { text: CURSOR_PLAN, headings: CURSOR_HEADINGS },
      );
      h.keyboard.moveCursor(motion);
      expect(h.jumped.length + h.followed.length).toBe(1); // every motion scrolls exactly once
      return h.jumped.length === 1;
    });
    expect(jumping).toEqual(["nextHeading", "prevHeading"]);
  });

  test("blank-line motions jump between the paragraph boundaries", () => {
    store.cursorLine = 1;
    const h = build(store, { text: CURSOR_PLAN, headings: CURSOR_HEADINGS });
    h.keyboard.moveCursor("nextBlank"); // blanks are 2, 4, 6 → 2
    expect(store.cursorLine).toBe(2);
    h.keyboard.moveCursor("nextBlank"); // 2 → 4
    expect(store.cursorLine).toBe(4);
  });
});

describe("enterVisualMode", () => {
  test("anchors the selection at the seed and follows the cursor there", () => {
    const h = build(store, { text: CURSOR_PLAN, reading: 3 });
    h.keyboard.enterVisualMode();
    expect(store.cursorLine).toBe(3);
    expect(store.visualAnchor).toBe(3);
    expect(h.followed).toEqual([3]);
  });

  test("seeds from a placed cursor over the reading position", () => {
    store.cursorLine = 5;
    const h = build(store, { text: CURSOR_PLAN, reading: 3 });
    h.keyboard.enterVisualMode();
    expect(store.visualAnchor).toBe(5);
  });

  test("pressing V again exits, keeping the cursor placed", () => {
    store.cursorLine = 6;
    store.visualAnchor = 4;
    const h = build(store, { text: CURSOR_PLAN });
    h.keyboard.enterVisualMode();
    expect(store.visualAnchor).toBeNull();
    expect(store.cursorLine).toBe(6);
  });
});

describe("commentCursorLine", () => {
  test("opens the composer on the cursor line", () => {
    store.cursorLine = 4;
    const h = build(store, { text: CURSOR_PLAN });
    h.keyboard.commentCursorLine();
    expect(h.composerOpens).toEqual([{ startLine: 4, endLine: 4 }]);
  });

  test("seeds an unplaced cursor at the reading position", () => {
    const h = build(store, { text: CURSOR_PLAN, reading: 3 });
    h.keyboard.commentCursorLine();
    expect(h.composerOpens).toEqual([{ startLine: 3, endLine: 3 }]);
  });

  test("in visual mode, comments the whole (normalized) selection and exits visual mode", () => {
    store.visualAnchor = 6;
    store.cursorLine = 2;
    const h = build(store, { text: CURSOR_PLAN });
    h.keyboard.commentCursorLine();
    expect(h.composerOpens).toEqual([{ startLine: 2, endLine: 6 }]);
    expect(store.visualAnchor).toBeNull();
    expect(store.cursorLine).toBe(6); // openComposer relocates the cursor to the range end
  });
});

describe("clearSelectionOrCursor", () => {
  test("closes the search HUD first, leaving any visual selection intact", () => {
    store.searchOpen = true;
    store.visualAnchor = 3;
    const h = build(store, { text: CURSOR_PLAN, hints: false });
    h.keyboard.clearSelectionOrCursor();
    expect(store.searchOpen).toBe(false);
    expect(store.visualAnchor).toBe(3); // search took priority; the selection survives
  });

  test("exits visual mode when no search is open, never clearing the cursor", () => {
    store.searchOpen = false;
    store.visualAnchor = 3;
    store.cursorLine = 5;
    const h = build(store, { text: CURSOR_PLAN });
    h.keyboard.clearSelectionOrCursor();
    expect(store.visualAnchor).toBeNull();
    expect(store.cursorLine).toBe(5); // Esc never clears the line cursor
  });

  test("leaves a bare placed cursor untouched", () => {
    store.searchOpen = false;
    store.visualAnchor = null;
    store.cursorLine = 5;
    const h = build(store, { text: CURSOR_PLAN });
    h.keyboard.clearSelectionOrCursor();
    expect(store.cursorLine).toBe(5);
  });
});
