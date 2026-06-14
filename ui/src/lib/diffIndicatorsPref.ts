// Gutter-indicator preference for version-compare mode, persisted in localStorage.
//
// Like the layout preference (diffStylePref.ts), this is a pure browser display
// choice (vertical bars vs. classic +/- glyphs) with no security surface and no
// cross-process consumer, so it lives in localStorage rather than the daemon's
// machine-global prefs.
//
// Both read and write fail safe and never throw: a blocked or unavailable
// localStorage (private mode, disabled storage) degrades to the library default
// rather than breaking the view.

import type { DiffIndicators } from "./diffview/types.ts";

/** localStorage key holding the remembered gutter indicators. */
export const DIFF_INDICATORS_KEY = "caret.diffIndicators";

/** The library's default indicators, used whenever no valid value is stored. */
const DEFAULT_DIFF_INDICATORS: DiffIndicators = "bars";

function isDiffIndicators(value: unknown): value is DiffIndicators {
  return value === "bars" || value === "classic";
}

/** Read the remembered indicators, defaulting to "bars" on a missing, unrecognized,
 * or unreadable value. */
export function readDiffIndicators(): DiffIndicators {
  try {
    const stored = localStorage.getItem(DIFF_INDICATORS_KEY);
    return isDiffIndicators(stored) ? stored : DEFAULT_DIFF_INDICATORS;
  } catch {
    return DEFAULT_DIFF_INDICATORS;
  }
}

/** Persist the chosen indicators. A storage failure is swallowed — the preference is
 * non-essential, so a write that can't land must not surface to the reviewer. */
export function writeDiffIndicators(indicators: DiffIndicators): void {
  try {
    localStorage.setItem(DIFF_INDICATORS_KEY, indicators);
  } catch {
    // Storage unavailable (private mode, quota, disabled) — drop silently.
  }
}
