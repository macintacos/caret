// The plan preview's keyboard cursor: the source view's motions, visual mode and comment
// key over visual lines. A DOM-free factory over the same store planKeyboard drives, with
// the preview's geometry injected, so the cursor's truth stays `cursorLine` and a flip
// carries it unchanged.

import {
  type CommentStop,
  crossedStop,
  type FocusedStop,
  sameStop,
  stopNeighbour,
} from "$lib/diffview/commentStops.ts";
import {
  blankLinesOf,
  type CursorMotion,
  JUMP_MOTIONS,
  lineCountOf,
  resolveCursorLine,
} from "$lib/diffview/lineCursor.ts";
import type { CursorPlacement } from "$lib/diffview/types.ts";
import type { TextPoint } from "$lib/previewLines.ts";
import type { SoundEvent } from "$lib/sound.ts";

export interface PreviewCursorStore {
  /** The cursor's source line — the same field PlanKeyboardStore holds. */
  cursorLine: number | null;
  /** The preview's finer position on that line. Counts only while its line equals
   * cursorLine; whatever moves cursorLine elsewhere and back revives it unless it clears it. */
  cursorPoint: TextPoint | null;
  /** The visual anchor's source line — the same field PlanKeyboardStore holds. */
  visualAnchor: number | null;
  /** The anchor's finer position. Counts only while its line equals visualAnchor. */
  visualAnchorPoint: TextPoint | null;
}

export interface PreviewCursorDeps {
  lines(): string[];
  headingLines(): number[];
  /** Visual lines a half-page motion covers. */
  halfPage(): number;
  /** Where an unplaced cursor reveals: the reading position. */
  seed(): TextPoint | null;
  /** The point `count` visual lines from `from`, negative moving up, clamped at the ends;
   * `from` itself when it cannot measure. */
  step(from: TextPoint, count: number): TextPoint;
  /** The first visual line of `line`; a blank line maps to the next line with text. */
  pointForLine(line: number): TextPoint | null;
  /** The last visual line, or null when nothing renders. */
  last(): TextPoint | null;
  /** Scrolls `p` into view with scrolloff. */
  follow(p: TextPoint): void;
  /** Scrolls `p` to rest near the top. */
  jump(p: TextPoint): void;
  /** Scrolls `p` to rest at `where` — `zz`/`zt`/`zb`. */
  place(p: TextPoint, where: CursorPlacement): void;
  /** The text of the visual lines from `from`'s through `to`'s, `from` not after `to`. */
  selection(from: TextPoint, to: TextPoint): Range | null;
  /** Opens the composer on the source lines `range` covers. */
  comment(range: Range): void;
  /** Play a moment's cue. Optional so a test drives the factory silently. */
  sound?: (event: SoundEvent) => void;
  /** The comment stops in render order; empty where comments take no keys. */
  stops(): CommentStop[];
  /** The hovered stop, owned by the host. */
  focusedStop(): FocusedStop | null;
  setFocusedStop(stop: FocusedStop | null): void;
  /** Scroll `stop`'s card or marker into view. */
  followStop(stop: CommentStop): void;
  /** The block whose comment slot holds comments ending on `line`. */
  slotOf(line: number): number;
  /** The first visual line after block `slot`, or the last within it; null past the end. */
  slotEdge(slot: number, edge: "first-after" | "last-in"): TextPoint | null;
}

export interface PreviewCursor {
  /** Hover `stop`: exits visual mode, puts the cursor on its last line, and follows it. */
  placeOnStop(stop: CommentStop): void;
  /** Put the cursor at the start of `line`, leaving any hovered stop. Scrolls nothing. */
  landOnLine(line: number): void;
  /** The cursor's point, or null when unplaced. A cursorLine with no point of its own
   * resolves through pointForLine — for a blank line, the next line with text, so the
   * point's line can differ from cursorLine. */
  point(): TextPoint | null;
  /** No-op when nothing resolves; heading motions jump, the rest follow. */
  moveCursor(motion: CursorMotion): void;
  /** `zz`/`zt`/`zb`: scrolls the cursor's point to `where`, leaving the cursor and any
   * visual anchor where they are. An unplaced cursor lands at the reading position first. */
  scrollCursor(where: CursorPlacement): void;
  /** Places the cursor on `p` and follows it — a landing with no motion. */
  placeAt(p: TextPoint): void;
  /** Drops the preview's column, so a content switch leaves no point behind. */
  reset(): void;
  /** The visual anchor's point, null outside visual mode; resolved as `point()` is. */
  anchor(): TextPoint | null;
  /** `V`: toggles visual mode, anchoring at the cursor — placed at the reading position
   * when unplaced. */
  enterVisualMode(): void;
  /** `c`: comments on the cursor's visual line, the reading position's when unplaced,
   * or on the selection, exiting visual mode. */
  comment(): void;
}

type LineMotion = Extract<CursorMotion, "nextHeading" | "prevHeading" | "nextBlank" | "prevBlank">;

function before(a: TextPoint, b: TextPoint): boolean {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}

function ordered(a: TextPoint, b: TextPoint): [TextPoint, TextPoint] {
  return before(b, a) ? [b, a] : [a, b];
}

