/** A minimal stand-in for the `(prefers-color-scheme: dark)` MediaQueryList, so
 * the OS-flip path is driven deterministically instead of slept through. */
export function fakeMediaQuery(matches: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  return {
    mql: {
      matches,
      addEventListener: (_t: "change", l: (e: { matches: boolean }) => void) => listeners.add(l),
      removeEventListener: (_t: "change", l: (e: { matches: boolean }) => void) =>
        listeners.delete(l),
    },
    flip(next: boolean) {
      for (const l of listeners) l({ matches: next });
    },
    listenerCount: () => listeners.size,
  };
}
