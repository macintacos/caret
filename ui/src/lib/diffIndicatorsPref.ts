// Gutter-indicator preference for version-compare mode, persisted in localStorage.
//
// Like the layout preference (diffStylePref.ts), this is a pure browser display
// choice (vertical bars vs. classic +/- glyphs) with no security surface and no
// cross-process consumer, so it lives in localStorage rather than the daemon's
// machine-global prefs.
//
// The read/write pair is built from the shared enumLocalStoragePref helper, which
// owns the never-throw fail-safe: a blocked or unavailable localStorage degrades
// to the default rather than breaking the view.

import type { DiffIndicators } from "./diffview/types.ts";
import { enumLocalStoragePref } from "./enumLocalStoragePref.ts";

/** localStorage key holding the remembered gutter indicators. */
export const DIFF_INDICATORS_KEY = "caret.diffIndicators";

const pref = enumLocalStoragePref<DiffIndicators>(
  DIFF_INDICATORS_KEY,
  ["bars", "classic", "both"],
  "bars",
);

/** Read the remembered indicators, defaulting to "bars" on a missing, unrecognized,
 * or unreadable value. */
export const readDiffIndicators = pref.read;

/** Persist the chosen indicators. A storage failure is swallowed — the preference is
 * non-essential, so a write that can't land must not surface to the reviewer. */
export const writeDiffIndicators = pref.write;
