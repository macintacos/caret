// Layout preference for version-compare mode, persisted in localStorage.
//
// This is a pure browser display preference (split vs. unified diff layout) with
// no security surface and no cross-process consumer, so it lives in localStorage
// rather than the daemon's machine-global prefs (src/config/prefs.ts) — that file is a
// 0600 store beside plan bodies for the opaque approve-variant token, written
// only on the decision path, and a layout toggle belongs nowhere near it.
//
// The read/write pair is built from the shared enumLocalStoragePref helper, which
// owns the never-throw fail-safe: a blocked or unavailable localStorage degrades
// to the default rather than breaking the view.

import type { DiffStyle } from "./diffview/types.ts";
import { enumLocalStoragePref } from "./enumLocalStoragePref.ts";

/** localStorage key holding the remembered diff layout. */
export const DIFF_STYLE_KEY = "caret.diffStyle";

const pref = enumLocalStoragePref<DiffStyle>(DIFF_STYLE_KEY, ["split", "unified"], "split");

/** Read the remembered layout, defaulting to "split" on a missing, unrecognized,
 * or unreadable value. */
export const readDiffStyle = pref.read;

/** Persist the chosen layout. A storage failure is swallowed — the preference is
 * non-essential, so a write that can't land must not surface to the reviewer. */
export const writeDiffStyle = pref.write;
