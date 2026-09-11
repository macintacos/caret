// No-op defaults for the EnsureDeps fields a takeover-loop scenario usually
// isn't exercising, so a test overrides only what it cares about.
import type { EnsureDeps, EnsureTiming } from "@/daemon/lifecycle.ts";

type EnsureDaemonNoOps = Pick<
  EnsureDeps,
  "readLock" | "isAlive" | "retire" | "removeLock" | "spawn" | "timing"
>;

/** Timing that never sleeps and sets no deadline: the attempt cap alone bounds the call. */
export function noOpTiming(maxAttempts = 5): EnsureTiming {
  return {
    backoff: async () => {},
    maxAttempts,
    now: () => 0,
    windowMs: Number.POSITIVE_INFINITY,
    reserveMs: 0,
  };
}

export function ensureDaemonNoOps(maxAttempts = 5): EnsureDaemonNoOps {
  return {
    readLock: () => null,
    isAlive: () => false,
    retire: async () => true,
    removeLock: () => {},
    spawn: () => {},
    timing: noOpTiming(maxAttempts),
  };
}
