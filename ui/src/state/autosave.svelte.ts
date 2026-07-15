// Annotation working-copy + debounced autosave.
//
// Holds the locally-edited copy of the active review's inline annotations and
// the review-scoped general-comment draft. Edits mutate the working copy and
// schedule a debounced PUT /draft; switching reviews flushes the pending save
// FIRST (a synchronous snapshot before any await) so a save can never land on
// the wrong review. Seeding is guarded twice over: the annotation copy reloads
// on every id:version change, while the draft seeds on an id change only.

import { putDraft } from "../lib/api.ts";
import type { Annotation, ClientReview, PersistedScratch } from "@core/lib/types";
import { isNetworkFailure } from "./resolve.svelte.ts";

const SAVE_DEBOUNCE_MS = 500;

/** Copy a scratch list into fresh, persistable objects — dropping the source
 * view controller's derived `key`, and never aliasing a served array. */
const copyScratches = (list: readonly PersistedScratch[]): PersistedScratch[] =>
  list.map((s) => ({ startLine: s.startLine, endLine: s.endLine, text: s.text }));

/** Whether two scratch lists carry the same anchored drafts, in order. */
const scratchesEqual = (a: readonly PersistedScratch[], b: readonly PersistedScratch[]): boolean =>
  a.length === b.length &&
  a.every((s, i) => {
    const o = b[i];
    return (
      o !== undefined && s.startLine === o.startLine && s.endLine === o.endLine && s.text === o.text
    );
  });

/** Backing fields the autosave reads and writes. App.svelte supplies a
 * `$state`-backed implementation; tests supply a plain object. */
export interface AutosaveStore {
  annotations: Annotation[];
  generalCommentDraft: string;
  /** The current version's unsent composer scratches (line-anchored drafts the
   * reviewer typed but did not submit). Version-scoped like annotations. */
  composerScratches: PersistedScratch[];
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
  readonly composerScratches: PersistedScratch[];

  /** Reconcile the working copy with the active review. Flushes the previous
   * review's pending save first, then reloads the annotation copy on an
   * id:version change and the draft on an id change. */
  syncActive: (active: ClientReview | null) => void;
  /** Flush a pending save now (snapshotting synchronously). */
  flushPending: () => Promise<void>;

  /** Create a line-anchored annotation from the source-view gutter: a 1-based,
   * inclusive {startLine, endLine} range into the active version's plan text. */
  createLineAnnotation: (anchor: { startLine: number; endLine: number; comment: string }) => void;
  editAnnotation: (id: string, comment: string) => void;
  deleteAnnotation: (id: string) => void;
  focusAnnotation: (id: string) => void;
  editGeneralComment: (value: string) => void;
  /** Clear the local general-comment draft (after a deny clears it server-side). */
  clearGeneralComment: () => void;
  /** Replace the working-copy scratches (mirrored up from the source-view
   * controller on every change) and schedule a debounced save. The persisted
   * shape drops the controller's derived `key`. */
  setScratches: (next: readonly PersistedScratch[]) => void;
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
  // The plan version the pending save was composed against, sent with the draft so
  // the daemon can drop a scratch write whose debounce raced a newly-arrived
  // version (its old line anchors would mis-land on the new text).
  let pendingSaveVersion: number | null = null;
  // The active review's current version, tracked from syncActive so scheduleSave
  // can stamp each edit with the version it was made against.
  let currentVersionNum: number | null = null;
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
    const version = pendingSaveVersion ?? undefined;
    pendingSaveVersion = null;
    // Snapshot both fields synchronously (before any await) so a review switch
    // mid-flush can't redirect this save onto the new review's working copy.
    const snapshot = store.annotations.map((a) => ({ ...a }));
    // Whitespace-only is treated as empty — never persist a blank draft.
    const draft = store.generalCommentDraft.trim() === "" ? "" : store.generalCommentDraft;
    const scratches = copyScratches(store.composerScratches);
    try {
      await save(id, {
        annotations: snapshot,
        generalCommentDraft: draft,
        composerScratches: scratches,
        version,
      });
    } catch (err) {
      // A non-2xx (e.g. the review was resolved/removed) is not a connection
      // problem — the daemon answered. Only a real network failure goes offline.
      if (isNetworkFailure(err)) deps.onOffline();
    }
  }

  function scheduleSave() {
    if (!activeId()) return;
    pendingSaveId = activeId();
    pendingSaveVersion = currentVersionNum;
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
    get composerScratches() {
      return store.composerScratches;
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
        // Scratches are version-scoped like annotations: reload them on every
        // id:version change so a fresh plan version starts with its own (which
        // has none), never a prior version's stale line anchors.
        store.composerScratches = copyScratches(active.composerScratches);
        currentVersionNum = active.version;
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
        store.composerScratches = [];
        currentVersionNum = null;
      }
    },

    flushPending,

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
    setScratches(next) {
      const cleaned = copyScratches(next);
      // The controller reseeds on load / switch / version change and echoes the
      // just-served set back through here; an unchanged set must not schedule a
      // redundant PUT (nor flip pendingSaveId onto the freshly-seeded review).
      if (scratchesEqual(cleaned, store.composerScratches)) return;
      store.composerScratches = cleaned;
      scheduleSave();
    },
  };
}
