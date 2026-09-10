import { afterEach, expect, test } from "bun:test";

import { manualTimer } from "@test/support/manual-timer.ts";
import { type RecordedEmit, recordingLog } from "@test/support/recording-log.ts";
import { createLiveness, type Liveness, type LivenessDeps } from "@/daemon/liveness.ts";

// What holds the daemon up, read live by the deps so a test moves the world under a
// running liveness.
interface Held {
  pending: number;
  open: number;
  unread: number;
  uiPresent: boolean;
}

interface Harness {
  live: Liveness;
  timer: ReturnType<typeof manualTimer>;
  held: Held;
  releases: () => number;
  recs: RecordedEmit[];
}

const booted: Liveness[] = [];

function build(deps: Partial<LivenessDeps> = {}, held: Partial<Held> = {}): Harness {
  const timer = manualTimer();
  const { recs, log } = recordingLog();
  const state: Held = { pending: 0, open: 0, unread: 0, uiPresent: false, ...held };
  let releases = 0;
  const live = createLiveness({
    idleMs: 30,
    drainMs: 60_000,
    resident: false,
    pendingCount: () => state.pending,
    openDecisionCount: () => state.open,
    unreadDecisionCount: () => state.unread,
    uiPresent: () => state.uiPresent,
    release: () => {
      releases++;
    },
    log,
    setIdleTimer: timer.setTimer,
    clearIdleTimer: timer.clearTimer,
    ...deps,
  });
  booted.push(live);
  return { live, timer, held: state, releases: () => releases, recs };
}

// `held` is applied before arm(), which is when idle first arms.
function boot(deps: Partial<LivenessDeps> = {}, held: Partial<Held> = {}): Harness {
  const h = build(deps, held);
  h.live.arm();
  return h;
}

// Drain releases are re-checked a tick later, and timers run FIFO.
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  for (const live of booted.splice(0)) live.stop();
});

test("idle arms on arm(), not at construction", () => {
  const { live, timer } = build();
  expect(timer.pending()).toBe(false);
  live.arm();
  expect(timer.pending()).toBe(true);
});

test("a resident daemon never arms idle", () => {
  const { live, timer } = boot({ resident: true });
  live.begin("GET")();
  expect(timer.pending()).toBe(false);
});

test("idle stays disarmed while a review is pending", () => {
  const { live, timer, held } = boot({}, { pending: 1 });
  live.begin("GET")();
  expect(timer.pending()).toBe(false);
  held.pending = 0;
  live.begin("GET")();
  expect(timer.pending()).toBe(true);
});

test("a request cancels idle and its end re-arms it", () => {
  const { live, timer } = boot();
  const end = live.begin("GET");
  expect(timer.pending()).toBe(false);
  end();
  expect(timer.pending()).toBe(true);
});

test.each([
  ["an open decision", (h: Harness) => (h.held.open = 1)],
  ["a present UI", (h: Harness) => (h.held.uiPresent = true)],
  [
    "a request still in flight",
    // A second request's end re-arms idle while the first is still running.
    (h: Harness) => {
      h.live.begin("GET");
      h.live.begin("GET")();
    },
  ],
])("idle firing with %s re-arms instead of releasing", (_label, hold) => {
  const h = boot();
  hold(h);
  h.timer.fire();
  expect(h.releases()).toBe(0);
  expect(h.timer.pending()).toBe(true);
});

test("idle firing with nothing holding the daemon releases once", () => {
  const { timer, releases, recs } = boot();
  timer.fire();
  expect(releases()).toBe(1);
  expect(recs).toContainEqual(expect.objectContaining({ level: "info", step: "idle" }));
});

test("the drain owns the release: idle cannot end a drain that is still waiting", async () => {
  const { live, timer, held, releases } = boot();
  held.unread = 1;
  live.drain();
  // Once for the handle armed before the drain began, once for a request ending mid-drain.
  timer.fire();
  live.begin("GET")();
  timer.fire();
  await tick();
  expect(releases()).toBe(0);
});

test("a drain with nothing to wait for releases on the next tick", async () => {
  const { live, releases } = boot();
  live.drain();
  expect(releases()).toBe(0);
  await tick();
  expect(releases()).toBe(1);
});

test("an unread decision holds the drain until the request that reads it ends", async () => {
  const { live, held, releases } = boot();
  held.unread = 1;
  live.drain();
  await tick();
  expect(releases()).toBe(0);
  const end = live.begin("GET");
  held.unread = 0;
  end();
  await tick();
  expect(releases()).toBe(1);
});

test("a write in flight holds the drain until it ends", async () => {
  const { live, releases } = boot();
  const end = live.begin("POST");
  live.drain();
  await tick();
  expect(releases()).toBe(0);
  end();
  await tick();
  expect(releases()).toBe(1);
});

test("a read in flight does not hold the drain", async () => {
  const { live, releases } = boot();
  live.begin("GET");
  live.drain();
  await tick();
  expect(releases()).toBe(1);
});

test("a detached write holds the drain until it settles", async () => {
  const { live, releases } = boot();
  let settle!: () => void;
  const write = new Promise<void>((r) => {
    settle = r;
  });
  live.detachedWrite(write);
  live.drain();
  await tick();
  expect(releases()).toBe(0);
  settle();
  await write;
  await tick();
  expect(releases()).toBe(1);
});

test("a detached write that rejects still lets the drain release", async () => {
  const { live, releases } = boot();
  let fail!: (err: Error) => void;
  const write = new Promise<void>((_, reject) => {
    fail = reject;
  });
  live.detachedWrite(write);
  live.drain();
  fail(new Error("disk full"));
  await write.catch(() => {});
  await tick();
  expect(releases()).toBe(1);
});

test("the deadline releases a drain that never clears", async () => {
  const { live, held, releases, recs } = boot({ drainMs: 5 });
  held.unread = 1;
  live.begin("POST");
  live.drain();
  await Bun.sleep(20);
  expect(releases()).toBe(1);
  expect(recs.find((r) => r.step === "drain" && r.level === "warn")?.extra).toEqual({
    unread: 1,
    writes: 1,
  });
});

test("a drain releases once though its re-checks and deadline all come due", async () => {
  const { live, releases } = boot({ drainMs: 5 });
  live.drain();
  live.begin("GET")();
  await Bun.sleep(20);
  expect(releases()).toBe(1);
});

test("nothing releases after stop()", async () => {
  // A deadline that would fire on the first tick, were the drain allowed to start.
  const { live, timer, releases } = boot({ drainMs: 0 });
  live.stop();
  timer.fire();
  live.begin("GET")();
  timer.fire();
  live.drain();
  await tick();
  await tick();
  expect(releases()).toBe(0);
});
