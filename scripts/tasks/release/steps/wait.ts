// A bounded poll: re-run a probe until it reports done or the attempts run out.

/** Poll `probe` up to `attempts` times, sleeping `intervalMs` between tries.
 * Returns the first done probe, or the last one on exhaustion so the caller can
 * report what it last saw. */
export async function waitFor<T>(
  opts: { attempts: number; intervalMs: number; sleep: (ms: number) => Promise<void> },
  probe: () => Promise<{ done: boolean; value: T }>,
): Promise<{ done: boolean; value: T }> {
  let last = await probe();
  for (let i = 1; i < opts.attempts && !last.done; i++) {
    await opts.sleep(opts.intervalMs);
    last = await probe();
  }
  return last;
}
