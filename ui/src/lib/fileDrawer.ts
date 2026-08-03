// Geometry and persistence for the docked file-preview drawer (EXC-937).
//
// The drawer takes layout space beside the plan — right on a wide window, bottom
// on a narrow one — so its size is bounded from both sides: it must stay usable
// itself, and it must never squeeze the plan below a readable column. The drag
// math is pure (the component supplies the DOM rects) so the resize is
// unit-testable without a browser, mirroring diffview/lineDrag.ts.
//
// The two edges remember their sizes under two keys, which is what makes
// resizing the right drawer leave the bottom drawer's height alone. Like
// tocPref.ts, the read/write pair is bespoke rather than a definePref factory —
// a clamped number fits neither the flag nor the enum shape — and both fail safe
// and never throw, degrading to "nothing remembered" rather than breaking the
// view. registerPrefKey puts both keys in the `--fresh` reset set.

import { registerPrefKey } from "$lib/definePref.ts";

/** Which edge of the plan surface the drawer docks to. */
export type DrawerEdge = "right" | "bottom";

/** Smallest useful drawer, and the plan pane the drawer may never squeeze past.
 * MIN_PLAN_PX bounds the whole pane, which above TIGHT_WIDTH_PX also carries the
 * ToC rail — so it is the floor on the pane, not on the source column inside it. */
export const MIN_DRAWER_PX = 240;
export const MIN_PLAN_PX = 320;

/** Opening size with nothing remembered: a share of the docking axis. */
export const DEFAULT_DRAWER_SHARE = 0.45;

/** localStorage keys holding the remembered size of each docking edge. */
export const FILE_DRAWER_WIDTH_KEY = "caret.fileDrawer.width";
export const FILE_DRAWER_HEIGHT_KEY = "caret.fileDrawer.height";

registerPrefKey(FILE_DRAWER_WIDTH_KEY);
registerPrefKey(FILE_DRAWER_HEIGHT_KEY);

/**
 * The largest drawer that still leaves the plan `MIN_PLAN_PX` of the `available`
 * docking axis — never below the drawer's own floor, so an axis too small to
 * hold both minimums yields a usable drawer rather than a collapsed one. Exported
 * because the resize handle reports it as `aria-valuemax`: one source for the
 * bound the clamp enforces and the bound assistive tech is told about.
 */
export function maxDrawerSize(available: number): number {
  return Math.max(available - MIN_PLAN_PX, MIN_DRAWER_PX);
}

/** `size` bounded to a usable drawer that still leaves the plan its minimum. */
export function clampDrawerSize(size: number, available: number): number {
  return Math.min(Math.max(size, MIN_DRAWER_PX), maxDrawerSize(available));
}

/**
 * The drawer size the pointer is asking for, already clamped. The handle sits on
 * the drawer's *inner* edge, so the size is the distance back from the drawer's
 * own outer edge — its right edge when docked right, its bottom edge when docked
 * bottom, both of which sit on the surface's matching edge.
 */
export function drawerSizeFromPointer(
  edge: DrawerEdge,
  pointer: { clientX: number; clientY: number },
  outer: { right: number; bottom: number },
  available: number,
): number {
  return edge === "right"
    ? clampDrawerSize(outer.right - pointer.clientX, available)
    : clampDrawerSize(outer.bottom - pointer.clientY, available);
}

function keyFor(edge: DrawerEdge): string {
  return edge === "right" ? FILE_DRAWER_WIDTH_KEY : FILE_DRAWER_HEIGHT_KEY;
}

/** The remembered size for this edge, or `null` when unset, unparseable, or
 * unreadable so the caller applies its own default. Fail-safe. */
export function readDrawerSize(edge: DrawerEdge): number | null {
  try {
    const stored = localStorage.getItem(keyFor(edge));
    if (stored == null) return null;
    const px = Number(stored);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

/** Persist the size of this edge. A storage failure is swallowed — the
 * preference is non-essential, so a write that can't land must not surface. */
export function writeDrawerSize(edge: DrawerEdge, px: number): void {
  try {
    localStorage.setItem(keyFor(edge), String(px));
  } catch {
    // Storage unavailable (private mode, quota, disabled) — drop silently.
  }
}
