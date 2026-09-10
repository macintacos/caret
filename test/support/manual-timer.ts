// A controllable stand-in for the daemon's idle timer: captures the scheduled
// callback so a test fires it on demand (`fire()`) instead of racing a real
// `idleMs` delay. The idle timer is armed at boot with no request in flight, so
// under load the real one can fire in the boot->first-request window and shut the
// daemon down before the test's first request lands (EXC-647). Inject setTimer/
// clearTimer as the idle-timer seam and the daemon arms/cancels through them exactly
// as it would the real timer — the arm/cancel/refresh logic stays real, only the
// delay is deterministic.
export function manualTimer(): {
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  fire: () => void;
  pending: () => boolean;
} {
  let scheduled: (() => void) | null = null;
  let handle = 0;
  return {
    setTimer: (fn) => {
      scheduled = fn;
      handle += 1;
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (h) => {
      if ((h as unknown as number) === handle) scheduled = null;
    },
    // Run the armed callback (a no-op if nothing is scheduled). Cleared first so a
    // re-arm inside the callback (maybeShutdown's else-branch) schedules afresh.
    fire: () => {
      const fn = scheduled;
      scheduled = null;
      fn?.();
    },
    pending: () => scheduled !== null,
  };
}
