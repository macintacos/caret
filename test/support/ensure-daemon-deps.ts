// No-op defaults for the EnsureDeps fields a takeover-loop scenario usually
// isn't exercising, so a test overrides only what it cares about.
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
