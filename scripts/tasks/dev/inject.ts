// Keyboard injection for the dev task: the two events that produce an unread
// marker, on demand, so both rules are watchable live under `mise run dev`
// instead of only unit-tested (EXC-411).
//
//   n — seed a brand-new plan under a fresh session, so a fresh review id
//       appears while you are reading another one: the ARRIVAL rule.
//   r — request changes on the LAST pending review, which is a background plan
//       for a reader sitting on the first. That review's own driver loop appends
//       a "Revision N" section and resubmits onto the same review id: the
//       REVISION rule.
//
// One artifact of the `r` path: the daemon's GET /api/reviews is pending-only
// (store.list), so between the deny and the loop's resubmit the plan is briefly
// absent from the list. A UI poll tick landing in that sub-second window sees it
// leave and come back, and marks it as an arrival rather than a revision. The
// mark is correct either way; only which rule produced it differs.
//
// Pure handler over injected effects; scripts/tasks/dev/driver.ts wires the real
// daemon calls behind them.

import type { ClientReview } from "@/lib/types.ts";

export interface InjectDeps {
  /** The daemon's pending reviews (GET /api/reviews), oldest first. */
  listReviews: () => Promise<ClientReview[]>;
  /** Seed a genuinely-new review under a fresh session. */
  seedNew: () => Promise<void>;
  /** Record reviewer feedback on a review (POST /api/reviews/:id/resolve, deny). */
  requestChanges: (id: string) => Promise<void>;
  log: (msg: string) => void;
}

/** Handle one key typed into the dev task's stdin; unknown keys are ignored.
 * Takes the raw chunk — stdin is read in line mode, so the trailing newline
 * arrives with the key. */
export async function injectKey(key: string, deps: InjectDeps): Promise<void> {
  const k = key.trim();
  if (k === "n") {
    deps.log("injecting a new plan under a fresh session");
    await deps.seedNew();
    return;
  }
  if (k !== "r") return;
  const last = (await deps.listReviews()).at(-1);
  if (!last) {
    deps.log("no pending review to request changes on");
    return;
  }
  deps.log(`requesting changes on "${last.title}" → its loop appends a revision`);
  await deps.requestChanges(last.id);
}
