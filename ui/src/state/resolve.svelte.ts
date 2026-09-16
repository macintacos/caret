// Approve / request-changes / reject resolve flow.
//
// Approving (allow) or requesting changes (deny) flushes any pending draft,
// POSTs the decision, and advances to the next review. The approve mode is
// remembered per browser, persisted on each landed approve. A daemon non-2xx
// (already resolved/removed elsewhere) still advances; only a genuine network
// failure flips the connection offline.

import { PLAN_REJECTED_MESSAGE } from "@core/config/constants";
import type { Annotation, ApproveVariantId } from "@core/lib/types";
import { HttpError, resolveReview } from "$lib/api.ts";
import { writeApproveMode } from "$lib/approveModePref.ts";
import { formatFeedback } from "$lib/feedback.ts";

export { HttpError };

/** Whether a thrown API error is a daemon non-2xx (the daemon answered) rather
 * than a real network failure — only the latter flips the connection offline. */
export function isNetworkFailure(err: unknown): boolean {
  return !(err instanceof HttpError);
}

export interface ResolveDeps {
  /** Resolve a review. Defaults to the api client's resolveReview. */
  resolveReview?: typeof resolveReview;
  /** Persist the approve mode this browser should default to next. Defaults to the
   * localStorage-backed writeApproveMode. */
  saveApproveMode?: (mode: ApproveVariantId) => void;
  /** The id of the active review, or null. */
  activeId: () => string | null;
  /** The working-copy annotations to format into deny feedback. */
  annotations: () => Annotation[];
  /** The active review's current plan text, used to quote a line-anchored
   * annotation's source lines into the deny feedback. */
  planText: () => string;
  /** Flush any pending draft before submitting (snapshot-before-await). */
  flushPending: () => Promise<void>;
  /** Drop the resolved review and auto-advance. */
  afterResolve: (id: string) => void;
  /** Mark the daemon offline on a genuine network failure. */
  onOffline: () => void;
  /** Clear the local general-comment draft after a deny clears it server-side. */
  clearGeneralComment: () => void;
}

/** Backing fields the resolve flow reads and writes. */
export interface ResolveStore {
  /** Remembered approve variant id, or null when this browser has none yet. */
  approveMode: ApproveVariantId | null;
  /** True while a resolve POST is in flight. */
  busy: boolean;
}

export interface Resolve {
  readonly approveMode: ApproveVariantId | null;
  readonly busy: boolean;

  /** Approve the plan. Optional `notes` ride the allow as feedback (EXC-791): the
   * reviewer's free-text note, delivered to the agent to fold into its work. A
   * blank note is omitted. */
  approve: (mode: ApproveVariantId, notes?: string) => Promise<void>;
  requestChanges: (generalComment: string) => Promise<void>;
  /** Deny the plan with a concise "rejected — wait for the user" message and no
   * inline comments (EXC-685). Otherwise identical to requestChanges. */
  reject: () => Promise<void>;
}

export function createResolve(store: ResolveStore, deps: ResolveDeps): Resolve {
  const submit = deps.resolveReview ?? resolveReview;
  const saveMode = deps.saveApproveMode ?? writeApproveMode;

  // The general-comment mirror is cleared because the daemon dropped the stored
  // draft on resolve, and a deny keeps this review id — the sent text would linger
  // on reopen. `feedback` is a thunk because it must be composed AFTER the flush:
  // a pending draft the flush commits belongs in it.
  async function deny(feedback: () => string): Promise<void> {
    const id = deps.activeId();
    if (!id) return;
    store.busy = true;
    await deps.flushPending();
    try {
      await submit(id, { behavior: "deny", feedback: feedback() });
      deps.clearGeneralComment();
      deps.afterResolve(id);
    } catch (err) {
      if (err instanceof HttpError) deps.afterResolve(id);
      else deps.onOffline();
    } finally {
      store.busy = false;
    }
  }

  return {
    get approveMode() {
      return store.approveMode;
    },
    get busy() {
      return store.busy;
    },

    async approve(mode, notes) {
      const id = deps.activeId();
      if (!id) return;
      store.busy = true;
      await deps.flushPending();
      const feedback = notes?.trim();
      try {
        await submit(id, {
          behavior: "allow",
          acceptMode: mode,
          ...(feedback ? { feedback } : {}),
        });
        store.approveMode = mode; // remember locally so the next plan defaults to it
        saveMode(mode);
        deps.afterResolve(id);
      } catch (err) {
        // 404/409 = already resolved or removed elsewhere → just advance.
        if (err instanceof HttpError) deps.afterResolve(id);
        else deps.onOffline();
      } finally {
        store.busy = false;
      }
    },

    requestChanges(generalComment) {
      return deny(() => formatFeedback(deps.annotations(), generalComment, deps.planText()));
    },

    reject() {
      return deny(() => PLAN_REJECTED_MESSAGE);
    },
  };
}
