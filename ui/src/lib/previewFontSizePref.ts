// The preview's base font size in px, persisted in localStorage like the other display
// prefs (diffStylePref.ts): a pure browser choice with no cross-process consumer. Every
// type step in the preview scales from it, so its headings keep their ladder.
//
// The read/write pair is built from the shared definePref helper, which registers the key
// for the `--fresh` reset (prefs.ts) and degrades a missing, unrecognized or unreadable
// value to the default.

import { definePref } from "$lib/definePref.ts";

/** localStorage key holding the preview's base font size. */
export const PREVIEW_FONT_SIZE_KEY = "caret.previewFontSize";

/** The sizes offered, in px. */
export const PREVIEW_FONT_SIZES = ["12", "13", "14", "15", "16", "17", "18", "19", "20"] as const;
export type PreviewFontSize = (typeof PREVIEW_FONT_SIZES)[number];

const pref = definePref<PreviewFontSize>(PREVIEW_FONT_SIZE_KEY, PREVIEW_FONT_SIZES, "15");

export const readPreviewFontSize = pref.read;
export const writePreviewFontSize = pref.write;
