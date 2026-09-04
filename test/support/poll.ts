// Polling helpers: wait for an asynchronous condition without a fixed sleep.

/**
 * Poll `probe` until it returns a defined value or the budget elapses.
 *
 * The probe yields `undefined` while the condition is not yet met and the value
 * once it is. Throws on timeout so a stuck condition fails the test loudly
 * rather than hanging.
 */
export async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  ms = 5000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() - start > ms) throw new Error("waitFor: timed out");
    await Bun.sleep(20);
  }
}

/**
 * Poll a synchronous predicate until it's true or the budget elapses; returns
 * the predicate's final value (true on success, false on timeout) rather than
 * throwing, so callers can assert on it.
 */
export async function until(pred: () => boolean, ms = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return true;
    await Bun.sleep(20);
  }
  return pred();
}
