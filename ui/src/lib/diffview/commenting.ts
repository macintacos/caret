// Source-view gutter comment state machine. A plain controller over the
// @pierre/diffs gutter utility: the gutter `+` reports a SelectedLineRange,
// open() normalizes it into the pending {startLine, endLine}, and submit()
// produces a line-anchored annotation through the injected onCreate. The
// composer DOM is a Svelte component (SourceComposer.svelte) positioned at the
// pending line — the wrapper's File is container-managed, which disables the
// library's renderAnnotation, so the composer is rendered host-side rather than
// slotted by the library.
//
// The composer has two dismiss paths. "Keep for later" (cancel with non-empty
// text) retains it as a scratch (an in-memory, version-scoped draft) anchored to
// its range, so the reviewer can resume it: open() at a scratched range — or
// resume() from its line marker — reopens the composer with the text restored.
// "Discard" (discardOpen, or an empty dismiss) leaves no scratch. Submitting
// graduates the text to a real annotation and drops the scratch. The store is
// seeded via seed() from the review's persisted scratches — on load and whenever
// the rendered content changes (a new version, a review switch) — so a reload
// restores the reviewer's markers, while a scratch still never mis-anchors onto
// text it was not written against (a fresh version carries none of its own).
//
// This is deliberately distinct from commentState.ts's "Draft" — a created,
// pending annotation already added to the working copy. A scratch was never
// added; its line marker reads "Resume", an action, not the "Draft" state.

import type { PersistedScratch } from "@core/lib/types";
import type { SoundEvent } from "$lib/sound.ts";

/** The 1-based, inclusive line anchor a submit produces. */
export interface CreatedAnchor {
  startLine: number;
  endLine: number;
  comment: string;
}

/** The line range the gutter utility reports (start/end may be in either order). */
export interface GutterRange {
  start: number;
  end: number;
}

/** The pending composer target, exposed for the host to position and render. */
export interface PendingComposer {
  startLine: number;
  endLine: number;
}

/** A retained, unsubmitted composer draft anchored to a line range. In-memory
 * and version-scoped; the host renders a "Resume" marker per scratch and reopens
 * the composer with `text` restored. Named `ComposerScratch` (not "Draft") to
 * stay distinct from commentState.ts's created-but-pending "Draft" annotation. */
export interface ComposerScratch {
  /** Stable identity for the scratch's range — see `scratchKey`. */
  key: string;
  startLine: number;
  endLine: number;
  /** The trimmed, non-empty text the reviewer typed but did not submit. */
  text: string;
}

/** The store key for a scratch's line range. One scratch per ascending range, so
 * dismissing the same range twice replaces rather than duplicates. */
export function scratchKey(startLine: number, endLine: number): string {
  return `${startLine}:${endLine}`;
}

/** Normalizes a gutter range to an ascending {startLine, endLine} (1-based,
 * inclusive). A drag in either direction — top-down or bottom-up — yields the
 * same ascending pair, so the live drag readout, the composer label, and the
 * created anchor never disagree on which way the range runs. */
export function normalizeRange(range: GutterRange): PendingComposer {
  return {
    startLine: Math.min(range.start, range.end),
    endLine: Math.max(range.start, range.end),
  };
}

/** The human label for an ascending line range: "Line N" for a single line,
 * "Lines X–Y" (en dash) for a span. Shared by the live drag readout and the
 * post-release composer so the preview and the composer always read the same. */
export function rangeLabel(startLine: number, endLine: number): string {
  return startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
}

export interface SourceCommentingDeps {
  /** Persist a submitted line-anchored annotation. */
  onCreate(anchor: CreatedAnchor): void;
  /** Notify the host that the composer's open/closed state changed, so it can
   * re-render. Optional. */
  onChange?(): void;
  /** Play a moment's cue. Optional so a test drives the factory silently. */
  sound?: (event: SoundEvent) => void;
}

export interface SourceCommenting {
  /** Open the composer over a gutter-selected range (normalized ascending). If a
   * scratch exists at that range, its text is restored into the composer and the
   * scratch is consumed (moved into the open composer, not copied). */
  open(range: GutterRange): void;
  /** Submit `text` as the comment for the pending range. Empty/whitespace text
   * cancels instead of creating. Either way, any scratch for the pending range is
   * dropped — a successful submit graduates it to an annotation, and an empty
   * submit means the reviewer cleared the box. No-op when closed. */
  submit(text: string): void;
  /** Dismiss the open composer, keeping non-empty trimmed text as a scratch
   * anchored to the pending range so the reviewer can resume it — the "keep for
   * later" path, and the implicit retain when the host opens another range.
   * Empty text closes with no residue. To drop the draft outright instead, see
   * discardOpen(). No-op when closed. */
  cancel(text?: string): void;
  /** Dismiss the open composer, dropping its text without retaining a scratch —
   * the composer's explicit Discard (button or Esc). A scratch consumed on
   * open()/resume() was already moved into the open composer, so nothing is left
   * behind. `text` is what is being thrown away, and only the cue reads it: a
   * composer holding words is discarded, an empty one is merely dropped. No-op
   * when closed. */
  discardOpen(text?: string): void;
  /** The pending composer target, or undefined when closed. */
  pending(): PendingComposer | undefined;
  /** The text to seed the open composer with (from a consumed/resumed scratch),
   * or "" when there is none. Empty when closed. */
  pendingText(): string;
  /** The retained scratches, ascending by range, for the host to render markers. */
  scratches(): ComposerScratch[];
  /** Reopen the composer at the scratch identified by `key`, restoring its text
   * and consuming the scratch. No-op if no scratch matches. */
  resume(key: string): void;
  /** Graduate the scratch at `key` to a committed annotation through the same
   * onCreate path a submit uses, then drop it. No-op if no scratch matches. This
   * is a direct graduate, not a resume+submit: it never sets the pending composer,
   * so the Request Changes dialog can Save a scratch without opening the composer
   * behind its modal. */
  save(key: string): void;
  /** Drop the scratch at `key` without creating anything. No-op if no scratch
   * matches. The per-scratch counterpart to clear(), for the dialog's Discard. */
  discard(key: string): void;
  /** Insert a scratch directly from an annotation's range + text, WITHOUT opening
   * the composer — the reverse of save(). The Request Changes dialog "marks a
   * committed comment as a draft," demoting it out of the send and into the
   * unsent-scratch section (EXC-762). Text is trimmed; a blank text is a no-op. On
   * a same-range collision with an existing scratch the texts are merged
   * (newline-joined) so no unsent draft is lost. */
  draft(scratch: { startLine: number; endLine: number; text: string }): void;
  /** Replace every scratch with the persisted set (keyed by range) and close any
   * open composer. The host calls this on load and whenever the rendered content
   * changes (a new plan version, a review switch), so scratches rehydrate from the
   * review while never mis-anchoring onto text they were not written against. */
  seed(persisted: PersistedScratch[]): void;
}

