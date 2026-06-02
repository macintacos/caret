// In-memory review map with write-through JSON persistence. Memory is the source
// of truth while running; each mutation is mirrored to <dir>/<id>.json. On
// startup, rehydrate() reloads only unresolved (pending/rejected) reviews —
// approved ones stay on disk as history but are not re-tracked.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  size(): number;
  rehydrate(): Promise<void>;
}

export function createStore(dir: string): Store {
  const reviews = new Map<string, Review>();
  // Serialize writes per id so concurrent mutations never interleave on one file.
  const writeChains = new Map<string, Promise<void>>();

  function persist(review: Review): Promise<void> {
    const prev = writeChains.get(review.id) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${review.id}.json`), JSON.stringify(review, null, 2));
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

    size() {
      return reviews.size;
    },

    async rehydrate() {
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        return; // No state dir yet — nothing to rehydrate.
      }
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const review = JSON.parse(await readFile(join(dir, file), "utf-8")) as Review;
          if (isUnresolved(review.status)) reviews.set(review.id, review);
        } catch {
          // Skip corrupt/partial files rather than crash on startup.
        }
      }
    },
  };
}
