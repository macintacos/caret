import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recordingLog } from "@test/support/recording-log.ts";
import { currentVersion, type PlanInput, type Review } from "@/lib/types.ts";
import { formatPlanMarkdown } from "@/plan/markdown.ts";
import { createStore, type Store } from "@/review/store.ts";
import { newReviewId, routeIncomingPlan } from "@/review/threading.ts";

let dir: string;
let store: Store;

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  sessionId: "S",
  cwd: "/p",
  plan: "# Title\n\nbody",
  ...over,
});

test("newReviewId is short, URL-safe, and unique (EXC-691: keeps the review URL on one toast line)", () => {
  const id = newReviewId();
  // The review URL is `http://caret.localhost:42718/?review=${id}` (37-char
  // prefix). Keeping the id short keeps that URL under OpenCode's ~54-col toast
  // width, so it word-wraps whole onto one line and stays terminal-clickable.
  expect(id.length).toBeLessThanOrEqual(16);
  // base64url charset only — no chars that would break a terminal's URL match.
  expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(newReviewId()).not.toBe(id);
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

test("appending a revision does not carry the prior version's composer scratches", async () => {
  // Scratches are version-scoped (like annotations): a draft anchored to v1's text
  // must not resurface on v2, where its line anchor would be stale.
  const { id } = await routeIncomingPlan(input({ plan: "# V1\n\nbody" }), store);
  await store.update(id, (r) => {
    currentVersion(r).composerScratches = [{ startLine: 1, endLine: 1, text: "wip" }];
    r.status = "rejected"; // a deny is what lets the next plan append a version
  });
  await routeIncomingPlan(input({ plan: "# V2\n\nrevised" }), store);
  const r = store.get(id) as Review;
  expect(r.versions).toHaveLength(2);
  // v2 (current) starts clean; v1 keeps its own scratch.
  expect(currentVersion(r).composerScratches).toBeUndefined();
  expect(r.versions[0]?.composerScratches).toEqual([{ startLine: 1, endLine: 1, text: "wip" }]);
});

test("rewrites the agent's on-disk plan file with the canonical formatted text", async () => {
  // The plan file Claude reads from must match what the human reviews. Routing a
  // plan whose prose prettier reflows should leave the canonical text on disk,
  // not the raw text the agent first wrote.
  const planFilePath = join(dir, "agent-plan.md");
  writeFileSync(planFilePath, "raw, never read back");
  const raw = `# Title\n\n${"a long sentence that prettier will reflow ".repeat(6)}`;
  await routeIncomingPlan(input({ plan: raw, planFilePath }), store);
  const canonical = await formatPlanMarkdown(raw, recordingLog().log);
  expect(canonical).not.toBe(raw); // proseWrap actually changed the text
  expect(readFileSync(planFilePath, "utf8")).toBe(canonical);
});

test("canonicalizes the plan file on a revision, not just the first version", async () => {
  const first = await routeIncomingPlan(input({ plan: "# T\n\nv1" }), store);
  await reject(first.id);
  const planFilePath = join(dir, "revision.md");
  writeFileSync(planFilePath, "raw revision");
  const raw = `# T\n\n${"reflow me ".repeat(20)}`;
  const r = await routeIncomingPlan(input({ plan: raw, planFilePath }), store);
  expect(r.action).toBe("append");
  const canonical = await formatPlanMarkdown(raw, recordingLog().log);
  expect(readFileSync(planFilePath, "utf8")).toBe(canonical);
});

test("a plan after a rejection appends version 2 to the same review", async () => {
  const a = await routeIncomingPlan(input(), store);
  await reject(a.id);
  const b = await routeIncomingPlan(input({ plan: "# v2\n\nrevised" }), store);
  expect(b).toMatchObject({ id: a.id, action: "append", version: 2 });
  const rev = store.get(a.id);
  expect(rev?.status).toBe("pending");
  expect(rev?.versions.map((v) => v.version)).toEqual([1, 2]);
  expect(rev?.versions[1]?.plan).toBe("# v2\n\nrevised\n");
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

// ---- ingest-time canonicalization (EXC-574) --------------------------------

const UNWRAPPED =
  "# Wrap\n\nthis paragraph is one long unwrapped line that the ingest pass rewraps via prettier into the canonical stored representation of the plan text";

test("a new thread stores prettier-formatted plan text", async () => {
  const r = await routeIncomingPlan(input({ plan: UNWRAPPED }), store);
  const stored = store.get(r.id)?.versions[0]?.plan ?? "";
  expect(stored).toBe(await formatPlanMarkdown(UNWRAPPED));
  expect(stored).not.toBe(UNWRAPPED);
});

test("a revision stores prettier-formatted plan text", async () => {
  const a = await routeIncomingPlan(input(), store);
  await reject(a.id);
  const b = await routeIncomingPlan(input({ plan: UNWRAPPED }), store);
  expect(b).toMatchObject({ id: a.id, action: "append", version: 2 });
  const stored = store.get(a.id)?.versions[1]?.plan ?? "";
  expect(stored).toBe(await formatPlanMarkdown(UNWRAPPED));
  expect(stored).not.toBe(UNWRAPPED);
});

test("already-stored versions are never reformatted by a later ingest", async () => {
  const a = await routeIncomingPlan(input(), store);
  // A stored version that bypassed canonicalization (the raw fallback path).
  await store.update(a.id, (r) => {
    const v1 = r.versions[0];
    if (v1) v1.plan = UNWRAPPED;
    r.status = "rejected";
  });
  const b = await routeIncomingPlan(input({ plan: "# v2\n\nx" }), store);
  expect(b).toMatchObject({ id: a.id, action: "append", version: 2 });
  expect(store.get(a.id)?.versions[0]?.plan).toBe(UNWRAPPED);
});
