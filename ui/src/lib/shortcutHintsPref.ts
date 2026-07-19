// Whether the keyboard-shortcut hint affordances are shown, persisted in
// localStorage. Like the other display prefs (diffIndicatorsPref.ts), this is a
// pure browser choice with no security surface and no cross-process consumer, so
// it lives in localStorage rather than the daemon's machine-global prefs.
//
// Stored as "on"/"off" over the shared never-throw enumLocalStoragePref helper —
// a blocked or unavailable localStorage degrades to the default rather than
// breaking the view. Exposed as a boolean since the affordances gate on one.

import { enumLocalStoragePref } from "$lib/enumLocalStoragePref.ts";

/** localStorage key holding whether shortcut-hint affordances are shown. */
export const SHORTCUT_HINTS_KEY = "caret.shortcutHints";

const pref = enumLocalStoragePref<"on" | "off">(SHORTCUT_HINTS_KEY, ["on", "off"], "on");

/** Whether to show the shortcut-hint affordances. Defaults to true (on) on a
 * missing, unrecognized, or unreadable value — discoverability first. */
export const readShortcutHints = (): boolean => pref.read() === "on";

/** Persist whether shortcut hints are shown. A storage failure is swallowed —
 * the preference is non-essential, so a write that can't land must not surface. */
export const writeShortcutHints = (show: boolean): void => pref.write(show ? "on" : "off");
