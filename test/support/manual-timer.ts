// A controllable stand-in for the daemon's idle timer: it holds the one scheduled
// callback so a test fires it on demand (`fire()`) instead of racing a real delay.
// Handles are 1-based because liveness tests a handle's truthiness; a 0 would make
// its "already armed" guard and its cancel both dead.
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
