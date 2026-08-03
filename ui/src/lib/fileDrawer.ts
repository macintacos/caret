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

/** Smallest useful drawer, and the plan column the drawer may never squeeze past. */
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
 * `size` bounded to a usable drawer that still leaves the plan `MIN_PLAN_PX` of
 * the `available` docking axis. When the axis is too small to hold both minimums
 * the bounds cross, and the drawer keeps its own floor rather than collapsing.
 */
export function clampDrawerSize(size: number, available: number): number {
  const max = available - MIN_PLAN_PX;
  if (max < MIN_DRAWER_PX) return MIN_DRAWER_PX;
  return Math.min(Math.max(size, MIN_DRAWER_PX), max);
}

/**
 * The drawer size the pointer is asking for, already clamped. The handle sits on
 * the drawer's *inner* edge, so a right drawer measures back from the surface's
 * right edge and a bottom drawer up from its bottom edge.
 */
export function drawerSizeFromPointer(
  edge: DrawerEdge,
  pointer: { clientX: number; clientY: number },
  surface: { right: number; bottom: number; width: number; height: number },
): number {
  return edge === "right"
    ? clampDrawerSize(surface.right - pointer.clientX, surface.width)
    : clampDrawerSize(surface.bottom - pointer.clientY, surface.height);
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
