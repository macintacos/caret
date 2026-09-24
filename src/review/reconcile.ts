// Reconcile a plan decision made in the agent interface rather than caret's UI.
// Runs as the agent's post-plan-approval hook: an approval having fired means the
// plan was accepted. If caret's UI never resolved that review — it is still
// `pending` on the daemon — then the approval happened outside caret's UI (the
// agent's own approval path, taken when the review hook produced no honored
// decision), so mirror it into the daemon by resolving the review as an allow.
// When no matching pending review exists, the UI already handled it (an approve
// removes it) and this is a no-op — the normal path, since this hook also fires
// on a UI approve.
//
// BEST-EFFORT: the plan is already approved, so this never gates anything. Every
// abnormal path (unparseable stdin, no daemon, a resolve that races the UI) is a
// silent no-op — runReconcile never throws and emits no decision. The specific
// hook wiring (which agent event triggers it) lives in the command + adapter
// layer, keeping this core agent-agnostic.

import { type LogContext, logDebug, logInfo } from "@/lib/log.ts";
import type { ClientReview } from "@/lib/types.ts";
import type { ParsedHookInput } from "@/review/orchestrate.ts";

export interface ReconcileDeps {
  /** The daemon's pending reviews. Rejects when no daemon is reachable — treated
   * as "nothing to reconcile". */
  listReviews: () => Promise<ClientReview[]>;
  /** Resolve a review as approved, mirroring the UI's approve. */
  resolveReview: (id: string) => Promise<void>;
}

/** Reconcile a terminal plan approval into the daemon. A failed parse is a no-op.
 * Never throws. */
export async function runReconcile(parsed: ParsedHookInput, deps: ReconcileDeps): Promise<void> {
  const ctx: LogContext = {};
  try {
    if ("error" in parsed) throw parsed.error;
    const input = parsed.input;
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
