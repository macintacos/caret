// Source-view gutter comment state machine. A plain controller over the
// @pierre/diffs gutter utility: the gutter `+` reports a SelectedLineRange,
// open() normalizes it into the pending {startLine, endLine}, and submit()
// produces a line-anchored annotation through the injected onCreate. The
// composer DOM is a Svelte component (SourceComposer.svelte) positioned at the
// pending line — the wrapper's File is container-managed, which disables the
// library's renderAnnotation, so the composer is rendered host-side rather than
// slotted by the library. Empty submit and cancel discard with no residue.

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

export interface SourceCommentingDeps {
  /** Persist a submitted line-anchored annotation. */
  onCreate(anchor: CreatedAnchor): void;
  /** Notify the host that the composer's open/closed state changed, so it can
   * re-render. Optional. */
  onChange?(): void;
}

export interface SourceCommenting {
  /** Open the composer over a gutter-selected range (normalized ascending). */
  open(range: GutterRange): void;
  /** Submit `text` as the comment for the pending range. Empty/whitespace text
   * cancels instead of creating. No-op when closed. */
  submit(text: string): void;
  /** Discard the open composer with no create. No-op when closed. */
  cancel(): void;
  /** The pending composer target, or undefined when closed. */
  pending(): PendingComposer | undefined;
}

export function createSourceCommenting(deps: SourceCommentingDeps): SourceCommenting {
  let open: PendingComposer | null = null;

  function close(): void {
    open = null;
    deps.onChange?.();
  }

  return {
    open(range) {
      open = {
        startLine: Math.min(range.start, range.end),
        endLine: Math.max(range.start, range.end),
      };
      deps.onChange?.();
    },
    submit(text) {
      if (open == null) return;
      const comment = text.trim();
      // Empty submit is a cancel — never persist a blank annotation.
      if (comment === "") {
        close();
        return;
      }
      deps.onCreate({ startLine: open.startLine, endLine: open.endLine, comment });
      close();
    },
    cancel() {
      if (open == null) return;
      close();
    },
    pending() {
      return open ?? undefined;
    },
  };
}
