// The content-drag commenting gesture: a pointer state machine that turns a
// click-drag across the code *body* into a line range and, on release, hands the
// host an ascending {startLine, endLine} to open the range composer — the natural
// "drag across the lines" gesture the gutter drag never completed (EXC-639).
//
// Two design points the @pierre/diffs library forces:
//   - The library only starts a line selection from the line-number column, and
//     never opens the composer itself. So caret owns the content gesture; this
//     controller is the owner, kept a pure DOM-free machine (the line hit-test is
//     injected) so it unit-tests deterministically.
//   - When Shift is held the controller bows out entirely, so SourceView lets the
//     browser select text natively (the copy escape-hatch). Suppressing the native
//     selection for a plain drag is SourceView's job (a scoped `selectstart`
//     guard), keeping this controller free of DOM side effects.
//
// A press with no movement is left alone (no commit), so the single-line
// click-to-comment path (SourceView.handleLineClick) still fires on release.

import { normalizeRange, type PendingComposer } from "$lib/diffview/commenting.ts";

/** The minimal slice of a PointerEvent the controller reads (a real PointerEvent satisfies it). */
export interface LineDragPointer {
  pointerId: number;
  /** 0 = primary (left). The gesture only tracks the primary button. */
  button: number;
  /** When held, the controller bows out so native text selection runs (copy escape-hatch). */
  shiftKey: boolean;
  clientX: number;
  clientY: number;
}

export interface LineDragDeps {
  /** Resolve the 1-based source line at a viewport point, or null if the point is not over a code line. */
  lineFromPoint(clientX: number, clientY: number): number | null;
  /** The live range changed (ascending), or null when the gesture ends or is cancelled. */
  onPreview(range: PendingComposer | null): void;
  /** A completed multi-line drag: open the composer for this ascending range. */
  onCommit(range: PendingComposer): void;
}

export interface LineDrag {
  /** Returns true iff this press armed the gesture (a primary, non-Shift press on a
   * code line). The caller uses that to suppress native selection and track the drag
   * to its end — one arm decision, owned here, so the host need not re-derive it. */
  pointerdown(e: LineDragPointer): boolean;
  pointermove(e: LineDragPointer): void;
  pointerup(e: LineDragPointer): void;
  /** Abandon any in-flight gesture (pointercancel / blur), clearing the preview. */
  cancel(): void;
}

export function createLineDrag(deps: LineDragDeps): LineDrag {
  // idle → armed (pressed on a line, no movement yet) → dragging (crossed a line).
  let mode: "idle" | "armed" | "dragging" = "idle";
  let anchor = 0;
  let current = 0;
  let pointerId = -1;

  function reset(): void {
    mode = "idle";
    pointerId = -1;
  }

  return {
    pointerdown(e) {
      if (mode !== "idle") return false;
      if (e.button !== 0) return false;
      if (e.shiftKey) return false; // let native text selection run — the copy escape-hatch
      const line = deps.lineFromPoint(e.clientX, e.clientY);
      if (line == null) return false; // not over a code line (e.g. the gutter, owned by the library)
      mode = "armed";
      anchor = line;
      current = line;
      pointerId = e.pointerId;
      return true;
    },
    pointermove(e) {
      if (mode === "idle") return;
      if (e.pointerId !== pointerId) return;
      const line = deps.lineFromPoint(e.clientX, e.clientY);
      if (line == null || line === current) return;
      current = line;
      if (current !== anchor) mode = "dragging";
      if (mode === "dragging") {
        deps.onPreview(normalizeRange({ start: anchor, end: current }));
      }
    },
    pointerup(e) {
      if (mode === "idle") return;
      if (e.pointerId !== pointerId) return;
      const dragging = mode === "dragging";
      const a = anchor;
      const c = current;
      reset();
      if (dragging) {
        deps.onPreview(null);
        deps.onCommit(normalizeRange({ start: a, end: c }));
      }
      // An armed-but-never-moved press is a click: do nothing here and let the
      // native click reach the single-line composer path.
    },
    cancel() {
      if (mode === "idle") return;
      reset();
      deps.onPreview(null);
    },
  };
}
