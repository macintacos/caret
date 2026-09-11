// No-op defaults for the EnsureDeps fields a takeover-loop scenario usually
// isn't exercising, so a test overrides only what it cares about.
import type { EnsureDeps } from "@/daemon/lifecycle.ts";

type EnsureDaemonNoOps = Pick<
  EnsureDeps,
  | "readLock"
  | "isAlive"
  | "retire"
  | "removeLock"
  | "spawn"
  | "backoff"
  | "maxAttempts"
  | "now"
  | "windowMs"
>;

export function ensureDaemonNoOps(maxAttempts = 5): EnsureDaemonNoOps {
  return {
    readLock: () => null,
    isAlive: () => false,
    retire: async () => true,
    removeLock: () => {},
    spawn: () => {},
    backoff: async () => {},
    maxAttempts,
    // No deadline: the attempt caps alone bound the call.
    now: () => 0,
    windowMs: Number.POSITIVE_INFINITY,
  };
}
