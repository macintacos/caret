// No-op defaults for the EnsureDeps fields a takeover-loop scenario usually
// isn't exercising, so a test overrides only what it cares about.
import type { BootMarker, BootMarkerStore, EnsureDeps, EnsureTiming } from "@/daemon/lifecycle.ts";

export type EnsureDaemonNoOps = Pick<
  EnsureDeps,
  "readLock" | "isAlive" | "retire" | "removeLock" | "spawn" | "bootMarker" | "timing"
>;

/** A boot marker held in memory; share one between calls to model one state dir. */
export function memoryBootMarker(initial: BootMarker | null = null): BootMarkerStore {
  let marker = initial;
  return {
    claim: (claimed) => {
      if (marker) return false;
      marker = claimed;
      return true;
    },
    assign: (pid) => {
      marker = { pid, claimedAt: marker?.claimedAt ?? 0 };
    },
    read: () => marker,
    clear: () => {
      marker = null;
    },
  };
}

/** Timing that never sleeps and sets no deadline: the attempt cap alone bounds the call. */
export function noOpTiming(maxAttempts = 5): EnsureTiming {
  return {
    backoff: async () => {},
    maxAttempts,
    now: () => 0,
    wallNow: () => 0,
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
    spawn: () => 1,
    bootMarker: memoryBootMarker(),
    timing: noOpTiming(maxAttempts),
  };
}
