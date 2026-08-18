import { expect, test } from "bun:test";

import type { ClientReview } from "@/lib/types.ts";
import { type InjectDeps, injectKey } from "@/tasks/dev/inject.ts";

// Fake effects for one key press. `pending` is the daemon's GET /api/reviews
// order — oldest first, which is what makes "the last one" the background plan a
// reader sitting on the first is not looking at.
function fakeDeps(pending: string[] = []) {
  const calls = { seeded: 0, changed: [] as string[], logs: [] as string[] };
  const deps: InjectDeps = {
    listReviews: async () =>
      pending.map((id) => ({ id, title: `Plan ${id}` }) as unknown as ClientReview),
    seedNew: async () => {
      calls.seeded++;
    },
    requestChanges: async (id) => {
      calls.changed.push(id);
    },
    log: (msg) => calls.logs.push(msg),
  };
  return { deps, calls };
}

test("`n` seeds exactly one brand-new plan", async () => {
  // Line mode, so the chunk carries the newline the user pressed Enter with.
  const { deps, calls } = fakeDeps(["a", "b"]);
  await injectKey("n\n", deps);
  expect(calls.seeded).toBe(1);
  expect(calls.changed).toEqual([]);
});

test("`r` requests changes on the LAST pending review", async () => {
  // The last one is a background plan for a reader sitting on the first: its own
  // driver loop resubmits a revision onto the same review id (the revision rule).
  const { deps, calls } = fakeDeps(["a", "b", "c"]);
  await injectKey("r\n", deps);
  expect(calls.changed).toEqual(["c"]);
  expect(calls.seeded).toBe(0);
});

test("`r` with nothing pending changes nothing and says so", async () => {
  const { deps, calls } = fakeDeps([]);
  await injectKey("r\n", deps);
  expect(calls.changed).toEqual([]);
  expect(calls.logs).not.toEqual([]);
});

test("an unknown key or a bare Enter is a no-op", async () => {
  for (const key of ["", "\n", "x\n", "nr\n", " \n"]) {
    const { deps, calls } = fakeDeps(["a"]);
    await injectKey(key, deps);
    expect({ key, ...calls }).toEqual({ key, seeded: 0, changed: [], logs: [] });
  }
});
