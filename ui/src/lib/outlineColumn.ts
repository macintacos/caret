// The outline column's width: where it opens, how far a drag takes it, and the width the
// reader chose, remembered across reloads. Sizes are in rem so a larger root font widens
// the column with its text; a chosen width is stored in px, as the reader dragged it.

import { definePxPref } from "$lib/definePref.ts";
import { MIN_READING_PX, outlineRoom } from "$lib/fileDrawer.ts";

/** The column's opening width, the narrowest at which an H5 label still holds a few words
 * a line, and the widest, where a label's line reaches the 75-character measure. */
export const OUTLINE_REM = { open: 15.5, min: 12, max: 30 } as const;

/** The reader's chosen width in px, or null for the opening width. */
export const outlineWidthPref = definePxPref("caret.planOutline.width");

/** A file drawer docked right beside the column: its remembered width, or null for its
 * opening share. */
export interface DrawerBeside {
  chosen: number | null;
}

export interface OutlineBounds {
  min: number;
  max: number;
}

/**
 * How narrow and how wide the column may stand on a `body` this wide, at `rem` px to the
 * rem. It widens only while the plan beside it keeps `MIN_READING_PX`, up to
 * `OUTLINE_REM.max`, but a narrow window never caps it under its opening width. Beside a
 * `drawer`, it stops where the column would yield to the drawer.
 */
export function outlineBounds(body: number, rem: number, drawer?: DrawerBeside): OutlineBounds {
  const min = OUTLINE_REM.min * rem;
  const reading = Math.max(
    OUTLINE_REM.open * rem,
    Math.min(OUTLINE_REM.max * rem, body - MIN_READING_PX),
  );
  const max = drawer === undefined ? reading : Math.min(reading, outlineRoom(body, drawer.chosen));
  return { min, max: Math.max(min, max) };
}

/** The width a reset chooses: none, which opens the column at its opening width, unless the
 * bounds' `max` stops short of it beside a file. Then the widest that keeps the column
 * standing there, so a reset never drops it to a float. */
export function outlineReset(max: number, rem: number): number | null {
  return max < OUTLINE_REM.open * rem ? max : null;
}

/** The width the column stands at: the `chosen` width, or the opening one, within the
 * bounds a `body` this wide sets. The choice itself is kept, so a window narrowed past it
 * gives it back as it widens again. */
export function outlineWidth(chosen: number | null, body: number, rem: number): number {
  const { min, max } = outlineBounds(body, rem);
  return Math.min(Math.max(chosen ?? OUTLINE_REM.open * rem, min), max);
}
