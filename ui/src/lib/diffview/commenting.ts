// Source-view gutter comment state machine. A plain controller over the
// @pierre/diffs gutter utility: the gutter `+` reports a SelectedLineRange,
// open() normalizes it into the pending {startLine, endLine}, and submit()
// produces a line-anchored annotation through the injected onCreate. The
// composer DOM is a Svelte component (SourceComposer.svelte) positioned at the
// pending line — the wrapper's File is container-managed, which disables the
// library's renderAnnotation, so the composer is rendered host-side rather than
// slotted by the library.
//
// Dismissing the composer with typed-but-unsubmitted text retains it as a
// scratch (an in-memory, version-scoped draft) anchored to its range, so the
// reviewer can resume it: open() at a scratched range — or resume() from its
// line marker — reopens the composer with the text restored. An empty dismiss
// leaves no scratch, and submitting graduates the text to a real annotation and
// drops the scratch. The store is plain in-memory state on the controller
// instance, so a reload starts empty; the host calls clear() when the rendered
// content changes (a new version) so a scratch never mis-anchors onto new text.
//
// This is deliberately distinct from commentState.ts's "Draft" — a created,
// pending annotation already added to the working copy. A scratch was never
// added; its line marker reads "Resume", an action, not the "Draft" state.

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
  /** Dismiss the open composer. If `text` has non-empty trimmed content, retain
   * it as a scratch anchored to the pending range so the reviewer can resume it;
   * otherwise close with no residue (the prior discard behavior). No-op when
   * closed. */
  cancel(text?: string): void;
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
  /** Drop every scratch and close any open composer. The host calls this when the
   * rendered content changes (a new plan version) so a scratch never mis-anchors
   * onto text it was not written against. */
  clear(): void;
}

export function createSourceCommenting(deps: SourceCommentingDeps): SourceCommenting {
  let open: PendingComposer | null = null;
  // Text to seed the open composer with, set when open()/resume() consume a
  // scratch. "" whenever the composer opens on a fresh range or is closed.
  let openText = "";
  // Retained scratches, keyed by range so dismissing the same range replaces.
  const scratches = new Map<string, ComposerScratch>();

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
    openText = scratches.get(key)?.text ?? "";
    scratches.delete(key);
    deps.onChange?.();
  }

  return {
    open(range) {
      openAt(normalizeRange(range));
    },
    submit(text) {
      if (open == null) return;
      const comment = text.trim();
      // Either outcome drops the scratch: a successful submit graduates it to an
      // annotation, and an empty submit means the reviewer cleared the box.
      scratches.delete(scratchKey(open.startLine, open.endLine));
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
        scratches.set(key, { key, startLine, endLine, text: retained });
      }
      close();
    },
    pending() {
      return open ?? undefined;
    },
    pendingText() {
      return openText;
    },
    scratches() {
      return [...scratches.values()].sort(
        (a, b) => a.startLine - b.startLine || a.endLine - b.endLine,
      );
    },
    resume(key) {
      const scratch = scratches.get(key);
      if (scratch == null) return;
      openAt({ startLine: scratch.startLine, endLine: scratch.endLine });
    },
    clear() {
      scratches.clear();
      close();
    },
  };
}
