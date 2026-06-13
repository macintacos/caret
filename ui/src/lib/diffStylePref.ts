// Layout preference for version-compare mode, persisted in localStorage.
//
// This is a pure browser display preference (split vs. unified diff layout) with
// no security surface and no cross-process consumer, so it lives in localStorage
// rather than the daemon's machine-global prefs (src/prefs.ts) — that file is a
// 0600 store beside plan bodies for the opaque approve-variant token, written
// only on the decision path, and a layout toggle belongs nowhere near it.
//
// Both read and write fail safe and never throw: a blocked or unavailable
// localStorage (private mode, disabled storage) degrades to the library default
// rather than breaking the view.

import type { DiffStyle } from "./diffview/types.ts";

/** localStorage key holding the remembered diff layout. */
export const DIFF_STYLE_KEY = "caret.diffStyle";

/** The library's default layout, used whenever no valid value is stored. */
const DEFAULT_DIFF_STYLE: DiffStyle = "split";

function isDiffStyle(value: unknown): value is DiffStyle {
  return value === "split" || value === "unified";
}

/** Read the remembered layout, defaulting to "split" on a missing, unrecognized,
 * or unreadable value. */
export function readDiffStyle(): DiffStyle {
  try {
    const stored = localStorage.getItem(DIFF_STYLE_KEY);
    return isDiffStyle(stored) ? stored : DEFAULT_DIFF_STYLE;
  } catch {
    return DEFAULT_DIFF_STYLE;
  }
}

/** Persist the chosen layout. A storage failure is swallowed — the preference is
 * non-essential, so a write that can't land must not surface to the reviewer. */
export function writeDiffStyle(style: DiffStyle): void {
  try {
    localStorage.setItem(DIFF_STYLE_KEY, style);
  } catch {
    // Storage unavailable (private mode, quota, disabled) — drop silently.
  }
}
