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
  /** The preview's finer position on that line. Ignored once cursorLine moves to another
   * line, so whatever moves cursorLine never has to clear it. */
  cursorPoint: TextPoint | null;
}

export interface PreviewCursorDeps {
  lines(): string[];
  headingLines(): number[];
  /** Visual lines a half-page motion covers. */
  halfPage(): number;
  /** Where an unplaced cursor reveals: the reading position. */
  seed(): TextPoint | null;
  step(from: TextPoint, count: number): TextPoint;
  pointForLine(line: number): TextPoint | null;
  last(): TextPoint | null;
  follow(p: TextPoint): void;
  jump(p: TextPoint): void;
}

export interface PreviewCursor {
  /** The cursor's point, or null when unplaced. A cursorLine with no point of its own
   * resolves to its first visual line (via pointForLine). */
  point(): TextPoint | null;
  moveCursor(motion: CursorMotion): void;
}

const STEPS: Partial<Record<CursorMotion, { sign: 1 | -1; half: boolean }>> = {
  down: { sign: 1, half: false },
  up: { sign: -1, half: false },
  halfDown: { sign: 1, half: true },
  halfUp: { sign: -1, half: true },
};

const BACKWARD: ReadonlySet<CursorMotion> = new Set(["prevHeading", "prevBlank"]);

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
  function lineMotion(motion: CursorMotion, from: TextPoint | null): TextPoint | null {
    const lines = deps.lines();
    const ctx = {
      lineCount: lineCountOf(lines),
      headingLines: deps.headingLines(),
      blankLines: blankLinesOf(lines),
      halfPage: 0,
      seed: deps.seed()?.line ?? 1,
    };
    let line = from?.line ?? null;
    for (;;) {
      const target = resolveCursorLine(motion, { ...ctx, cursor: line });
      if (target === line) return null;
      const p = deps.pointForLine(target);
      if (p == null) return null;
      if (from == null || (BACKWARD.has(motion) ? before(p, from) : before(from, p))) return p;
      line = target;
    }
  }

  function resolve(motion: CursorMotion, from: TextPoint | null): TextPoint | null {
    const step = STEPS[motion];
    if (step) {
      if (from == null) return deps.seed();
      return deps.step(from, step.sign * (step.half ? deps.halfPage() : 1));
    }
    if (motion === "top") return deps.pointForLine(1);
    if (motion === "bottom") return deps.last();
    return lineMotion(motion, from);
  }

  return {
    point,

    moveCursor(motion) {
      const p = resolve(motion, point());
      if (p == null) return;
      store.cursorLine = p.line;
      store.cursorPoint = p;
      (JUMP_MOTIONS.has(motion) ? deps.jump : deps.follow)(p);
    },
  };
}
