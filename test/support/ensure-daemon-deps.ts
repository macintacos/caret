// Sensible no-op defaults for the EnsureDeps fields a takeover-loop scenario
// usually isn't exercising — readLock/isAlive/retire/removeLock/spawn/backoff —
// so a test overrides only the fields its scenario cares about.
import type { EnsureDeps } from "@/daemon/lifecycle.ts";

type EnsureDaemonNoOps = Pick<
  EnsureDeps,
  "readLock" | "isAlive" | "retire" | "removeLock" | "spawn" | "backoff" | "maxAttempts"
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
  };
}
