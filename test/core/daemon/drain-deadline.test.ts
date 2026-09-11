// DRAIN_DEADLINE_MS's ceilings: each supervisor's SIGTERM→SIGKILL grace, which neither
// generated unit overrides, and ensureDaemon's supervisor window. Spans server.ts,
// lifecycle.ts and both unit builders, so it keeps a descriptive leaf.
import { expect, test } from "bun:test";

import { fakeServiceConfig } from "@test/support/service-config.ts";
import { SUPERVISOR_WINDOW_MS } from "@/daemon/lifecycle.ts";
import { DRAIN_DEADLINE_MS } from "@/daemon/server.ts";
import { buildLaunchdPlist } from "@/service/launchd.ts";
import { buildSystemdUnit } from "@/service/systemd.ts";

// The supervisors' own defaults: launchd's ExitTimeOut, systemd's DefaultTimeoutStopSec.
const LAUNCHD_GRACE_MS = 20_000;
const SYSTEMD_GRACE_MS = 90_000;

test("the drain ends inside ensureDaemon's supervisor window", () => {
  expect(DRAIN_DEADLINE_MS).toBeLessThan(SUPERVISOR_WINDOW_MS);
});

test("the drain ends inside launchd's default grace, which the agent keeps", () => {
  expect(buildLaunchdPlist(fakeServiceConfig())).not.toContain("ExitTimeOut");
  expect(DRAIN_DEADLINE_MS).toBeLessThan(LAUNCHD_GRACE_MS);
});

test("the drain ends inside systemd's default stop timeout, which the unit keeps", () => {
  // TimeoutSec= sets the stop timeout too.
  expect(buildSystemdUnit(fakeServiceConfig())).not.toMatch(/^Timeout(Stop)?Sec=/m);
  expect(DRAIN_DEADLINE_MS).toBeLessThan(SYSTEMD_GRACE_MS);
});
