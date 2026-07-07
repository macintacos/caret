// Reconcile a plan decision made in the agent interface rather than caret's UI.
// Runs as the ExitPlanMode PostToolUse hook: the tool having succeeded means the
// plan was approved. If caret's UI never resolved that review — it is still
// `pending` on the daemon — then the approval happened in the terminal (a native
// fallback prompt, after the review hook produced no honored decision), so mirror
// it into the daemon by resolving the review as an allow. When no matching
// pending review exists, the UI already handled it (an approve removes it) and
// this is a no-op — the normal path, since this hook also fires on a UI approve.
//
// BEST-EFFORT: the plan is already approved, so this never gates anything. Every
// abnormal path (unparseable stdin, no daemon, a resolve that races the UI) is a
// silent no-op — runReconcile never throws and emits no decision.

import { type ErrorContext, logDebug, logInfo } from "./log.ts";
import type { PlanInput, ClientReview } from "./types.ts";

export interface ReconcileDeps {
  /** Normalize the agent's raw PostToolUse stdin into a core PlanInput. Throws on
   * input that can't be parsed — runReconcile swallows the throw (no-op). */
  parseHookInput: (stdin: string) => PlanInput;
  /** The daemon's pending reviews. Rejects when no daemon is reachable — treated
   * as "nothing to reconcile". */
  listReviews: () => Promise<ClientReview[]>;
  /** Resolve a review as approved, mirroring the UI's approve. */
  resolveReview: (id: string) => Promise<void>;
}

/** Reconcile a terminal plan approval into the daemon. Never throws. */
export async function runReconcile(stdin: string, deps: ReconcileDeps): Promise<void> {
  const ctx: ErrorContext = {};
  try {
    const input = deps.parseHookInput(stdin);
    ctx.sessionId = input.sessionId;
    // No session id → nothing to match a pending review against.
    if (!input.sessionId) return;
    // Supersede keeps at most one pending review per session, so a session-id
    // match is the review this ExitPlanMode just approved (or its latest revision).
    const match = (await deps.listReviews()).find((r) => r.sessionId === input.sessionId);
    if (!match) {
      logDebug("reconcile", "no pending review for session; nothing to reconcile", { ...ctx });
      return;
    }
    ctx.reviewId = match.id;
    await deps.resolveReview(match.id);
    logInfo("reconcile", "terminal approval reconciled", { ...ctx });
  } catch (err) {
    // Best-effort: the plan is already approved, so a failure here just leaves
    // the UI's stale-but-harmless pending review — never a deny, never a throw.
    logDebug("reconcile", "reconcile skipped", { ...ctx, err: String(err) });
  }
}
