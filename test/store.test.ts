import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type Store } from "../src/store.ts";
import type { Review } from "../src/types.ts";
import { recordingLog } from "./recording-log.ts";

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
