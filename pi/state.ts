/**
 * Per-session review state for the pi extension. The notice (EXC-2316) and
 * `/caret:plan` (EXC-2317) consume this store and never redefine it.
 *
 * The store lives on `globalThis` because `/reload` loads a fresh module
 * instance; pi refuses `/reload` while a tool runs, so a pending review never
 * straddles one.
 */

export type ReviewOutcome = "approved" | "changes" | "cancelled" | "failed";

export interface SessionReview {
  /** The waiting review's URL; at most one per session, since the tool runs sequentially. */
  pending?: string;
  /** Set by /caret:plan (EXC-2317). */
  planning: boolean;
  lastOutcome?: ReviewOutcome;
}

export type ReviewListener = (sessionId: string, state: SessionReview) => void;

export interface ReviewStore {
  get(sessionId: string): SessionReview;
  update(sessionId: string, patch: Partial<SessionReview>): void;
  /** Returns the unsubscribe function. */
  subscribe(listener: ReviewListener): () => void;
}

export function createReviewStore(): ReviewStore {
  const sessions = new Map<string, SessionReview>();
  const listeners = new Set<ReviewListener>();
  const get = (sessionId: string): SessionReview => sessions.get(sessionId) ?? { planning: false };
  return {
    get,
    update(sessionId, patch) {
      const next = { ...get(sessionId), ...patch };
      sessions.set(sessionId, next);
      for (const listener of listeners) listener(sessionId, next);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const STORE_KEY = Symbol.for("caret.pi.reviews");

/** The process-wide store, kept on `holder` (globalThis in production) under
 * Symbol.for("caret.pi.reviews"). */
export function reviewStore(holder: Record<symbol, unknown>): ReviewStore {
  holder[STORE_KEY] ??= createReviewStore();
  return holder[STORE_KEY] as ReviewStore;
}

/** The text of the `caret` footer status key; undefined clears it. */
export function footerText(state: SessionReview): string | undefined {
  if (state.pending) return "^ plan waiting";
  if (state.planning) return "^ planning";
  return undefined;
}
