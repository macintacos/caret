// The browser's side of the update surface (EXC-1207) — both halves of "what does this
// browser know about updates before the next fetch", which is why they share a module.
//
// The toasted marker is an arbitrary signature string, so neither definePref (an enum)
// nor defineFlagPref (a boolean) fits; it takes the bespoke read/write plus
// registerPrefKey that definePref.ts already documents for exactly this case (the file
// drawer's clamped sizes, the sound volume), so it still joins the `--fresh` reset and
// prefKeys.test.ts's scan.
//
// `updates.check` owns no browser key at all — the daemon holds it. What lives here is
// the synchronous holder the registry's daemon-backed field closes over in its read():
// daemonField shadows read() only after a landed write, so read() still has to answer
// for the value on disk at load, and App seeds it from GET /api/prefs.

import { registerPrefKey } from "$lib/definePref.ts";

/** localStorage key holding the update signature this browser has already toasted. */
export const UPDATE_TOASTED_KEY = "caret.updateToasted";

registerPrefKey(UPDATE_TOASTED_KEY);

/** The update signature (see updateSignature) this browser has already toasted, or null
 * when it has toasted none. Never throws: an unreadable store degrades to null, which
 * costs at most one repeated toast. */
export function readToastedUpdate(): string | null {
  try {
    return localStorage.getItem(UPDATE_TOASTED_KEY);
  } catch {
    return null;
  }
}

/** Record that this signature has been toasted, so the same version never nags twice. A
 * storage failure is swallowed — the nudge is non-essential and must not surface. */
export function writeToastedUpdate(signature: string): void {
  try {
    localStorage.setItem(UPDATE_TOASTED_KEY, signature);
  } catch {
    // Storage unavailable (private mode, quota, disabled) — drop silently.
  }
}

// Default-on, matching the daemon's own readUpdatesCheck: a load whose prefs fetch never
// lands behaves exactly as an un-opted-out install does.
let updatesCheck = true;

/** Whether the daemon's update check is on, as last seeded. Synchronous because the
 * settings registry's read() is.
 *
 * Named for the seeding rather than for a read, and deliberately: the daemon exports a
 * `readUpdatesCheck` too (src/config/prefs.ts) that actually opens prefs.json, while this
 * one answers from a RAM cell that reports the optimistic default until App has seeded
 * it. A caller reaching for this before the load fetch lands gets a confident guess, so
 * the name says where the value comes from. */
export const seededUpdatesCheck = (): boolean => updatesCheck;

/** Seed the holder from the daemon's answer (App, on load). */
export function seedUpdatesCheck(value: boolean): void {
  updatesCheck = value;
}
