// Per-session review state for the pi extension. The notice (EXC-2316) and `/caret:plan`
// (EXC-2317) consume this store and never redefine it.
//
// The data lives on `globalThis` because `/reload` loads a fresh module instance; pi
// refuses `/reload` while a tool runs, so a pending review never straddles one. Only data
// is kept there, so each instance runs its own methods over it. That stored shape is a
// cross-version contract: bump the key when it changes. The listener set outlives
// `/reload` too, so subscribers must unsubscribe on `session_shutdown`.

export type ReviewOutcome = "approved" | "changes" | "cancelled" | "failed";

export interface SessionReview {
  /** The waiting review's URL; at most one per session, since the tool runs sequentially. */
  pending?: string;
  /** Whether the session is in caret's planning mode. */
  planning: boolean;
  /** How the session's most recent review ended. */
  lastOutcome?: ReviewOutcome;
}

export type ReviewListener = (sessionId: string, state: SessionReview) => void;

export interface ReviewStore {
  get(sessionId: string): SessionReview;
  update(sessionId: string, patch: Partial<SessionReview>): void;
  /** Returns the unsubscribe function. */
  subscribe(listener: ReviewListener): () => void;
}

type ReviewData = { sessions: Map<string, SessionReview>; listeners: Set<ReviewListener> };

const newData = (): ReviewData => ({ sessions: new Map(), listeners: new Set() });

function storeOver({ sessions, listeners }: ReviewData): ReviewStore {
  const get = (sessionId: string): SessionReview => sessions.get(sessionId) ?? { planning: false };
  return {
    get,
    update(sessionId, patch) {
      const next = { ...get(sessionId), ...patch };
      sessions.set(sessionId, next);
      for (const listener of listeners) {
        try {
          listener(sessionId, next);
        } catch {
          // A footer must never cost the review its decision.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createReviewStore(): ReviewStore {
  return storeOver(newData());
}

const DATA_KEY = Symbol.for("caret.pi.reviews.v1");

/** The process-wide store over data kept on `holder` (globalThis in production); every
 * call on one holder shares sessions and listeners. */
export function reviewStore(holder: Record<symbol, unknown>): ReviewStore {
  holder[DATA_KEY] ??= newData();
  return storeOver(holder[DATA_KEY] as ReviewData);
}

/** The text of the `caret` footer status key; undefined clears it. */
export function footerText(state: SessionReview): string | undefined {
  if (state.pending) return "^ plan waiting";
  if (state.planning) return "^ planning";
  return undefined;
}
