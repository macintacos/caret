// Approve / request-changes / reject resolve flow.
//
// Approving (allow) or requesting changes (deny) flushes any pending draft,
// POSTs the decision, and advances to the next review. The approve mode is
// remembered machine-globally (read once on load, mirrored locally on each
// approve). A daemon non-2xx (already resolved/removed elsewhere) still
// advances; only a genuine network failure flips the connection offline.

import { getApproveMode, HttpError, resolveReview } from "../lib/api.ts";
import { formatFeedback } from "../lib/feedback.ts";
import { PLAN_REJECTED_MESSAGE } from "@core/config/constants";
import type { Annotation, ApproveVariantId } from "@core/lib/types";

export { HttpError };

/** Whether a thrown API error is a daemon non-2xx (the daemon answered) rather
 * than a real network failure — only the latter flips the connection offline. */
export function isNetworkFailure(err: unknown): boolean {
  return !(err instanceof HttpError);
}

export interface ResolveDeps {
  /** Resolve a review. Defaults to the api client's resolveReview. */
  resolveReview?: typeof resolveReview;
  /** Read the remembered approve mode. Defaults to the api client's getApproveMode. */
  getApproveMode?: typeof getApproveMode;
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
  /** Remembered approve variant id (machine-global, last-wins). */
  approveMode: ApproveVariantId;
  /** True while a resolve POST is in flight. */
  busy: boolean;
}

export interface Resolve {
  readonly approveMode: ApproveVariantId;
  readonly busy: boolean;

  /** Read the remembered approve variant once on load. A failure leaves the
   * current default, matching the daemon's fail-safe. */
  loadApproveMode: () => void;
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
  const readMode = deps.getApproveMode ?? getApproveMode;

  return {
    get approveMode() {
      return store.approveMode;
    },
    get busy() {
      return store.busy;
    },

    loadApproveMode() {
      void readMode()
        .then((m) => (store.approveMode = m))
        .catch(() => {});
    },

    async approve(mode, notes) {
      const id = deps.activeId();
      if (!id) return;
      store.busy = true;
      await deps.flushPending();
      // Optional reviewer notes ride the allow as feedback (EXC-791); a blank note
      // is omitted so a bare approve stays a bare allow.
      const feedback = notes?.trim();
      try {
        await submit(id, {
          behavior: "allow",
          acceptMode: mode,
          ...(feedback ? { feedback } : {}),
        });
        store.approveMode = mode; // remember locally so the next plan defaults to it
        deps.afterResolve(id);
      } catch (err) {
        // 404/409 = already resolved or removed elsewhere → just advance.
        if (err instanceof HttpError) deps.afterResolve(id);
        else deps.onOffline();
      } finally {
        store.busy = false;
      }
    },

    async requestChanges(generalComment) {
      const id = deps.activeId();
      if (!id) return;
      store.busy = true;
      await deps.flushPending();
      const feedback = formatFeedback(deps.annotations(), generalComment, deps.planText());
      try {
        await submit(id, { behavior: "deny", feedback });
        // The daemon cleared the stored draft on resolve; clear the local mirror
        // too. A deny keeps this review id (the revision reuses it), and the seed
        // is id-keyed, so without this the sent text would linger on reopen.
        deps.clearGeneralComment();
        deps.afterResolve(id);
      } catch (err) {
        if (err instanceof HttpError) deps.afterResolve(id);
        else deps.onOffline();
      } finally {
        store.busy = false;
      }
    },

    async reject() {
      const id = deps.activeId();
      if (!id) return;
      store.busy = true;
      await deps.flushPending();
      try {
        await submit(id, { behavior: "deny", feedback: PLAN_REJECTED_MESSAGE });
        // Same as requestChanges: the daemon clears the stored draft on resolve,
        // so clear the local mirror too. Reject sends no annotations — just the
        // canned message.
        deps.clearGeneralComment();
        deps.afterResolve(id);
      } catch (err) {
        if (err instanceof HttpError) deps.afterResolve(id);
        else deps.onOffline();
      } finally {
        store.busy = false;
      }
    },
  };
}
