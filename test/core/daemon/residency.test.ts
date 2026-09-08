// EXC-1164: a resident daemon stays up until told to stop. The aspect spans the
// server's idle machinery, the health body, and the systemd unit's restart window,
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

// Records every arm so a test can assert the idle path was never entered at all —
// armIdle is the daemon's only setTimer call site, which is what makes "never
// armed" a statement about idle shutdown rather than about timers in general.
function recordingTimer() {
  const arms: number[] = [];
  return {
    arms,
    setTimer: (_fn: () => void, ms: number) => {
      arms.push(ms);
      return 0 as unknown as ReturnType<typeof setTimeout>;
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
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
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

test("a resident daemon does not churn under systemd's start-limit window", async () => {
  const unit = buildSystemdUnit(fakeServiceConfig());
  const read = (key: string) => {
    const match = unit.match(new RegExp(`^${key}=(\\d+)$`, "m"));
    if (!match) throw new Error(`${key} missing from the generated unit`);
    return Number(match[1]);
  };
  // Below this, restart delay plus idle exit fits five starts inside the window and
  // systemd parks the unit in `failed` permanently.
  const churnThresholdMs =
    (read("StartLimitIntervalSec") / read("StartLimitBurst") - read("RestartSec")) * 1000;
  expect(churnThresholdMs).toBeGreaterThan(0);

  const timer = await bootResident(true, Math.floor(churnThresholdMs / 2));
  const id = await d.seed();
  await d.resolve(id, { behavior: "allow" });
  expect(timer.arms).toEqual([]);
});
