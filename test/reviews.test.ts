import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routeIncomingPlan } from "../src/reviews.ts";
import { createStore, type Store } from "../src/store.ts";
import type { PlanInput, Review } from "../src/types.ts";
import { recordingLog } from "./support/recording-log.ts";

let dir: string;
let store: Store;

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  sessionId: "S",
  cwd: "/p",
  plan: "# Title\n\nbody",
  ...over,
});

// Mirror what the daemon's resolve handler does on each decision.
async function reject(id: string) {
  await store.update(id, (r) => {
    r.status = "rejected";
  });
}
async function approve(id: string) {
  const r = store.get(id);
  if (!r) throw new Error("no review");
  await store.update(id, (x) => {
    x.status = "approved";
  });
  store.bumpEpoch(r.sessionId);
  await store.remove(id);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-reviews-"));
  store = createStore(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("first plan for a session starts a new thread (v1, epoch 0)", async () => {
  const r = await routeIncomingPlan(input({ plan: "# Hello\n\nx" }), store);
  expect(r).toMatchObject({ action: "new", version: 1, planEpoch: 0 });
  expect(store.get(r.id)?.title).toBe("Hello");
});

test("a plan after a rejection appends version 2 to the same review", async () => {
  const a = await routeIncomingPlan(input(), store);
  await reject(a.id);
  const b = await routeIncomingPlan(input({ plan: "# v2\n\nrevised" }), store);
  expect(b).toMatchObject({ id: a.id, action: "append", version: 2 });
  const rev = store.get(a.id);
  expect(rev?.status).toBe("pending");
  expect(rev?.versions.map((v) => v.version)).toEqual([1, 2]);
  expect(rev?.versions[1]?.plan).toBe("# v2\n\nrevised");
});

test("reject/append/reject/append chains on one review", async () => {
  const a = await routeIncomingPlan(input(), store);
  await reject(a.id);
  const b = await routeIncomingPlan(input({ plan: "v2" }), store);
  await reject(b.id);
  const c = await routeIncomingPlan(input({ plan: "v3" }), store);
  expect(b.id).toBe(a.id);
  expect(c).toMatchObject({ id: a.id, action: "append", version: 3 });
});

test("a plan after an approval starts a new thread with a bumped epoch", async () => {
  const a = await routeIncomingPlan(input(), store);
  await approve(a.id);
  const b = await routeIncomingPlan(input({ plan: "# next\n\ny" }), store);
  expect(b).toMatchObject({ action: "new", version: 1, planEpoch: 1 });
  expect(b.id).not.toBe(a.id);
});

test("a plan arriving while a review is still pending starts a new thread", async () => {
  const a = await routeIncomingPlan(input(), store);
  const b = await routeIncomingPlan(input({ plan: "# other\n\nz" }), store);
  expect(b).toMatchObject({ action: "new" });
  expect(b.id).not.toBe(a.id);
});

// ---- stale-pending supersede (EXC-454) ----

test("resubmitting while the latest review is pending expires the orphan", async () => {
  const a = await routeIncomingPlan(input(), store);
  const b = await routeIncomingPlan(input(), store);
  expect(b.action).toBe("new");
  expect(b.expired).toEqual([a.id]);
  expect(store.get(a.id)).toBeUndefined(); // dropped from memory
  expect(store.list().map((r) => r.id)).toEqual([b.id]); // exactly one approvable review
  // Terminal on disk: a still-pending record would rehydrate as an orphan.
  expect((await store.persisted(a.id))?.status).toBe("expired");
});

test("an orphan pending behind a rejected latest is expired; the revision still appends", async () => {
  const a = await routeIncomingPlan(input(), store);
  await reject(a.id);
  // Simulate a pre-fix orphan: an older pending review for the same session
  // (the router can no longer produce one, but on-disk state can rehydrate it).
  const orphan: Review = {
    id: "orphan",
    sessionId: "S",
    cwd: "/p",
    title: "stale",
    status: "pending",
    planEpoch: 0,
    versions: [{ version: 1, plan: "old", annotations: [], createdAt: 1 }],
    createdAt: 1,
    updatedAt: 1,
  };
  await store.create(orphan);
  const b = await routeIncomingPlan(input({ plan: "v2" }), store);
  expect(b).toMatchObject({ id: a.id, action: "append", version: 2 });
  expect(b.expired).toEqual(["orphan"]);
  expect((await store.persisted("orphan"))?.status).toBe("expired");
  expect(store.list().map((r) => r.id)).toEqual([a.id]); // only the re-pended thread remains
});

test("superseding logs review superseded with the orphan's id", async () => {
  const a = await routeIncomingPlan(input(), store);
  const { recs, log } = recordingLog();
  await routeIncomingPlan(input(), store, log);
  expect(recs).toContainEqual({
    level: "info",
    step: "review",
    msg: `review superseded: ${a.id.slice(0, 8)}`,
    extra: { reviewId: a.id, sessionId: "S", action: "supersede" },
  });
});

test("two interleaved sessions never cross-contaminate", async () => {
  const s1 = await routeIncomingPlan(input({ sessionId: "S1" }), store);
  const s2 = await routeIncomingPlan(input({ sessionId: "S2" }), store);
  await reject(s1.id);
  const s1b = await routeIncomingPlan(input({ sessionId: "S1", plan: "s1 v2" }), store);
  const s2b = await routeIncomingPlan(input({ sessionId: "S2", plan: "s2 again" }), store);
  expect(s1b).toMatchObject({ id: s1.id, action: "append" }); // appended to S1
  expect(s2b.action).toBe("new"); // S2 was pending -> new thread
  expect(s2b.id).not.toBe(s2.id);
});

// ---- instrumentation (EXC-444) ----

test("routing a new plan logs review created with full threading context", async () => {
  const { recs, log } = recordingLog();
  const r = await routeIncomingPlan(input(), store, log);
  // The msg carries only an 8-char id prefix; the full id rides in extra.
  expect(recs).toContainEqual({
    level: "info",
    step: "review",
    msg: `review created: ${r.id.slice(0, 8)}`,
    extra: { reviewId: r.id, sessionId: "S", action: "new", version: 1, planEpoch: 0 },
  });
});

test("appending a revision logs review appended with the version", async () => {
  const a = await routeIncomingPlan(input(), store);
  await reject(a.id);
  const { recs, log } = recordingLog();
  await routeIncomingPlan(input({ plan: "# v2\n\nrevised" }), store, log);
  expect(recs).toContainEqual({
    level: "info",
    step: "review",
    msg: `review appended: ${a.id.slice(0, 8)} v2`,
    extra: { reviewId: a.id, sessionId: "S", action: "append", version: 2, planEpoch: 0 },
  });
});

test("property: appends only follow a rejection, never crossing an approval", async () => {
  // A scripted sequence of events; assert the invariant after each plan.
  const events = ["plan", "reject", "plan", "approve", "plan", "reject", "plan", "plan"] as const;
  let lastId: string | null = null;
  let lastStatusWasRejected = false;
  for (const ev of events) {
    if (ev === "plan") {
      const r = await routeIncomingPlan(input({ plan: `p-${Math.random()}` }), store);
      if (lastStatusWasRejected) {
        expect(r.action).toBe("append");
      } else {
        expect(r.action).toBe("new");
      }
      lastId = r.id;
      lastStatusWasRejected = false;
    } else if (ev === "reject" && lastId) {
      await reject(lastId);
      lastStatusWasRejected = true;
    } else if (ev === "approve" && lastId) {
      await approve(lastId);
      lastStatusWasRejected = false;
      lastId = null;
    }
  }
});
