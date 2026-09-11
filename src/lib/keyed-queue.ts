// Runs async tasks one at a time per key, in the order they were queued. A key holds an
// entry only while a task on it is queued or running, so a long-lived daemon never
// accumulates keys.

export interface KeyedQueue {
  /** Run `task` once the previous task on `key` settles, whichever way it settled. The
   * returned promise is the task's own, so its failure still reaches this caller. */
  run(key: string, task: () => Promise<void>): Promise<void>;
}

/** `tails` holds the last task queued on each key. */
export function createKeyedQueue(tails = new Map<string, Promise<void>>()): KeyedQueue {
  return {
    run(key, task) {
      const next = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
      tails.set(key, next);
      // Only the tail drops itself: deleting a later task's entry would let the one after it
      // run beside it. Both arms, not finally — finally re-rejects, unhandled.
      const drop = () => {
        if (tails.get(key) === next) tails.delete(key);
      };
      void next.then(drop, drop);
      return next;
    },
  };
}
