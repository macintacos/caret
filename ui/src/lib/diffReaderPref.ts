// Reader affordances for the source/diff surface, persisted in localStorage:
// line overflow (scroll vs. wrap) and whether the line-number gutter is hidden.
//
// Like diffStylePref, these are pure browser display preferences with no security
// surface and no cross-process consumer, so they live in localStorage rather than
// the daemon's machine-global prefs (src/prefs.ts) — that file is a 0600 store
// beside plan bodies for the opaque approve-variant token, and a reader toggle
// belongs nowhere near it.
//
// Both reads and writes fail safe and never throw: a blocked or unavailable
// localStorage (private mode, disabled storage) degrades to the library default
// rather than breaking the view.

import type { SourceViewOptions } from "./diffview/types.ts";

/** The non-optional overflow values the toggle persists. */
export type Overflow = NonNullable<SourceViewOptions["overflow"]>;

/** localStorage key holding the remembered line-overflow behavior. */
export const DIFF_OVERFLOW_KEY = "caret.diffOverflow";

/** localStorage key holding whether the line-number gutter is hidden. */
export const DIFF_LINE_NUMBERS_KEY = "caret.diffLineNumbers";

/** The library's default overflow, used whenever no valid value is stored. */
const DEFAULT_OVERFLOW: Overflow = "scroll";

function isOverflow(value: unknown): value is Overflow {
  return value === "scroll" || value === "wrap";
}

/** Read the remembered overflow, defaulting to "scroll" on a missing,
 * unrecognized, or unreadable value. */
export function readOverflow(): Overflow {
  try {
    const stored = localStorage.getItem(DIFF_OVERFLOW_KEY);
    return isOverflow(stored) ? stored : DEFAULT_OVERFLOW;
  } catch {
    return DEFAULT_OVERFLOW;
  }
}

/** Persist the chosen overflow. A storage failure is swallowed — the preference
 * is non-essential, so a write that can't land must not surface to the reviewer. */
export function writeOverflow(overflow: Overflow): void {
  try {
    localStorage.setItem(DIFF_OVERFLOW_KEY, overflow);
  } catch {
    // Storage unavailable (private mode, quota, disabled) — drop silently.
  }
}

/** Read whether the line-number gutter is hidden, defaulting to false (numbers
 * shown) on a missing, unrecognized, or unreadable value. Stored as "1"/"0". */
export function readDisableLineNumbers(): boolean {
  try {
    return localStorage.getItem(DIFF_LINE_NUMBERS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist whether the line-number gutter is hidden. A storage failure is
 * swallowed for the same reason as the overflow write. */
export function writeDisableLineNumbers(disabled: boolean): void {
  try {
    localStorage.setItem(DIFF_LINE_NUMBERS_KEY, disabled ? "1" : "0");
  } catch {
    // Storage unavailable (private mode, quota, disabled) — drop silently.
  }
}
