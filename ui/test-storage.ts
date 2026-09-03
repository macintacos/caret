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
