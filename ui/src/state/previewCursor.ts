// The plan preview's keyboard cursor: the source view's motions over visual lines. A
// DOM-free factory over the same store planKeyboard drives, with the preview's geometry
// injected, so the cursor's truth stays `cursorLine` and a flip carries it unchanged.

import {
  blankLinesOf,
  type CursorMotion,
  JUMP_MOTIONS,
  lineCountOf,
  resolveCursorLine,
} from "$lib/diffview/lineCursor.ts";
import type { TextPoint } from "$lib/previewLines.ts";

export interface PreviewCursorStore {
  /** The cursor's source line — the same field PlanKeyboardStore holds. */
  cursorLine: number | null;
  /** The preview's finer position on that line. Counts only while its line equals
   * cursorLine; whatever moves cursorLine elsewhere and back revives it unless it clears it. */
  cursorPoint: TextPoint | null;
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
}

export interface PreviewCursor {
  /** The cursor's point, or null when unplaced. A cursorLine with no point of its own
   * resolves through pointForLine — for a blank line, the next line with text, so the
   * point's line can differ from cursorLine. */
  point(): TextPoint | null;
  /** No-op when nothing resolves; heading motions jump, the rest follow. */
  moveCursor(motion: CursorMotion): void;
  /** Drops the preview's column, so a content switch leaves no point behind. */
  reset(): void;
}

type LineMotion = Extract<CursorMotion, "nextHeading" | "prevHeading" | "nextBlank" | "prevBlank">;

function before(a: TextPoint, b: TextPoint): boolean {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}

export function createPreviewCursor(
  store: PreviewCursorStore,
  deps: PreviewCursorDeps,
): PreviewCursor {
  function point(): TextPoint | null {
    const { cursorLine, cursorPoint } = store;
    if (cursorLine == null) return null;
    return cursorPoint?.line === cursorLine ? cursorPoint : deps.pointForLine(cursorLine);
  }

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
    },

    moveCursor(motion) {
      const p = resolve(motion, point());
      if (p == null) return;
      store.cursorLine = p.line;
      store.cursorPoint = p;
      (JUMP_MOTIONS.has(motion) ? deps.jump : deps.follow)(p);
    },
  };
}
