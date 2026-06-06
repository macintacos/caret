import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type Store } from "../src/store.ts";
import type { Review } from "../src/types.ts";
import { recordingLog } from "./support/recording-log.ts";

let dir: string;
let store: Store;

function makeReview(over: Partial<Review> = {}): Review {
  const id = over.id ?? "rev-1";
  return {
    id,
    sessionId: over.sessionId ?? "sess-1",
    cwd: over.cwd ?? "/tmp/proj",
    title: over.title ?? "Plan",
    status: over.status ?? "pending",
    planEpoch: over.planEpoch ?? 0,
    versions: over.versions ?? [
      { version: 1, plan: "# Plan\n\nbody", annotations: [], createdAt: 1 },
    ],
    createdAt: over.createdAt ?? 1,
    updatedAt: over.updatedAt ?? 1,
    decision: over.decision,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-store-"));
  store = createStore(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("create then get round-trips and writes a JSON file", async () => {
  const r = makeReview({ id: "abc" });
  await store.create(r);
  expect(store.get("abc")).toEqual(r);
  const onDisk = JSON.parse(await readFile(join(dir, "abc.json"), "utf-8"));
  expect(onDisk.id).toBe("abc");
  expect(onDisk.versions[0].plan).toBe("# Plan\n\nbody");
});

test("list returns only pending reviews, sorted by createdAt", async () => {
  await store.create(makeReview({ id: "p1", status: "pending", createdAt: 2 }));
  await store.create(makeReview({ id: "p0", status: "pending", createdAt: 1 }));
  await store.create(makeReview({ id: "a1", status: "approved" }));
  await store.create(makeReview({ id: "r1", status: "rejected" }));
  expect(store.list().map((r) => r.id)).toEqual(["p0", "p1"]);
});

test("update mutates, bumps updatedAt, and persists", async () => {
  await store.create(makeReview({ id: "u1", updatedAt: 1 }));
  const updated = await store.update("u1", (r) => {
    r.status = "approved";
  });
  expect(updated?.status).toBe("approved");
  expect(updated?.updatedAt).toBeGreaterThan(1);
  const onDisk = JSON.parse(await readFile(join(dir, "u1.json"), "utf-8"));
  expect(onDisk.status).toBe("approved");
});

test("update on a missing id returns undefined and persists nothing", async () => {
  expect(await store.update("ghost", (r) => (r.status = "approved"))).toBeUndefined();
  expect(store.size()).toBe(0);
  // No file is written for an id the store never tracked.
  await expect(readFile(join(dir, "ghost.json"), "utf-8")).rejects.toThrow();
});

test("remove drops from memory but leaves the file on disk", async () => {
  await store.create(makeReview({ id: "x1" }));
  await store.remove("x1");
  expect(store.get("x1")).toBeUndefined();
  expect(store.size()).toBe(0);
  // File persists as history.
  const onDisk = JSON.parse(await readFile(join(dir, "x1.json"), "utf-8"));
  expect(onDisk.id).toBe("x1");
});

test("remove flushes the final mutated state before dropping the entry", async () => {
  await store.create(makeReview({ id: "f1", status: "pending" }));
  await store.update("f1", (r) => {
    r.status = "approved";
    r.decision = { behavior: "allow", decidedAt: 7 };
  });
  await store.remove("f1");
  expect(store.get("f1")).toBeUndefined();
  // The on-disk history reflects the last in-memory state, not the create-time one.
  const onDisk = JSON.parse(await readFile(join(dir, "f1.json"), "utf-8")) as Review;
  expect(onDisk.status).toBe("approved");
  expect(onDisk.decision).toMatchObject({ behavior: "allow" });
});

test("pendingCount counts only pending reviews", async () => {
  expect(store.pendingCount()).toBe(0);
  await store.create(makeReview({ id: "pc-p1", status: "pending" }));
  await store.create(makeReview({ id: "pc-p2", status: "pending" }));
  await store.create(makeReview({ id: "pc-r", status: "rejected" }));
  await store.create(makeReview({ id: "pc-a", status: "approved" }));
  expect(store.pendingCount()).toBe(2);
});

test("size reflects the in-memory map", async () => {
  expect(store.size()).toBe(0);
  await store.create(makeReview({ id: "s1" }));
  await store.create(makeReview({ id: "s2" }));
  expect(store.size()).toBe(2);
});

test("bySession returns a session's reviews newest-first", async () => {
  await store.create(makeReview({ id: "old", sessionId: "S", createdAt: 1 }));
  await store.create(makeReview({ id: "new", sessionId: "S", createdAt: 5 }));
  await store.create(makeReview({ id: "other", sessionId: "T", createdAt: 9 }));
  expect(store.bySession("S").map((r) => r.id)).toEqual(["new", "old"]);
});

test("session epoch starts at 0 and bumps independently per session", () => {
  expect(store.epochOf("S")).toBe(0);
  store.bumpEpoch("S");
  store.bumpEpoch("S");
  expect(store.epochOf("S")).toBe(2);
  expect(store.epochOf("OTHER")).toBe(0);
});

test("persisted reads a review (incl. decision) from disk, even after remove", async () => {
  await store.create(
    makeReview({ id: "d1", status: "approved", decision: { behavior: "allow", decidedAt: 5 } }),
  );
  await store.remove("d1"); // gone from memory, file kept as history
  expect(store.get("d1")).toBeUndefined();

  const fromDisk = await store.persisted("d1");
  expect(fromDisk?.id).toBe("d1");
  expect(fromDisk?.decision).toMatchObject({ behavior: "allow" });
  // Unknown id → undefined, not a throw.
  expect(await store.persisted("missing")).toBeUndefined();
});

test("persisted returns undefined for a partial/corrupt file", async () => {
  await Bun.write(join(dir, "trunc.json"), "{ partial");
  expect(await store.persisted("trunc")).toBeUndefined();
});

test("rehydrate loads unresolved reviews, skips approved", async () => {
  await store.create(makeReview({ id: "keep-p", status: "pending" }));
  await store.create(makeReview({ id: "keep-r", status: "rejected" }));
  await store.create(makeReview({ id: "drop-a", status: "approved" }));

  const fresh = createStore(dir);
  await fresh.rehydrate();
  // Both unresolved reviews are tracked; the approved one is not re-tracked.
  expect(fresh.size()).toBe(2);
  expect(fresh.get("keep-p")?.status).toBe("pending");
  expect(fresh.get("keep-r")?.status).toBe("rejected");
  expect(fresh.get("drop-a")).toBeUndefined();
});

test("expire marks terminal, clears the draft, persists once, and drops from memory", async () => {
  await store.create({ ...makeReview({ id: "e1" }), generalCommentDraft: "wip note" });
  const expired = await store.expire("e1");
  expect(expired?.status).toBe("expired");
  expect(store.get("e1")).toBeUndefined();
  const onDisk = JSON.parse(await readFile(join(dir, "e1.json"), "utf-8")) as Review;
  expect(onDisk.status).toBe("expired");
  expect(onDisk.generalCommentDraft).toBe(""); // terminal records keep no unsent draft
  // Unknown id → undefined, not a throw.
  expect(await store.expire("missing")).toBeUndefined();
});

test("rehydrate skips expired reviews", async () => {
  // The terminal-on-disk contract the EXC-454 expiry paths rely on: a record
  // persisted as "expired" must never reload as an approvable orphan.
  await store.create(makeReview({ id: "drop-e", status: "expired" }));
  const fresh = createStore(dir);
  await fresh.rehydrate();
  expect(fresh.size()).toBe(0);
  expect(fresh.get("drop-e")).toBeUndefined();
});

// ---- instrumentation (EXC-444) ----

test("rehydrate logs the loaded review count at info", async () => {
  await store.create(makeReview({ id: "h1", status: "pending" }));
  await store.create(makeReview({ id: "h2", status: "rejected" }));
  const { recs, log } = recordingLog();
  await createStore(dir, log).rehydrate();
  expect(recs).toContainEqual({
    level: "info",
    step: "store",
    msg: "rehydrated 2 reviews",
    extra: undefined,
  });
});

test("rehydrate warns per corrupt review file it skips", async () => {
  await store.create(makeReview({ id: "good", status: "pending" }));
  await Bun.write(join(dir, "bad.json"), "{ truncated");
  const { recs, log } = recordingLog();
  const fresh = createStore(dir, log);
  await fresh.rehydrate();
  expect(fresh.size()).toBe(1); // the good one still loads
  const warn = recs.find((r) => r.level === "warn");
  expect(warn?.step).toBe("store");
  expect(warn?.msg).toBe("skipping corrupt review file: bad.json");
});

test("rehydrate tolerates corrupt files among valid and resolved records", async () => {
  // A mixed dir: a corrupt file, a valid unresolved review, and an approved
  // one. The corrupt file is skipped (not a crash), the unresolved review
  // loads, and the approved record is left on disk without being re-tracked.
  await store.create(makeReview({ id: "live", status: "pending" }));
  await store.create(makeReview({ id: "done", status: "approved" }));
  await Bun.write(join(dir, "junk.json"), "not json at all");

  const fresh = createStore(dir);
  await fresh.rehydrate();
  expect(fresh.size()).toBe(1);
  expect(fresh.get("live")?.status).toBe("pending");
  expect(fresh.get("done")).toBeUndefined();
});

test("rehydrate with no state dir logs at debug, not warn", async () => {
  const { recs, log } = recordingLog();
  await createStore(join(dir, "missing"), log).rehydrate();
  expect(recs).toEqual([
    {
      level: "debug",
      step: "store",
      msg: "no reviews dir; nothing to rehydrate",
      extra: undefined,
    },
  ]);
});

test("each persist is logged at debug with the review id", async () => {
  const { recs, log } = recordingLog();
  await createStore(dir, log).create(makeReview({ id: "abc" }));
  expect(recs).toContainEqual({
    level: "debug",
    step: "store",
    msg: "review persisted: abc",
    extra: { reviewId: "abc" },
  });
});
