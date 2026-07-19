// Focused-line cursor model for the plan source view: given the current cursor
// line and a motion key, resolve the line to move to; and tag the shadow row
// the cursor sits on so the override sheet paints its band. The math is pure and
// DOM-free (directly unit-testable); tagCursorRow is the only DOM touch and
// mirrors the per-line tagging pattern in fileRefTag.ts / codeBlocks.ts. Line
// numbers are 1-based and match the @pierre/diffs `data-line` numbering the
// source view paints.

/** A vim-style cursor motion. Relative motions step from the current line;
 * absolute motions (top/bottom, heading jumps, blank-line jumps) resolve to a
 * target line regardless of where the cursor sits. */
export type CursorMotion =
  | "down"
  | "up"
  | "halfDown"
  | "halfUp"
  | "top"
  | "bottom"
  | "nextHeading"
  | "prevHeading"
  | "nextBlank"
  | "prevBlank";

/** Inputs for resolving a motion to a target line. */
export interface CursorContext {
  /** The current cursor line (1-based), or null when the cursor is unplaced. */
  cursor: number | null;
  /** Total rendered lines; the cursor never leaves `[1, lineCount]`. */
  lineCount: number;
  /** Heading source lines in ascending order (from `extractHeadings`). */
  headingLines: number[];
  /** Blank (empty or whitespace-only) source lines in ascending order — the
   * paragraph boundaries `}` / `{` jump between. */
  blankLines: number[];
  /** Lines a half-page motion (`Ctrl+d` / `Ctrl+u`) covers. */
  halfPage: number;
  /** Where to reveal the cursor when it is unplaced and a relative motion fires
   * — the line the reader is currently at (the top-visible line). */
  seed: number;
}

const RELATIVE: ReadonlySet<CursorMotion> = new Set(["down", "up", "halfDown", "halfUp"]);

/**
 * The line the cursor should move to for `motion`, clamped to `[1, lineCount]`.
 * When the cursor is unplaced (`null`), a relative motion reveals it at the
 * reading position (`seed`) instead of stepping past it; absolute motions
 * resolve to their target regardless. A heading jump with no heading in that
 * direction stays put.
 */
export function resolveCursorLine(motion: CursorMotion, ctx: CursorContext): number {
  const max = Math.max(1, ctx.lineCount);
  const clamp = (n: number): number => Math.min(Math.max(n, 1), max);

  if (ctx.cursor == null && RELATIVE.has(motion)) return clamp(ctx.seed);
  const base = ctx.cursor ?? ctx.seed;

  switch (motion) {
    case "down":
      return clamp(base + 1);
    case "up":
      return clamp(base - 1);
    case "halfDown":
      return clamp(base + ctx.halfPage);
    case "halfUp":
      return clamp(base - ctx.halfPage);
    case "top":
      return 1;
    case "bottom":
      return max;
    case "nextHeading":
      return clamp(ctx.headingLines.find((h) => h > base) ?? base);
    case "prevHeading":
      return clamp([...ctx.headingLines].reverse().find((h) => h < base) ?? base);
    case "nextBlank":
      return clamp(ctx.blankLines.find((b) => b > base) ?? base);
    case "prevBlank":
      return clamp([...ctx.blankLines].reverse().find((b) => b < base) ?? base);
  }
}

/**
 * Marks the shadow row for `line` with `data-caret-cursor` (clearing any prior
 * one) so the override sheet paints the cursor band; `null` — or a line with no
 * rendered row — clears the cursor. A no-op when `root` is null. Attribute
 * writes only (like `tagFileRefTokens`), so it never re-triggers a mutation
 * observer watching the shadow root for node changes.
 */
export function tagCursorRow(root: ParentNode | null, line: number | null): void {
  if (root == null) return;
  for (const el of root.querySelectorAll("[data-caret-cursor]")) {
    el.removeAttribute("data-caret-cursor");
  }
  if (line == null) return;
  root.querySelector(`[data-line="${line}"]`)?.setAttribute("data-caret-cursor", "");
}
