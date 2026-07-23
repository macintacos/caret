// Persisted show/hide preference for the plan's table-of-contents rail (EXC-809).
//
// A pure browser display preference like diffStylePref.ts — it lives in
// localStorage, never the daemon's machine-global prefs. Tri-state on read:
// `null` means the reviewer has not chosen yet, so the view falls back to its
// width-sensitive first-load default; once they toggle the rail, `true`/`false`
// persists across plans and reloads.
//
// Read and write both fail safe and never throw: a blocked or unavailable
// localStorage (private mode, disabled storage) degrades to `null` / a dropped
// write rather than breaking the view. registerPrefKey (definePref.ts) adds the key
// to the `--fresh` reset set; the tri-state read/write stay bespoke here because the
// null-vs-unreadable semantics don't fit definePref's flag or enum shapes.

import { registerPrefKey } from "$lib/definePref.ts";

/** localStorage key holding the remembered ToC open/collapsed state. */
export const TOC_OPEN_KEY = "caret.tocOpen";

registerPrefKey(TOC_OPEN_KEY);

/** Read the remembered ToC state: `true` (open) / `false` (collapsed), or `null`
 * on a missing, unrecognized, or unreadable value so the caller applies its own
 * default. Fail-safe. */
export function readTocOpen(): boolean | null {
  try {
    const stored = localStorage.getItem(TOC_OPEN_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
    return null;
  } catch {
    return null;
  }
}

/** Persist the ToC state. A storage failure is swallowed — the preference is
 * non-essential, so a write that can't land must not surface to the reviewer. */
export function writeTocOpen(open: boolean): void {
  try {
    localStorage.setItem(TOC_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Storage unavailable (private mode, quota, disabled) — drop silently.
  }
}
