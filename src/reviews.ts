// Revision threading state machine.
//
// session_id alone is insufficient: a distinct later plan in the same session
// would fold into the wrong thread. Rule: a new ExitPlanMode for a session
// APPENDS a version to its latest review ONLY IF that review is currently
// `rejected` (changes requested, awaiting revision); otherwise it starts a NEW
// thread. planEpoch is the session's approval count, stamped on each new thread,
// so a plan after an approval is provably a fresh thread.

import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import type { PlanInput, Review, RouteResult } from "./types.ts";

/** Derive a human title from the plan's first heading / non-empty line. */
export function deriveTitle(plan: string): string {
  for (const line of plan.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed.replace(/^#+\s*/, "").slice(0, 120) || "Untitled plan";
  }
  return "Untitled plan";
}

export async function routeIncomingPlan(input: PlanInput, store: Store): Promise<RouteResult> {
  const sessionId = input.sessionId ?? `anon-${Date.now()}`;
  const plan = input.plan ?? "";
  const now = Date.now();
  const latest = store.bySession(sessionId)[0];

  // Append only to a review currently awaiting revision.
  if (latest && latest.status === "rejected") {
    const version = latest.versions.length + 1;
    await store.update(latest.id, (r) => {
      r.versions.push({ version, plan, annotations: [], createdAt: now });
      r.status = "pending";
    });
    return {
      id: latest.id,
      action: "append",
      version,
      planEpoch: latest.planEpoch,
    };
  }

  // Otherwise start a new thread, stamped with the session's current epoch.
  const id = randomUUID();
  const planEpoch = store.epochOf(sessionId);
  const review: Review = {
    id,
    sessionId,
    cwd: input.cwd ?? "",
    title: input.title?.trim() || deriveTitle(plan),
    status: "pending",
    planEpoch,
    versions: [{ version: 1, plan, annotations: [], createdAt: now }],
    createdAt: now,
    updatedAt: now,
  };
  await store.create(review);
  return { id, action: "new", version: 1, planEpoch };
}
