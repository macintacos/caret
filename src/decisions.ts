// The decision pipe: a promise map keyed by reviewId that bridges the hook's
// long-poll (GET /api/reviews/:id/decision) and the browser's resolve
// (POST /api/reviews/:id/resolve). Either side may arrive first — the entry is
// created lazily by whichever does, so the order is irrelevant.
//
// This is a factory (not a module singleton) so each daemon owns its own
// registry and tests stay isolated.

import { type CaretLogger, noopLogger } from "./log.ts";
import type { Decision } from "./types.ts";

export interface DecisionRegistry {
  /** Await the decision for a review; resolves when resolveDecision is called. */
  awaitDecision(id: string): Promise<Decision>;
  /** Resolve a review's decision. Returns false if already settled. */
  resolveDecision(id: string, decision: Decision): boolean;
  /** Drop a review's entry (after the long-poll has read it). */
  clearDecision(id: string): void;
  /** Count of entries still awaiting a decision (idle-shutdown liveness). */
  openDecisionCount(): number;
}

interface Pending {
  promise: Promise<Decision>;
  resolve: (d: Decision) => void;
  settled: boolean;
}

export function createDecisions(log: CaretLogger = noopLogger): DecisionRegistry {
  const pending = new Map<string, Pending>();

  function ensure(id: string): Pending {
    let entry = pending.get(id);
    if (!entry) {
      let resolve!: (d: Decision) => void;
      const promise = new Promise<Decision>((r) => {
        resolve = r;
      });
      entry = { promise, resolve, settled: false };
      pending.set(id, entry);
    }
    return entry;
  }

  return {
    awaitDecision(id) {
      return ensure(id).promise;
    },
    resolveDecision(id, decision) {
      const entry = ensure(id);
      if (entry.settled) {
        // The /resolve handler's pending-only guard makes this near-impossible;
        // reaching it means two resolution paths raced — worth attention.
        log.warn("resolve", `decision already settled: ${id}`, { reviewId: id });
        return false;
      }
      entry.settled = true;
      entry.resolve(decision);
      return true;
    },
    clearDecision(id) {
      pending.delete(id);
    },
    openDecisionCount() {
      let n = 0;
      for (const entry of pending.values()) if (!entry.settled) n++;
      return n;
    },
  };
}