export function createSourceCommenting(deps: SourceCommentingDeps): SourceCommenting {
  let open: PendingComposer | null = null;
  // Text to seed the open composer with, set when open()/resume() consume a
  // scratch. "" whenever the composer opens on a fresh range or is closed.
  let openText = "";
  // Retained scratches, keyed by range so dismissing the same range replaces.
  const store = new Map<string, ComposerScratch>();
  // The store rendered ascending, rebuilt only when the store actually mutates.
  // The host mirrors scratches() on every onChange, so returning a stable
  // reference between mutations keeps the host's annotation/bracket derivations
  // from re-running when a transition (open/close) leaves the store unchanged.
  let snapshot: ComposerScratch[] = [];
  function rebuildSnapshot(): void {
    snapshot = [...store.values()].sort(
      (a, b) => a.startLine - b.startLine || a.endLine - b.endLine,
    );
  }

  function close(): void {
    open = null;
    openText = "";
    deps.onChange?.();
  }

  /** Move any scratch for `range` into the open composer's seed text and drop it
   * from the store, so reopening a scratched range is a move, not a copy. */
  function openAt(range: PendingComposer): void {
    open = range;
    const key = scratchKey(range.startLine, range.endLine);
    const scratch = store.get(key);
    openText = scratch?.text ?? "";
    if (scratch !== undefined) {
      store.delete(key);
      rebuildSnapshot();
    }
    deps.onChange?.();
  }

  return {
    open(range) {
      openAt(normalizeRange(range));
      deps.sound?.("commentOpen");
    },
    submit(text) {
      if (open == null) return;
      const comment = text.trim();
      // Either outcome drops the scratch: a successful submit graduates it to an
      // annotation, and an empty submit means the reviewer cleared the box.
      if (store.delete(scratchKey(open.startLine, open.endLine))) rebuildSnapshot();
      // Empty submit is a cancel — never persist a blank annotation.
      if (comment === "") {
        close();
        return;
      }
      deps.onCreate({ startLine: open.startLine, endLine: open.endLine, comment });
      close();
    },
    cancel(text) {
      if (open == null) return;
      const retained = text?.trim() ?? "";
      if (retained !== "") {
        const { startLine, endLine } = open;
        const key = scratchKey(startLine, endLine);
        store.set(key, { key, startLine, endLine, text: retained });
        rebuildSnapshot();
      }
      close();
    },
    discardOpen(text) {
      if (open == null) return;
      deps.sound?.(text?.trim() ? "commentDiscarded" : "commentDropped");
      close();
    },
    pending() {
      return open ?? undefined;
    },
    pendingText() {
      return openText;
    },
    scratches() {
      return snapshot;
    },
    resume(key) {
      const scratch = store.get(key);
      if (scratch == null) return;
      openAt({ startLine: scratch.startLine, endLine: scratch.endLine });
    },
    save(key) {
      const scratch = store.get(key);
      if (scratch == null) return;
      store.delete(key);
      rebuildSnapshot();
      deps.onCreate({
        startLine: scratch.startLine,
        endLine: scratch.endLine,
        comment: scratch.text,
      });
      deps.onChange?.();
    },
    discard(key) {
      if (!store.delete(key)) return;
      rebuildSnapshot();
      deps.onChange?.();
    },
    draft({ startLine, endLine, text }) {
      const trimmed = text.trim();
      if (trimmed === "") return;
      const key = scratchKey(startLine, endLine);
      const existing = store.get(key);
      // Merge on collision so demoting a comment onto a range that already holds
      // an unsent draft never silently drops the reviewer's other text.
      const merged = existing ? `${existing.text}\n${trimmed}` : trimmed;
      store.set(key, { key, startLine, endLine, text: merged });
      rebuildSnapshot();
      deps.onChange?.();
    },
    seed(persisted) {
      open = null;
      openText = "";
      store.clear();
      for (const s of persisted) {
        const key = scratchKey(s.startLine, s.endLine);
        store.set(key, { key, startLine: s.startLine, endLine: s.endLine, text: s.text });
      }
      rebuildSnapshot();
      deps.onChange?.();
    },
  };
}