export function createPreviewCursor(
  store: PreviewCursorStore,
  deps: PreviewCursorDeps,
): PreviewCursor {
  function pointOf(line: number | null, p: TextPoint | null): TextPoint | null {
    if (line == null) return null;
    return p?.line === line ? p : deps.pointForLine(line);
  }
  const point = () => pointOf(store.cursorLine, store.cursorPoint);
  const anchorPoint = () => pointOf(store.visualAnchor, store.visualAnchorPoint);

  // A blank line renders nothing, so its point is the next text line's start — which for
  // `{` at a paragraph's start is the cursor itself. Re-resolving from the target line
  // walks on until the point really moves, or the target line stops changing.
  function lineMotion(
    motion: LineMotion,
    from: TextPoint | null,
    direction: 1 | -1,
  ): TextPoint | null {
    const lines = deps.lines();
    const ctx = {
      lineCount: lineCountOf(lines),
      headingLines: deps.headingLines(),
      blankLines: blankLinesOf(lines),
      halfPage: 0,
      seed: from == null ? (deps.seed()?.line ?? 1) : 1,
    };
    let line = from?.line ?? null;
    for (;;) {
      const target = resolveCursorLine(motion, { ...ctx, cursor: line });
      if (target === line) return null;
      const p = deps.pointForLine(target);
      if (p == null) return null;
      if (from == null || (direction < 0 ? before(p, from) : before(from, p))) return p;
      line = target;
    }
  }

  function land(p: TextPoint, scroll: (p: TextPoint) => void = deps.follow): void {
    store.cursorLine = p.line;
    store.cursorPoint = p;
    scroll(p);
  }

  /** Where a line action starts: the hovered stop's last line, else the cursor, else the
   * reading position. */
  function seedPoint(): TextPoint | null {
    const focused = deps.focusedStop();
    if (focused != null) return deps.pointForLine(focused.line);
    return point() ?? deps.seed();
  }

  function leaveStop(): void {
    if (deps.focusedStop() != null) deps.setFocusedStop(null);
  }

  function placeOnStop(stop: CommentStop): void {
    store.visualAnchor = null;
    deps.setFocusedStop({ ref: stop.ref, line: stop.line });
    store.cursorLine = stop.line;
    store.cursorPoint = null;
    deps.followStop(stop);
  }

  /** `j`/`k` off the hovered stop: to its slot's next stop, else past the slot. Reports
   * whether a stop was hovered. */
  function stepFromStop(dir: 1 | -1): boolean {
    const focused = deps.focusedStop();
    if (focused == null) return false;
    const stops = deps.stops();
    const i = stops.findIndex((s) => sameStop(s.ref, focused.ref));
    const stop = stops[i];
    if (stop == null) return false;

    const next = stops[stopNeighbour(stops, i, dir)];
    if (next != null) {
      placeOnStop(next);
      return true;
    }

    const edge = deps.slotEdge(stop.slot, dir > 0 ? "first-after" : "last-in");
    if (edge == null) return true;
    leaveStop();
    land(edge);
    return true;
  }

  /** `j`/`k` from `from` to `to`: the stop between their blocks, if any. */
  function stopBetween(from: TextPoint, to: TextPoint, dir: 1 | -1): CommentStop | undefined {
    const stops = deps.stops();
    const stuck = dir > 0 && !before(from, to);
    return stops[
      crossedStop(stops, deps.slotOf(from.line), stuck ? null : deps.slotOf(to.line), dir)
    ];
  }

  function resolve(motion: CursorMotion, from: TextPoint | null): TextPoint | null {
    const stepBy = (count: () => number) => (from == null ? deps.seed() : deps.step(from, count()));
    switch (motion) {
      case "down":
        return stepBy(() => 1);
      case "up":
        return stepBy(() => -1);
      case "halfDown":
        return stepBy(() => deps.halfPage());
      case "halfUp":
        return stepBy(() => -deps.halfPage());
      case "top":
        return deps.pointForLine(1);
      case "bottom":
        return deps.last();
      case "nextHeading":
      case "nextBlank":
        return lineMotion(motion, from, 1);
      case "prevHeading":
      case "prevBlank":
        return lineMotion(motion, from, -1);
    }
  }

  return {
    point,

    reset() {
      store.cursorPoint = null;
      store.visualAnchorPoint = null;
    },

    placeOnStop,

    landOnLine(line) {
      leaveStop();
      store.cursorLine = line;
      store.cursorPoint = deps.pointForLine(line);
    },

    moveCursor(motion) {
      const dir = motion === "down" ? 1 : motion === "up" ? -1 : 0;
      const stepsStops = dir !== 0 && store.visualAnchor == null;
      if (stepsStops && stepFromStop(dir)) return;

      const from = point();
      const p = resolve(motion, from);
      if (p == null) return;

      const crossed = stepsStops && from != null ? stopBetween(from, p, dir) : undefined;
      if (crossed != null) {
        placeOnStop(crossed);
        return;
      }

      leaveStop();
      land(p, JUMP_MOTIONS.has(motion) ? deps.jump : deps.follow);
    },

    scrollCursor(where) {
      const placed = point();
      if (placed != null) {
        // Not land(): point() resolves a blank cursorLine to the next text line.
        deps.place(placed, where);
        return;
      }
      const p = deps.seed();
      if (p != null) land(p, (q) => deps.place(q, where));
    },

    placeAt(p) {
      land(p);
    },

    anchor: anchorPoint,

    enterVisualMode() {
      if (store.visualAnchor != null) {
        store.visualAnchor = null;
        deps.sound?.("visualExited");
        return;
      }
      const p = seedPoint();
      if (p == null) return;
      leaveStop();
      land(p);
      store.visualAnchor = p.line;
      store.visualAnchorPoint = p;
      deps.sound?.("visualEntered");
    },

    comment() {
      const p = seedPoint();
      const anchor = anchorPoint();
      store.visualAnchor = null;
      if (p == null) return;
      const range = deps.selection(...ordered(anchor ?? p, p));
      if (range != null) deps.comment(range);
    },
  };
}
