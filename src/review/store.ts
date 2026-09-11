// In-memory review map with write-through JSON persistence. Memory is the source
// of truth while running; each mutation is mirrored to <dir>/<id>.json. On
// startup, rehydrate() reloads only unresolved (pending/rejected) reviews —
// approved ones stay on disk as history but are not re-tracked.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ensureStateDir } from "@/config/paths.ts";
import { writeFileAtomic } from "@/lib/atomic-write.ts";
import { readJsonFile } from "@/lib/json-file.ts";
import { type CaretLogger, noopLogger, shortId } from "@/lib/log.ts";
import { currentVersion, isUnresolved, type Review } from "@/lib/types.ts";

export interface Store {
  create(review: Review): Promise<void>;
  get(id: string): Review | undefined;
  /** Pending reviews (drives the switcher), oldest-first. */
  list(): Review[];
  /** A session's in-memory reviews, newest-first (for revision threading). */
  bySession(sessionId: string): Review[];
  update(id: string, mutate: (r: Review) => void): Promise<Review | undefined>;
  /** Drop from memory; the on-disk file is left as history. */
  remove(id: string): Promise<void>;
  /** Terminal expiry (EXC-454): set "expired", clear the unsent draft, drop
   * from memory, and flush the final state to disk in one write (an expired
   * record never rehydrates). Returns undefined when the id isn't loaded. */
  expire(id: string): Promise<Review | undefined>;
  /** Read a review from disk by id, including approved history no longer in
   * memory. Returns undefined if the file is missing or unparseable. */
  persisted(id: string): Promise<Review | undefined>;
  size(): number;
  /** Count of reviews awaiting a decision. Drives idle: a `rejected` review is
   * NOT counted — it persists to disk and rehydrates when its revision arrives,
   * so it must not keep the daemon alive forever. */
  pendingCount(): number;
  rehydrate(): Promise<void>;
}

export function createStore(
  dir: string,
  log: CaretLogger = noopLogger,
  // Serialize writes per id: mutations land in order, and writeFileAtomic's temp is
  // shared by every write to one path.
  writeChains = new Map<string, Promise<void>>(),
): Store {
  const reviews = new Map<string, Review>();

  function persist(review: Review): Promise<void> {
    const prev = writeChains.get(review.id) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        ensureStateDir(dir);
        // 0600: the file holds the full unredacted plan body — never world-readable.
        await writeFileAtomic(join(dir, `${review.id}.json`), JSON.stringify(review, null, 2), {
          mode: 0o600,
        });
        log.debug("store", `review persisted: ${shortId(review.id)}`, { reviewId: review.id });
      });
    writeChains.set(review.id, next);
    // Only the tail drops itself: deleting a later persist's entry would let the next one
    // run beside it. Both arms, not finally — finally re-rejects into the daemon's fatal handler.
    const drop = () => {
      if (writeChains.get(review.id) === next) writeChains.delete(review.id);
    };
    void next.then(drop, drop);
    return next;
  }

  return {
    async create(review) {
      reviews.set(review.id, review);
      await persist(review);
    },

    get(id) {
      return reviews.get(id);
    },

    list() {
      return [...reviews.values()]
        .filter((r) => r.status === "pending")
        .sort((a, b) => a.createdAt - b.createdAt);
    },

    bySession(sessionId) {
      return [...reviews.values()]
        .filter((r) => r.sessionId === sessionId)
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async update(id, mutate) {
      const review = reviews.get(id);
      if (!review) return undefined;
      mutate(review);
      review.updatedAt = Math.max(Date.now(), review.updatedAt + 1);
      await persist(review);
      return review;
    },

    async remove(id) {
      const review = reviews.get(id);
      reviews.delete(id);
      // Flush any final state to disk before dropping the tracking entry.
      if (review) await persist(review);
    },

    async expire(id) {
      const review = reviews.get(id);
      if (!review) return undefined;
      review.status = "expired";
      // Same invariant as resolve: a terminal record keeps no unsent draft.
      review.generalCommentDraft = "";
      currentVersion(review).composerScratches = [];
      review.updatedAt = Math.max(Date.now(), review.updatedAt + 1);
      reviews.delete(id);
      await persist(review);
      return review;
    },

    async persisted(id) {
      // null on a missing or partial/corrupt file → the absent sentinel.
      return ((await readJsonFile(join(dir, `${id}.json`))) as Review | null) ?? undefined;
    },

    size() {
      return reviews.size;
    },

    pendingCount() {
      return [...reviews.values()].filter((r) => r.status === "pending").length;
    },

    async rehydrate() {
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        // No state dir yet — nothing to rehydrate (a normal first run).
        log.debug("store", "no reviews dir; nothing to rehydrate");
        return;
      }
      let loaded = 0;
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const review = JSON.parse(await readFile(join(dir, file), "utf-8")) as Review;
          if (isUnresolved(review.status)) {
            reviews.set(review.id, review);
            loaded++;
          }
        } catch {
          // Skip corrupt/partial files rather than crash on startup.
          log.warn("store", `skipping corrupt review file: ${file}`);
        }
      }
      if (loaded > 0) log.info("store", `rehydrated ${loaded} reviews`);
    },
  };
}
