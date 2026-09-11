import { expect, test } from "bun:test";

import { createKeyedQueue } from "@/lib/keyed-queue.ts";

const failing = () => Promise.reject(new Error("boom"));

/** A task that settles only when the test says so. */
function held(): { task: () => Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return { task: () => gate, release };
}

test("a task starts only once the previous task on its key settles", async () => {
  const queue = createKeyedQueue();
  const order: string[] = [];
  const gate = held();
  const first = queue.run("k", async () => {
    await gate.task();
    order.push("first");
  });
  const second = queue.run("k", async () => {
    order.push("second");
  });
  gate.release();
  await Promise.all([first, second]);
  expect(order).toEqual(["first", "second"]);
});

test("a failed task rejects its caller without blocking the next task on its key", async () => {
  const queue = createKeyedQueue();
  const failed = queue.run("k", failing);
  let ran = false;
  const next = queue.run("k", async () => {
    ran = true;
  });
  await expect(failed).rejects.toThrow("boom");
  await next;
  expect(ran).toBe(true);
});

test("a key's entry drops once its last task settles", async () => {
  const tails = new Map<string, Promise<void>>();
  const queue = createKeyedQueue(tails);
  await Promise.all(Array.from({ length: 20 }, (_, i) => queue.run(`k${i % 3}`, async () => {})));
  expect(tails.size).toBe(0);
});

test("a settled task keeps its key's entry while a later task on it is queued", async () => {
  const tails = new Map<string, Promise<void>>();
  const queue = createKeyedQueue(tails);
  const gate = held();
  const first = queue.run("k", async () => {});
  const second = queue.run("k", gate.task);
  await first;
  expect(tails.size).toBe(1);
  gate.release();
  await second;
  expect(tails.size).toBe(0);
});

test("a failed task still drops its key's entry", async () => {
  const tails = new Map<string, Promise<void>>();
  const queue = createKeyedQueue(tails);
  // Also pins .then(drop, drop): a .finally(drop) re-rejects unhandled, which fails this test.
  await expect(queue.run("k", failing)).rejects.toThrow("boom");
  expect(tails.size).toBe(0);
});
