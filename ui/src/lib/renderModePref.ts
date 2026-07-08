// View-mode preference for the single-version plan surface, persisted in
// localStorage. Mirrors diffStylePref.ts: a pure browser display preference with
// no security surface and no cross-process consumer, so it lives in localStorage
// rather than the daemon's machine-global prefs.
//
// Both read and write fail safe and never throw: a blocked or unavailable
// localStorage (private mode, disabled storage) degrades to the default rather
// than breaking the view.

/** The single-version plan surface: styled markdown vs. the source-code grid. */
export type RenderMode = "rendered" | "source";

/** localStorage key holding the remembered view mode. */
export const RENDER_MODE_KEY = "caret.planViewMode";

/** The default view mode, used whenever no valid value is stored. */
const DEFAULT_RENDER_MODE: RenderMode = "rendered";

function isRenderMode(value: unknown): value is RenderMode {
  return value === "rendered" || value === "source";
}

/** Read the remembered view mode, defaulting to "rendered" on a missing,
 * unrecognized, or unreadable value. */
export function readRenderMode(): RenderMode {
  try {
    const stored = localStorage.getItem(RENDER_MODE_KEY);
    return isRenderMode(stored) ? stored : DEFAULT_RENDER_MODE;
  } catch {
    return DEFAULT_RENDER_MODE;
  }
}

/** Persist the chosen view mode. A storage failure is swallowed — the preference
 * is non-essential, so a write that can't land must not surface to the reviewer. */
export function writeRenderMode(mode: RenderMode): void {
  try {
    localStorage.setItem(RENDER_MODE_KEY, mode);
  } catch {
    // Storage unavailable (private mode, quota, disabled) — drop silently.
  }
}
