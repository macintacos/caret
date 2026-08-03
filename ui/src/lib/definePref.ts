// The single source for browser-preference localStorage keys. Each pref is built
// through one of the factories here, which registers the key into a module-level
// set as a side effect — so the dev `--fresh` reset (clearKnownPrefs in prefs.ts)
// and its enforcing test (prefKeys.test.ts) derive the full key set from the
// definitions themselves, and a pref can't silently fall out of the reset set.
// enumLocalStoragePref.ts stays the deep never-throw module; definePref composes it
// and adds only registration + surfacing the KEY.

import { enumLocalStoragePref } from "$lib/enumLocalStoragePref.ts";

/** A localStorage-backed preference: its key plus a never-throw read/write pair. */
export interface Pref<T> {
  readonly KEY: string;
  read(): T;
  write(value: T): void;
}

// Every key a definePref/defineFlagPref/registerPrefKey call has registered. The
// set fills as each pref module loads — App's static import graph pulls every one
// in at boot, so it is complete before the `--fresh` reset (which runs after the
// health probe) reads it. Read it lazily via knownPrefKeys(): a captured array
// would snapshot before the later-loading pref modules register.
const PREF_KEYS = new Set<string>();

/** Register a preference key. For the factories below, and for a pref whose
 * read/write is too bespoke to fold into a factory (the file drawer's clamped
 * per-edge sizes) but which still must join the `--fresh` reset set. */
export function registerPrefKey(key: string): void {
  PREF_KEYS.add(key);
}

/** Every registered preference key, in registration order. `clearKnownPrefs`
 * (prefs.ts) clears each on `--fresh`, and prefs.test.ts asserts every persisted
 * `caret.*` localStorage key in the source appears here. A function, not a
 * captured array, so keys registered after any given caller loads still count. */
export function knownPrefKeys(): readonly string[] {
  return [...PREF_KEYS];
}

/** An enum preference over a fixed set of string values, keyed in localStorage.
 * Reuses enumLocalStoragePref for the never-throw allow-list fail-safe (a
 * missing, unrecognized, or unreadable value degrades to `fallback`) and
 * registers the key. */
export function definePref<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): Pref<T> {
  registerPrefKey(key);
  const pref = enumLocalStoragePref<T>(key, allowed, fallback);
  return { KEY: key, read: pref.read, write: pref.write };
}

/** A boolean flag persisted as `"1"` (set) / absent (unset), keyed in
 * localStorage, and registered. `onError` is returned when storage itself throws
 * (blocked / private mode), which is distinct from a normal unset read: first-run
 * onboarding fails safe to false (still offer to onboard), the drag-hint
 * dismissal fails safe to true (don't nag when storage is unavailable). */
export function defineFlagPref(key: string, { onError = false } = {}): Pref<boolean> {
  registerPrefKey(key);
  return {
    KEY: key,
    read(): boolean {
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return onError;
      }
    },
    write(value: boolean): void {
      try {
        if (value) localStorage.setItem(key, "1");
        else localStorage.removeItem(key);
      } catch {
        // Storage unavailable (private mode, quota, disabled) — drop silently.
      }
    },
  };
}
