import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type Store } from "../src/store.ts";
import type { Review } from "../src/types.ts";

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

test("remove drops from memory but leaves the file on disk", async () => {
  await store.create(makeReview({ id: "x1" }));
  await store.remove("x1");
  expect(store.get("x1")).toBeUndefined();
  expect(store.size()).toBe(0);
  // File persists as history.
  const onDisk = JSON.parse(await readFile(join(dir, "x1.json"), "utf-8"));
  expect(onDisk.id).toBe("x1");
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

test("rehydrate loads unresolved reviews, skips approved", async () => {
  await store.create(makeReview({ id: "keep-p", status: "pending" }));
  await store.create(makeReview({ id: "keep-r", status: "rejected" }));
  await store.create(makeReview({ id: "drop-a", status: "approved" }));

  const fresh = createStore(dir);
  await fresh.rehydrate();
  const ids = fresh
    .all()
    .map((r) => r.id)
    .sort();
  expect(ids).toEqual(["keep-p", "keep-r"]);
});
