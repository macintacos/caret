import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewsDir, stateDir } from "../../src/config/paths.ts";
import { createStore, type Store } from "../../src/review/store.ts";
import type { Annotation, Review } from "../../src/lib/types.ts";
import { recordingLog } from "../support/recording-log.ts";
import { setupTempStateDir } from "../support/env.ts";

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

test("composer scratches round-trip to disk and rehydrate", async () => {
  const scratches = [{ startLine: 4, endLine: 6, text: "narrow this" }];
  await store.create(
    makeReview({
      id: "cs-1",
      status: "pending",
      versions: [
        {
          version: 1,
          plan: "# Plan\n\nbody",
          annotations: [],
          composerScratches: scratches,
          createdAt: 1,
        },
      ],
    }),
  );
  const onDisk = JSON.parse(await readFile(join(dir, "cs-1.json"), "utf-8")) as Review;
  expect(onDisk.versions[0]?.composerScratches).toEqual(scratches);
  // The persisted field survives a fresh store's rehydrate (unresolved record).
  const fresh = createStore(dir);
  await fresh.rehydrate();
  expect(fresh.get("cs-1")?.versions[0]?.composerScratches).toEqual(scratches);
});

test("expire clears persisted composer scratches", async () => {
  const scratches = [{ startLine: 1, endLine: 1, text: "wip" }];
  await store.create(
    makeReview({
      id: "cs-e1",
      versions: [
        {
          version: 1,
          plan: "# Plan\n\nbody",
          annotations: [],
          composerScratches: scratches,
          createdAt: 1,
        },
      ],
    }),
  );
  await store.expire("cs-e1");
  const onDisk = JSON.parse(await readFile(join(dir, "cs-e1.json"), "utf-8")) as Review;
  // terminal records keep no unsent draft — the current version's scratches are cleared
  expect(onDisk.versions[0]?.composerScratches).toEqual([]);
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

// ---- annotation-shape back-compat (EXC-573) ----

test("rehydrate loads a committed mixed-shape review fixture with no loss", async () => {
  // Falsifiable back-compat: the checked-in fixture carries one legacy
  // (selection-anchored) and one line-anchored annotation, run through the
  // real read path. A schema change that strands either shape fails here.
  const src = join(import.meta.dir, "fixtures", "review-mixed-annotations.json");
  const fixture = JSON.parse(await readFile(src, "utf-8"));
  await copyFile(src, join(dir, `${fixture.id}.json`));

  const fresh = createStore(dir);
  await fresh.rehydrate();
  expect(fresh.get(fixture.id)).toEqual(fixture);
});

test("store round-trips a freshly written mixed annotation array", async () => {
  const mixed: Annotation[] = [
    {
      id: "legacy-new",
      blockId: "b0",
      startOffset: 2,
      endOffset: 6,
      quote: "Plan",
      comment: "legacy shape",
    },
    { id: "line-new", startLine: 1, endLine: 2, comment: "line shape" },
  ];
  await store.create(makeReview({ id: "rt-1" }));
  await store.update("rt-1", (r) => {
    r.versions[0]!.annotations = mixed;
  });
  const fromDisk = await store.persisted("rt-1");
  expect(fromDisk?.versions[0]?.annotations).toEqual(mixed);
});

// ---- instrumentation (EXC-444) ----

test("rehydrate logs the loaded review count at info", async () => {
  await store.create(makeReview({ id: "h1", status: "pending" }));
  await store.create(makeReview({ id: "h2", status: "rejected" }));
  const { recs, log } = recordingLog();
  await createStore(dir, log).rehydrate();
  // Stable contract: an info-level "store" record reporting the loaded count.
  // The count (2) is the load-bearing datum; the surrounding prose is free to
  // be reworded, so match it loosely rather than pinning the exact message.
  const rec = recs.find((r) => r.level === "info" && r.step === "store");
  expect(rec?.msg).toContain("2");
});

test("rehydrate warns per corrupt review file it skips", async () => {
  await store.create(makeReview({ id: "good", status: "pending" }));
  await Bun.write(join(dir, "bad.json"), "{ truncated");
  const { recs, log } = recordingLog();
  const fresh = createStore(dir, log);
  await fresh.rehydrate();
  expect(fresh.size()).toBe(1); // the good one still loads
  // Stable contract: a warn-level "store" record naming the skipped file. The
  // filename is the load-bearing datum; match the surrounding prose loosely.
  const warn = recs.find((r) => r.level === "warn" && r.step === "store");
  expect(warn?.msg).toContain("bad.json");
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
  // Stable contract: a missing dir is a calm debug-level "store" event, never a
  // warn/error — that level distinction is the behavior under test, not the
  // exact prose. Exactly one record, at debug.
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ level: "debug", step: "store" });
  expect(recs.some((r) => r.level === "warn" || r.level === "error")).toBe(false);
});

test("each persist is logged at debug with the review id", async () => {
  const { recs, log } = recordingLog();
  await createStore(dir, log).create(makeReview({ id: "abc" }));
  // Stable contract: a debug-level "store" record carrying the reviewId in its
  // structured field. The id rides the durable `extra.reviewId`; the message
  // prose is free to be reworded, so it's not pinned exactly.
  const rec = recs.find(
    (r) =>
      r.level === "debug" && r.step === "store" && (r.extra as { reviewId?: string })?.reviewId,
  );
  expect(rec?.extra).toEqual({ reviewId: "abc" });
});

// ---- at-rest permissions (EXC-539) ----

// These mirror the production wiring — createStore(reviewsDir()) under a temp
// state dir — so the on-disk modes are asserted on the real persistence path.
describe("at-rest permissions", () => {
  // Mask off file-type/sticky bits; a dir-umask quirk can't perturb the assert.
  function perms(path: string): number {
    return statSync(path).mode & 0o777;
  }
  setupTempStateDir("caret-store-perm-");

  test("reviewsDir is 0700 and each <id>.json is 0600", async () => {
    const s = createStore(reviewsDir());
    await s.create(makeReview({ id: "perm-1" }));
    expect(perms(reviewsDir())).toBe(0o700);
    expect(perms(join(reviewsDir(), "perm-1.json"))).toBe(0o600);
  });

  test("a persist tightens a pre-existing 0755 state dir (create-order race)", async () => {
    // A no-mode caller (prefs/lock/spawn) created the root first; force it to
    // 0755 so the precondition is deterministic regardless of umask.
    mkdirSync(stateDir(), { recursive: true });
    chmodSync(stateDir(), 0o755);
    expect(perms(stateDir())).toBe(0o755);
    // Persisting routes through ensureStateDir(reviewsDir()), which chmods the
    // root back to 0700 — FAILS if the helper omits the chmod-if-exists step.
    await createStore(reviewsDir()).create(makeReview({ id: "race-1" }));
    expect(perms(stateDir())).toBe(0o700);
  });
});
