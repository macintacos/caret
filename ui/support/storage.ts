/** Run `body` with `localStorage` replaced by a getter that throws, mirroring a
 * blocked or private-mode store; restores the original afterward. */
export function withBlockedStorage(body: () => void): void {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  try {
    body();
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
  }
}

/** Run `body` with a `localStorage` that is present but whose accessors throw — the
 * failure a quota or a disabled origin actually produces, and a different branch from
 * `withBlockedStorage`, where the store itself is unreachable. Restores the original
 * afterward. */
export function withThrowingStorage(body: () => void): void {
  const original = globalThis.localStorage;
  const poisoned = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: poisoned });
  try {
    body();
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
  }
}
