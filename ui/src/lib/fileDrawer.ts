// Geometry and persistence for the docked file-preview drawer (EXC-937).
//
// The drawer takes layout space beside the plan — right on a wide window, bottom
// on a narrow one — so its size is bounded from both sides: it must stay usable
// itself, and it must never squeeze the plan below a readable column.
//
// The two edges remember their sizes under two keys, which is what makes
// resizing the right drawer leave the bottom drawer's height alone. Both are px
// prefs (definePref.ts), so they fail safe to "nothing remembered" rather than
// breaking the view, and join the `--fresh` reset set.

import { definePxPref } from "$lib/definePref.ts";
import { MIN_APP_WIDTH_PX } from "$lib/layout.ts";

/** Which edge of the plan surface the drawer docks to. */
export type DrawerEdge = "right" | "bottom";

/** Smallest useful drawer, and the plan pane the drawer may never squeeze past.
 * MIN_PLAN_PX bounds the whole pane rather than the source column inside it. */
export const MIN_DRAWER_PX = 240;
export const MIN_PLAN_PX = 320;

/** The pane a drawer docked right leaves: as wide as the narrowest window leaves it, less
 * its two 6px --pane-gap margins (layout.css), so the plan header holds what it holds
 * there. */
export const MIN_PLAN_WIDTH_PX = MIN_APP_WIDTH_PX - 12;

/** Opening size with nothing remembered: a share of the docking axis. */
export const DEFAULT_DRAWER_SHARE = 0.45;

/** localStorage keys holding the remembered size of each docking edge. */
export const FILE_DRAWER_WIDTH_KEY = "caret.fileDrawer.width";
export const FILE_DRAWER_HEIGHT_KEY = "caret.fileDrawer.height";

const sizePrefs = {
  right: definePxPref(FILE_DRAWER_WIDTH_KEY),
  bottom: definePxPref(FILE_DRAWER_HEIGHT_KEY),
};

/**
 * The largest drawer that still leaves the plan its minimum of the `available` docking
 * axis — `MIN_PLAN_WIDTH_PX` beside a drawer docked right, `MIN_PLAN_PX` above one docked
 * bottom — never below the drawer's own floor, so an axis too small to hold both minimums
 * yields a usable drawer rather than a collapsed one. Exported because the resize handle
 * reports it as `aria-valuemax`: one source for the bound the clamp enforces and the
 * bound assistive tech is told about.
 */
export function maxDrawerSize(available: number, edge: DrawerEdge): number {
  const plan = edge === "right" ? MIN_PLAN_WIDTH_PX : MIN_PLAN_PX;
  return Math.max(available - plan, MIN_DRAWER_PX);
}

/** `size` bounded to a usable drawer that still leaves the plan its minimum. */
export function clampDrawerSize(size: number, available: number, edge: DrawerEdge): number {
  return Math.min(Math.max(size, MIN_DRAWER_PX), maxDrawerSize(available, edge));
}

/** The narrowest the plan reads at beside the outline column and a right-hand drawer. */
export const MIN_READING_PX = 800;

/**
 * Whether the outline column fits beside a drawer docked right: the plan keeps
 * `MIN_READING_PX` once the `column` and the drawer it would leave room for have
 * taken their share of the `available` width. `chosen` is the reader's remembered
 * drawer width, or null for the default share.
 */
export function outlineFits(available: number, column: number, chosen: number | null): boolean {
  const surface = available - column;
  const drawer = clampDrawerSize(chosen ?? surface * DEFAULT_DRAWER_SHARE, surface, "right");
  return surface - drawer >= MIN_READING_PX;
}

/**
 * The widest column `outlineFits` keeps beside a drawer docked right on `available`
 * width: what is left once the plan has `MIN_READING_PX` and the drawer the rest of the
 * surface would open it at. Floored, so the column it allows fits on whole pixels.
 */
export function outlineRoom(available: number, chosen: number | null): number {
  const surface =
    chosen === null
      ? MIN_READING_PX / (1 - DEFAULT_DRAWER_SHARE)
      : MIN_READING_PX + Math.max(chosen, MIN_DRAWER_PX);
  return Math.floor(available - surface);
}

/** The remembered size for this edge, or `null` when none is, so the caller applies
 * its own default. Fail-safe. */
export function readDrawerSize(edge: DrawerEdge): number | null {
  return sizePrefs[edge].read();
}

/** Persist the size of this edge, or forget it with `null`. A storage failure is
 * swallowed — the preference is non-essential, so a write that can't land must not
 * surface. */
export function writeDrawerSize(edge: DrawerEdge, px: number | null): void {
  sizePrefs[edge].write(px);
}
