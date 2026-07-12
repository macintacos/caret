// Generic localStorage-backed enum preference. Both read and write fail safe and
// never throw: a blocked or unavailable localStorage (private mode, disabled
// storage) degrades to the fallback rather than breaking the caller. Callers
// supply the storage key, the exhaustive set of valid values, and the default;
// see diffStylePref.ts and diffIndicatorsPref.ts for the concrete instances.

export interface EnumLocalStoragePref<T extends string> {
  /** Read the stored value, or `fallback` on a missing, unrecognized, or
   * unreadable value. */
  read(): T;
  /** Persist a value. A storage failure is swallowed. */
  write(value: T): void;
}

/** Build a localStorage-backed preference over a fixed set of string values.
 * `allowed` is the exhaustive set of valid stored values; anything else — or an
 * unreadable store — degrades to `fallback`. */
export function enumLocalStoragePref<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): EnumLocalStoragePref<T> {
  const isAllowed = (value: unknown): value is T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value);
  return {
    read() {
      try {
        const stored = localStorage.getItem(key);
        return isAllowed(stored) ? stored : fallback;
      } catch {
        return fallback;
      }
    },
    write(value: T): void {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage unavailable (private mode, quota, disabled) — drop silently.
      }
    },
  };
}
