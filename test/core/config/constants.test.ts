import { describe, expect, test } from "bun:test";

import {
  BUN_SOCKET_IDLE_CAP_S,
  deriveIdleTimeoutSec,
  hasKnownFileExtension,
  IDLE_TIMEOUT_HEADROOM_S,
  MAX_HEARTBEAT_MS,
} from "@/config/constants.ts";
import { DEFAULTS } from "@/config/settings.ts";

// The falsifiable invariant the transport audit asks for (EXC-533): the
// Bun.serve socket idleTimeout, derived from the resolved heartbeat, must always
// sit strictly above the heartbeat window AND at or below Bun's 255s hard cap —
// across the whole configurable heartbeat range (min, default, max allowed). If
// a future edit drifts the formula or the bound apart, this fails instead of a
// long-poll silently idling out mid-wait.

/** The endpoints of the accepted heartbeat range plus the schema default. The
 * max is one below the exclusive `.lt(MAX_HEARTBEAT_MS)` bound — the largest
 * value the schema admits. */
const RANGE_MS = [
  1, // smallest positive heartbeat the schema admits
  DEFAULTS.daemon.heartbeat_ms, // 8000
  MAX_HEARTBEAT_MS - 1, // largest accepted heartbeat
];

test("derived idleTimeout exceeds the heartbeat across the configurable range", () => {
  for (const heartbeatMs of RANGE_MS) {
    const idleSec = deriveIdleTimeoutSec(heartbeatMs);
    expect(idleSec * 1000).toBeGreaterThan(heartbeatMs);
  }
});

test("derived idleTimeout never exceeds Bun's 255s socket cap", () => {
  for (const heartbeatMs of RANGE_MS) {
    expect(deriveIdleTimeoutSec(heartbeatMs)).toBeLessThanOrEqual(BUN_SOCKET_IDLE_CAP_S);
  }
});

test("the headroom stays intact at the heartbeat ceiling (clamp never bites in range)", () => {
  // At the largest accepted heartbeat the derivation equals the cap exactly, so
  // the Math.min clamp never eats into the headroom for any in-range value.
  expect(deriveIdleTimeoutSec(MAX_HEARTBEAT_MS - 1)).toBe(BUN_SOCKET_IDLE_CAP_S);
  expect(MAX_HEARTBEAT_MS).toBe((BUN_SOCKET_IDLE_CAP_S - IDLE_TIMEOUT_HEADROOM_S) * 1000);
});

test("the default heartbeat derives a comfortable idleTimeout", () => {
  // 8000ms heartbeat → ceil(8) + 5s headroom = 13s, well above the heartbeat.
  expect(deriveIdleTimeoutSec(8_000)).toBe(13);
});

// hasKnownFileExtension is the narrowing both runtimes apply on top of the
// path-shaped gate (EXC-916): the daemon's bounded basename walk fires only for
// a file-shaped name, and the link layer folds it into a broader test — a
// collapsed `[label](target)` earns a reference only if its target is file-shaped
// or spans more than one segment (EXC-956). Its edges decide whether a reference gets an
// affordance and whether a 5,000-dirent walk runs, so they are pinned here.
describe("hasKnownFileExtension", () => {
  test.each([
    ["a bare filename", "api.ts"],
    ["a path's last segment", "ui/src/lib/api.ts"],
    ["an uppercase extension", "README.MD"],
    ["a multi-dot name", "vite.config.ts"],
  ])("accepts %s", (_name, path) => {
    expect(hasKnownFileExtension(path)).toBe(true);
  });

  test.each([
    ["an extensionless word", "dist"],
    ["a directory path", "src/daemon"],
    ["a trailing slash, which leaves no last segment", "src/daemon/"],
    ["a dotfile, which has no name before the dot", ".env"],
    ["a bare extension", ".ts"],
    ["an unknown extension", "obj.property"],
    ["a fragment glued to the extension", "doc/guide.md#setup"],
    ["the empty string", ""],
  ])("refuses %s", (_name, path) => {
    expect(hasKnownFileExtension(path)).toBe(false);
  });
});
