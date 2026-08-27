// Whether the completion preview panel is open, persisted in localStorage
// (EXC-1186). A reviewer who turned the panel on means it for the next `@` they
// type, and for the one after the tab reloads — the panel is a mode they are in,
// not a property of one list.
//
// Sits beside shortcutHintsPref.ts and shares its shape exactly: a pure browser
// choice with no security surface and no cross-process consumer, stored as
// "on"/"off" over definePref, which registers the key for the `--fresh` reset
// (prefs.ts) and composes enumLocalStoragePref's never-throw fail-safe.

import { definePref } from "$lib/definePref.ts";

/** localStorage key holding whether the completion preview panel is open. */
export const COMPLETION_PREVIEW_KEY = "caret.completionPreview";

const pref = definePref<"on" | "off">(COMPLETION_PREVIEW_KEY, ["on", "off"], "off");

/** Whether the preview panel opens with a list. Defaults to false on a missing,
 * unrecognized, or unreadable value: an accessory panel is opt-in, and a list
 * that paints as it always did is the answer a reviewer who never asked expects. */
export const readCompletionPreview = (): boolean => pref.read() === "on";

/** Persist whether the preview panel is open. A storage failure is swallowed —
 * the preference is non-essential, so a write that can't land must not surface. */
export const writeCompletionPreview = (open: boolean): void => pref.write(open ? "on" : "off");
