// Annotation working-copy + debounced autosave.
//
// Holds the locally-edited copy of the active review's inline annotations and
// the review-scoped general-comment draft. Edits mutate the working copy and
// schedule a debounced PUT /draft; switching reviews flushes the pending save
// FIRST (a synchronous snapshot before any await) so a save can never land on
// the wrong review. Seeding is guarded twice over: the annotation copy reloads
// on every id:version change, while the draft seeds on an id change only.

import { putDraft } from "../lib/api.ts";
import type { Annotation, ClientReview } from "@core/types";
import { isNetworkFailure } from "./resolve.svelte.ts";

const SAVE_DEBOUNCE_MS = 500;

/** Backing fields the autosave reads and writes. App.svelte supplies a
 * `$state`-backed implementation; tests supply a plain object. */
export interface AutosaveStore {
  annotations: Annotation[];
  generalCommentDraft: string;
  focusedAnnotation: string | null;
}

export interface AutosaveDeps {
  /** Persist the working draft. Defaults to the api client's putDraft. */
  putDraft?: typeof putDraft;
  /** Schedule a debounced flush; returns a cancel handle. Defaults to setTimeout. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Cancel a scheduled flush. Defaults to clearTimeout. */
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Mark the daemon offline on a genuine network failure. */
  onOffline: () => void;
}

export interface Autosave {
  readonly annotations: Annotation[];
  readonly focusedAnnotation: string | null;
  readonly generalCommentDraft: string;

  /** Reconcile the working copy with the active review. Flushes the previous
   * review's pending save first, then reloads the annotation copy on an
   * id:version change and the draft on an id change. */
  syncActive: (active: ClientReview | null) => void;
  /** Flush a pending save now (snapshotting synchronously). */
  flushPending: () => Promise<void>;

  createAnnotation: (sel: {
    blockId: string;
    startOffset: number;
    endOffset: number;
    quote: string;
    prefix: string;
    suffix: string;
    comment: string;
  }) => void;
  /** Create a line-anchored annotation from the source-view gutter: a 1-based,
   * inclusive {startLine, endLine} range into the active version's plan text. */
  createLineAnnotation: (anchor: { startLine: number; endLine: number; comment: string }) => void;
  editAnnotation: (id: string, comment: string) => void;
  deleteAnnotation: (id: string) => void;
  focusAnnotation: (id: string) => void;
  editGeneralComment: (value: string) => void;
  /** Clear the local general-comment draft (after a deny clears it server-side). */
  clearGeneralComment: () => void;
}

/**
 * Owns the working copy and the debounced autosave engine. `activeId` is read
 * live (App binds it to the selection's active id) so a save targets the review
 * that owns the edit, and a snapshot taken synchronously in `flushPending`
 * survives a review switch landing mid-flush.
 */
export function createAutosave(
  store: AutosaveStore,
  activeId: () => string | null,
  deps: AutosaveDeps,
): Autosave {
  const save = deps.putDraft ?? putDraft;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingSaveId: string | null = null;
  // Keyed on id:version so a new version (revision) also reloads the working
  // copy — never persist stale annotations from a prior version onto the next.
  let lastLoadedKey: string | null = null;
  // The draft is review-scoped, so it seeds on id change only — NOT on a version
  // change (a revision keeps the same review) and NOT on the 2s poll, which would
  // otherwise stomp live keystrokes 0–2s after each one.
  let lastDraftLoadedId: string | null = null;

  async function flushPending(): Promise<void> {
    if (saveTimer) {
      clearTimer(saveTimer);
      saveTimer = undefined;
    }
    if (!pendingSaveId) return;
    const id = pendingSaveId;
    pendingSaveId = null;
    // Snapshot both fields synchronously (before any await) so a review switch
    // mid-flush can't redirect this save onto the new review's working copy.
    const snapshot = store.annotations.map((a) => ({ ...a }));
    // Whitespace-only is treated as empty — never persist a blank draft.
    const draft = store.generalCommentDraft.trim() === "" ? "" : store.generalCommentDraft;
    try {
      await save(id, { annotations: snapshot, generalCommentDraft: draft });
    } catch (err) {
      // A non-2xx (e.g. the review was resolved/removed) is not a connection
      // problem — the daemon answered. Only a real network failure goes offline.
      if (isNetworkFailure(err)) deps.onOffline();
    }
  }

  function scheduleSave() {
    if (!activeId()) return;
    pendingSaveId = activeId();
    if (saveTimer) clearTimer(saveTimer);
    saveTimer = setTimer(() => void flushPending(), SAVE_DEBOUNCE_MS);
  }

  return {
    get annotations() {
      return store.annotations;
    },
    get focusedAnnotation() {
      return store.focusedAnnotation;
    },
    get generalCommentDraft() {
      return store.generalCommentDraft;
    },

    syncActive(active) {
      const key = active ? `${active.id}:${active.version}` : null;
      if (active && key !== lastLoadedKey) {
        // Flush the PREVIOUS review's pending save FIRST (it snapshots the
        // current annotations + generalCommentDraft + pendingSaveId
        // synchronously) — before we overwrite them with the new review's, or
        // we'd save them onto the old id.
        void flushPending();
        lastLoadedKey = key;
        store.annotations = active.annotations.map((a) => ({ ...a }));
        store.focusedAnnotation = null;
        // Seed on id change only, via its own guard (see lastDraftLoadedId
        // above) — independent of the id:version annotation reload around it.
        if (active.id !== lastDraftLoadedId) {
          lastDraftLoadedId = active.id;
          store.generalCommentDraft = active.generalCommentDraft ?? "";
        }
      } else if (!active) {
        void flushPending();
        lastLoadedKey = null;
        lastDraftLoadedId = null;
        store.annotations = [];
        store.generalCommentDraft = "";
      }
    },

    flushPending,

    createAnnotation(sel) {
      const id = crypto.randomUUID();
      store.annotations = [...store.annotations, { id, ...sel }];
      store.focusedAnnotation = id;
      scheduleSave();
    },
    createLineAnnotation(anchor) {
      const id = crypto.randomUUID();
      store.annotations = [...store.annotations, { id, ...anchor }];
      store.focusedAnnotation = id;
      scheduleSave();
    },
    editAnnotation(id, comment) {
      store.annotations = store.annotations.map((a) => (a.id === id ? { ...a, comment } : a));
      scheduleSave();
    },
    deleteAnnotation(id) {
      store.annotations = store.annotations.filter((a) => a.id !== id);
      if (store.focusedAnnotation === id) store.focusedAnnotation = null;
      scheduleSave();
    },
    focusAnnotation(id) {
      store.focusedAnnotation = id;
      const card = document.querySelector(`[data-annotation-card="${id}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    editGeneralComment(value) {
      store.generalCommentDraft = value;
      scheduleSave();
    },
    clearGeneralComment() {
      store.generalCommentDraft = "";
    },
  };
}
