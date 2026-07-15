// The registry of user-facing UI settings persisted in the browser (theme, diff
// prefs, first-run onboarding). It exists so the dev `--fresh` boot can wipe every
// one of them from a single place to reproduce a brand-new-user session.
//
// When you add a new user-facing setting that persists in localStorage, add its
// key to KNOWN_PREF_KEYS below — otherwise `mise run dev --fresh` won't reset it,
// and you won't be able to re-test the first-run experience for that setting.
//
// Read/write are fail-safe like enumLocalStoragePref.ts: a blocked or unavailable
// localStorage degrades rather than throwing.

import { DIFF_INDICATORS_KEY } from "$lib/diffIndicatorsPref.ts";
import { DIFF_STYLE_KEY } from "$lib/diffStylePref.ts";
import { THEME_KEY } from "$lib/theme.ts";

/** localStorage key: has the first-run onboarding been seen (dismissed or acted on). */
export const ONBOARDED_KEY = "caret.onboarded";

/** Every localStorage key holding a user-facing UI setting. `--fresh` clears all
 * of them to reproduce a brand-new-user session — register new settings here. */
export const KNOWN_PREF_KEYS: readonly string[] = [
  THEME_KEY,
  DIFF_INDICATORS_KEY,
  DIFF_STYLE_KEY,
  ONBOARDED_KEY,
];

/** Whether the user has seen (dismissed or acted on) first-run onboarding.
 * Fail-safe: an unreadable localStorage reports false, so onboarding can still show. */
export function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Record that onboarding is done so it never shows again. A storage failure is
 * swallowed (onboarding may re-show next load — harmless). */
export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // Storage unavailable (private mode, quota, disabled) — drop silently.
  }
}

/** Whether the first-run onboarding modal should open: only for a brand-new user
 * (never onboarded) whose notification permission is still undecided. A user who
 * has already granted or denied is never nagged. */
export function shouldShowOnboarding(permission: NotificationPermission): boolean {
  return !hasOnboarded() && permission === "default";
}

// sessionStorage key recording which daemon boot the dev `--fresh` reset has
// already run for. sessionStorage (per-tab), NOT localStorage and NOT a
// KNOWN_PREF_KEYS entry: it is a session control marker, not a user preference,
// so clearKnownPrefs() must never touch it.
const FRESH_APPLIED_KEY = "caret.freshApplied";

/** Whether the dev `--fresh` browser reset has already run for this daemon boot.
 * The daemon reports `fresh: true` on every `/api/health` for its whole life, so
 * without this guard every page reload would re-clear prefs and re-open
 * onboarding — "Maybe later" would never stick. Keyed on the daemon's per-boot
 * instanceId so a new `mise run dev --fresh` boot (new instanceId) resets again,
 * while reloads of the same session do not. Fail-safe: an unreadable store
 * reports not-applied, so the reset still runs. */
export function freshResetApplied(instanceId: string | undefined): boolean {
  try {
    return sessionStorage.getItem(FRESH_APPLIED_KEY) === (instanceId ?? "");
  } catch {
    return false;
  }
}

/** Record that the `--fresh` reset ran for this daemon boot. A storage failure is
 * swallowed (the reset may run again on the next load — harmless). */
export function markFreshResetApplied(instanceId: string | undefined): void {
  try {
    sessionStorage.setItem(FRESH_APPLIED_KEY, instanceId ?? "");
  } catch {
    // Storage unavailable — the reset may repeat next load; not worth failing over.
  }
}

/** Remove every known UI preference, returning the browser to a new-user state.
 * Used by the dev `--fresh` boot; fail-safe per key. */
export function clearKnownPrefs(): void {
  for (const key of KNOWN_PREF_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable — skip; best-effort reset.
    }
  }
}
