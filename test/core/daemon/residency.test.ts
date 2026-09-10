// EXC-1164: a resident daemon stays up until told to stop. The aspect spans the
// daemon's idle machinery, the health body, and the systemd unit's restart window,
// so it keeps a descriptive leaf here rather than mirroring one module.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootDaemon, type TestDaemon } from "@test/support/daemon.ts";
import { fakeServiceConfig } from "@test/support/service-config.ts";
import type { HealthIdentity } from "@/lib/types.ts";
import { buildSystemdUnit } from "@/service/systemd.ts";

let dir: string;
let d: TestDaemon;

// Records every idle arm so a test can assert the idle path was never entered at all.
function recordingTimer() {
  const arms: number[] = [];
  return {
    arms,
    // A 1-based handle, like manualTimer's: armIdle's "already armed" guard and
    // cancelIdle both test the handle's truthiness, so a 0 would make both dead here
    // and a daemon that re-armed on every refresh would look correct.
    setTimer: (_fn: () => void, ms: number) => {
      arms.push(ms);
      return arms.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {},
  };
}

async function bootResident(resident: boolean, idleMs: number) {
  const timer = recordingTimer();
  d = await bootDaemon(dir, {
    resident,
    idleMs,
    prefsPath: join(dir, "prefs.json"),
    setIdleTimer: timer.setTimer,
    clearIdleTimer: timer.clearTimer,
    onShutdown: () => {},
  });
  return timer;
}

async function health(): Promise<HealthIdentity> {
  return (await (await fetch(`${d.url}/api/health`)).json()) as HealthIdentity;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-residency-"));
});
afterEach(async () => {
  d?.stop();
  await rm(dir, { recursive: true, force: true });
});

test("a resident daemon never arms the idle timer", async () => {
  // Not the same state as an idle timer set very far out: arms stays empty, so no
  // delay large enough to look like "stays up" can pass for residency here.
  const timer = await bootResident(true, 30);
  const id = await d.seed();
  await d.resolve(id, { behavior: "allow" });
  expect(timer.arms).toEqual([]);
});

test("a non-resident daemon still arms the idle timer", async () => {
  const timer = await bootResident(false, 30);
  expect(timer.arms).toEqual([30]);
});

test("/api/health reports resident: true when the daemon is resident", async () => {
  await bootResident(true, 30);
  expect((await health()).resident).toBe(true);
});

test("/api/health reports resident: false for a resident-aware daemon that is not", async () => {
  await bootResident(false, 30);
  const body = await health();
  expect(body.resident).toBe(false);
  // A dropped field and an explicit false are different answers to a peer probing
  // which handoff protocol to speak, so the field must survive JSON serialization.
  expect("resident" in body).toBe(true);
});

test("residency removes the idle exit that would park a systemd unit", async () => {
  const unit = buildSystemdUnit(fakeServiceConfig());
  const read = (key: string) => {
    const match = unit.match(new RegExp(`^${key}=(\\d+)$`, "m"));
    if (!match) throw new Error(`${key} missing from the generated unit`);
    return Number(match[1]);
  };
  // Below this, restart delay plus idle exit fits five starts inside the window and
  // systemd parks the unit in `failed` permanently. Read out of the generated unit so
  // the test tracks the real constants rather than restating them.
  const churnThresholdMs =
    (read("StartLimitIntervalSec") / read("StartLimitBurst") - read("RestartSec")) * 1000;
  expect(churnThresholdMs).toBeGreaterThan(0);
  const belowThreshold = Math.floor(churnThresholdMs / 2);

  // The hazard is real: a non-resident daemon does arm at this delay.
  expect((await bootResident(false, belowThreshold)).arms).toEqual([belowThreshold]);
  d.stop();

  // Residency removes it.
  const timer = await bootResident(true, belowThreshold);
  const id = await d.seed();
  await d.resolve(id, { behavior: "allow" });
  expect(timer.arms).toEqual([]);
});
