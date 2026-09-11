// DRAIN_DEADLINE_MS's ceilings: each supervisor's SIGTERM→SIGKILL grace (the plist's
// ExitTimeOut, systemd's default stop timeout) and ensureDaemon's supervisor window.
// Spans server.ts, lifecycle.ts and both unit builders, so it keeps a descriptive leaf.
import { expect, test } from "bun:test";

import { fakeServiceConfig } from "@test/support/service-config.ts";
import { SUPERVISOR_WINDOW_MS } from "@/daemon/lifecycle.ts";
import { DRAIN_DEADLINE_MS } from "@/daemon/server.ts";
import { buildLaunchdPlist } from "@/service/launchd.ts";
import { buildSystemdUnit } from "@/service/systemd.ts";

// systemd's DefaultTimeoutStopSec.
const SYSTEMD_GRACE_MS = 90_000;

test("the drain ends inside ensureDaemon's supervisor window", () => {
  expect(DRAIN_DEADLINE_MS).toBeLessThan(SUPERVISOR_WINDOW_MS);
});

test("the drain ends inside the ExitTimeOut the launchd agent sets", () => {
  const exitTimeOut = buildLaunchdPlist(fakeServiceConfig()).match(
    /<key>ExitTimeOut<\/key>\s*<integer>(\d+)<\/integer>/,
  );
  expect(exitTimeOut).not.toBeNull();
  expect(DRAIN_DEADLINE_MS).toBeLessThan(Number(exitTimeOut?.[1]) * 1000);
});

test("the drain ends inside systemd's default stop timeout, which the unit keeps", () => {
  // TimeoutSec= sets the stop timeout too.
  expect(buildSystemdUnit(fakeServiceConfig())).not.toMatch(/^Timeout(Stop)?Sec=/m);
  expect(DRAIN_DEADLINE_MS).toBeLessThan(SYSTEMD_GRACE_MS);
});
