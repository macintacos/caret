// The machinery for the dev `--fresh` boot: it wipes every user-facing UI setting
// the browser persists (theme, diff prefs, first-run onboarding) so a
// brand-new-user session can be reproduced. The keys are not listed here — each pref
// module registers its own through definePref / defineFlagPref / registerPrefKey
// (definePref.ts), and clearKnownPrefs iterates the derived knownPrefKeys(). A pref
// that forgets to register fails prefKeys.test.ts rather than silently surviving
// `--fresh`. This file owns onboarding (a flag), the reset, and the per-boot
// sessionStorage guard.

import { defineFlagPref, knownPrefKeys } from "$lib/definePref.ts";

/** localStorage key: has the first-run onboarding been seen (dismissed or acted on). */
export const ONBOARDED_KEY = "caret.onboarded";

// Onboarding is a "1"/absent flag. defineFlagPref registers ONBOARDED_KEY for the
// `--fresh` reset and owns the never-throw fail-safe; the default onError (false)
// means an unreadable store reports not-onboarded, so onboarding can still show.
const onboardedPref = defineFlagPref(ONBOARDED_KEY);

/** Whether the user has seen (dismissed or acted on) first-run onboarding.
 * Fail-safe: an unreadable localStorage reports false, so onboarding can still show. */
export const hasOnboarded = onboardedPref.read;

/** Record that onboarding is done so it never shows again. A storage failure is
 * swallowed (onboarding may re-show next load — harmless). */
export const markOnboarded = (): void => onboardedPref.write(true);

/** Whether the first-run onboarding modal should open: only for a brand-new user
 * (never onboarded) whose notification permission is still undecided. A user who
 * has already granted or denied is never nagged. */
export function shouldShowOnboarding(permission: NotificationPermission): boolean {
  return !hasOnboarded() && permission === "default";
}

// sessionStorage key recording which daemon boot the dev `--fresh` reset has
// already run for. sessionStorage (per-tab), NOT localStorage and NOT a registered
// pref key: it is a session control marker, not a user preference, so
// clearKnownPrefs() must never touch it (prefKeys.test.ts excludes it explicitly).
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
  for (const key of knownPrefKeys()) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable — skip; best-effort reset.
    }
  }
}
