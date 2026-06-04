// In-memory review map with write-through JSON persistence. Memory is the source
// of truth while running; each mutation is mirrored to <dir>/<id>.json. On
// startup, rehydrate() reloads only unresolved (pending/rejected) reviews —
// approved ones stay on disk as history but are not re-tracked.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CaretLogger, noopLogger, shortId } from "./log.ts";
import { isUnresolved, type Review } from "./types.ts";

export interface Store {
  create(review: Review): Promise<void>;
  get(id: string): Review | undefined;
  /** Pending reviews (drives the switcher), oldest-first. */
  list(): Review[];
  /** Every in-memory review. */
  all(): Review[];
  /** A session's in-memory reviews, newest-first (for revision threading). */
  bySession(sessionId: string): Review[];
  update(id: string, mutate: (r: Review) => void): Promise<Review | undefined>;
  /** Drop from memory; the on-disk file is left as history. */
  remove(id: string): Promise<void>;
  /** Read a review from disk by id, including approved history no longer in
   * memory. Returns undefined if the file is missing or unparseable. */
  persisted(id: string): Promise<Review | undefined>;
  size(): number;
  /** Count of reviews awaiting a decision. Drives idle: a `rejected` review is
   * NOT counted — it persists to disk and rehydrates when its revision arrives,
   * so it must not keep the daemon alive forever. */
  pendingCount(): number;
  /** Current approval epoch for a session (count of approvals so far). */
  epochOf(sessionId: string): number;
  /** Increment a session's approval epoch (called on each approval). */
  bumpEpoch(sessionId: string): void;
  rehydrate(): Promise<void>;
}

export function createStore(dir: string, log: CaretLogger = noopLogger): Store {
  const reviews = new Map<string, Review>();
  // Per-session approval epoch (in-memory; resets when the daemon restarts).
  const epochs = new Map<string, number>();
  // Serialize writes per id so concurrent mutations never interleave on one file.
  const writeChains = new Map<string, Promise<void>>();

  function persist(review: Review): Promise<void> {
    const prev = writeChains.get(review.id) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${review.id}.json`), JSON.stringify(review, null, 2));
        log.debug("store", `review persisted: ${shortId(review.id)}`, { reviewId: review.id });
      });
    writeChains.set(review.id, next);
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

    all() {
      return [...reviews.values()];
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

    async persisted(id) {
      try {
        return JSON.parse(await readFile(join(dir, `${id}.json`), "utf-8")) as Review;
      } catch {
        return undefined; // missing or partial/corrupt file
      }
    },

    size() {
      return reviews.size;
    },

    pendingCount() {
      let n = 0;
      for (const r of reviews.values()) if (r.status === "pending") n++;
      return n;
    },

    epochOf(sessionId) {
      return epochs.get(sessionId) ?? 0;
    },

    bumpEpoch(sessionId) {
      epochs.set(sessionId, (epochs.get(sessionId) ?? 0) + 1);
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
