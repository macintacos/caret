// One-time discoverability for the drag-to-comment gesture. The gutter `+` and a
// plain line click both open the composer, but the *drag down the line-number
// column to comment on a span* is not self-evident — so the source view surfaces
// a hint the first time the reviewer hovers the gutter, then remembers the
// dismissal so it never nags again. This is the persistence seam, kept pure so it
// is unit-testable without mounting the view; the component owns when to show it.

import { defineFlagPref } from "$lib/definePref.ts";

const STORAGE_KEY = "caret:diffview:drag-hint-dismissed";

// defineFlagPref registers the key for the `--fresh` reset (prefs.ts) and owns the
// never-throw fail-safe. onError: true means an unreadable store (storage-disabled
// or private mode) reports dismissed, so the hint is never re-nagged on every load.
const pref = defineFlagPref(STORAGE_KEY, { onError: true });

/** Whether the drag-to-comment hint has already been dismissed. Fail-safe: an
 * unreadable store reports dismissed rather than nagging on every load. */
export const isDragHintDismissed = pref.read;

/** Records that the reviewer has seen the hint so it never shows again. A storage
 * failure is swallowed — the hint simply re-appears next session, never errors. */
export const dismissDragHint = (): void => pref.write(true);
