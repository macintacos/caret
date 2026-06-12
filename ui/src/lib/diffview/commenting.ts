// Source-view gutter comment composer. A plain controller over the
// @pierre/diffs gutter utility: the gutter `+` reports a SelectedLineRange,
// open() records it as the pending range, and renderAnnotation slots the
// composer DOM this module builds inline at the pending line. Submit creates a
// line-anchored {startLine, endLine} annotation through the injected onCreate;
// cancel and Escape discard with no residue. The state machine and DOM live
// here (a testable lib module) rather than in the component, mirroring the
// planPaint.ts precedent for imperative DOM logic.

import { isCancelKey, isSubmitChord } from "../keys.ts";

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

export interface SourceCommentingDeps {
  /** Persist a submitted line-anchored annotation. */
  onCreate(anchor: CreatedAnchor): void;
  /** Notify the host that the composer's open/closed state changed, so it can
   * re-derive the annotation list it feeds the view. Optional. */
  onChange?(): void;
}

export interface SourceCommenting {
  /** Open the composer over a gutter-selected range (normalized ascending). */
  open(range: GutterRange): void;
  /** Discard the open composer with no create. */
  cancel(): void;
  /** The line the composer is anchored at (its range start), or undefined when
   * closed. The host adds a pending line annotation at this line so the view
   * renders the composer inline. */
  pendingLine(): number | undefined;
  /** Build the composer DOM for `lineNumber`, or undefined when the composer is
   * closed or that line is not the pending one. Wired for renderAnnotation. */
  renderComposer(lineNumber: number): HTMLElement | undefined;
}

interface OpenState {
  startLine: number;
  endLine: number;
}

export function createSourceCommenting(deps: SourceCommentingDeps): SourceCommenting {
  let open: OpenState | null = null;

  function close(): void {
    open = null;
    deps.onChange?.();
  }

  function submit(textarea: HTMLTextAreaElement): void {
    if (open == null) return;
    const comment = textarea.value.trim();
    const { startLine, endLine } = open;
    // Empty submit is a cancel — never persist a blank annotation.
    if (comment === "") {
      close();
      return;
    }
    deps.onCreate({ startLine, endLine, comment });
    close();
  }

  function buildComposer(): HTMLElement {
    const root = document.createElement("div");
    root.className = "caret-composer";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Add a comment");

    const style = document.createElement("style");
    style.textContent = COMPOSER_CSS;
    root.append(style);

    const label = document.createElement("p");
    label.className = "cc-label";
    label.textContent =
      open!.startLine === open!.endLine
        ? `Line ${open!.startLine}`
        : `Lines ${open!.startLine}–${open!.endLine}`;
    root.append(label);

    const textarea = document.createElement("textarea");
    textarea.className = "cc-input";
    textarea.rows = 3;
    textarea.placeholder = "What should change here?";
    textarea.setAttribute("aria-label", "Comment");
    textarea.addEventListener("keydown", (e) => {
      if (isCancelKey(e)) {
        e.preventDefault();
        cancel();
      } else if (isSubmitChord(e)) {
        e.preventDefault();
        submit(textarea);
      }
    });
    root.append(textarea);

    const row = document.createElement("div");
    row.className = "cc-row";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "cc-ghost";
    cancelBtn.dataset.action = "cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => cancel());

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "cc-solid";
    submitBtn.dataset.action = "submit";
    submitBtn.textContent = "Comment";
    submitBtn.setAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
    submitBtn.addEventListener("click", () => submit(textarea));

    row.append(cancelBtn, submitBtn);
    root.append(row);

    // Focus the textarea once the node is in the document so keyboard-only
    // operation can begin typing immediately after the gutter `+`.
    queueMicrotask(() => textarea.focus());
    return root;
  }

  function cancel(): void {
    if (open == null) return;
    close();
  }

  return {
    open(range) {
      const startLine = Math.min(range.start, range.end);
      const endLine = Math.max(range.start, range.end);
      open = { startLine, endLine };
      deps.onChange?.();
    },
    cancel,
    pendingLine() {
      return open?.startLine;
    },
    renderComposer(lineNumber) {
      if (open == null || lineNumber !== open.startLine) return undefined;
      return buildComposer();
    },
  };
}

// Scoped to .caret-composer. The composer renders inside the library's shadow
// root, so it carries its own styles; caret's design tokens are CSS custom
// properties on :root, which inherit through the shadow boundary, so the card
// stays cohesive with the app's inline composers.
const COMPOSER_CSS = `
.caret-composer {
  display: block;
  width: 320px;
  max-width: 100%;
  margin: 0.3rem 0 0.3rem 0.5rem;
  padding: 0.7rem 0.75rem 0.6rem;
  background: var(--paper-raised, #fbf7ee);
  border: 1px solid var(--rule-strong, #c8bba1);
  border-left: 3px solid var(--accent, #c2410c);
  border-radius: var(--radius-lg, 10px);
  box-shadow: var(--shadow-card, 0 4px 12px rgba(33, 28, 24, 0.12));
  font-family: var(--font-sans, system-ui, sans-serif);
}
.caret-composer .cc-label {
  margin: 0 0 0.4rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--ink-soft, #6a6157);
}
.caret-composer .cc-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font: inherit;
  font-size: 0.88rem;
  color: var(--ink, #211c18);
  background: var(--paper, #f6f1e7);
  border: 1px solid var(--rule, #ddd2bd);
  border-radius: var(--radius, 6px);
  padding: 0.45rem 0.55rem;
}
.caret-composer .cc-input:focus {
  outline: none;
  border-color: var(--accent, #c2410c);
}
.caret-composer .cc-row {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  margin-top: 0.55rem;
}
.caret-composer button {
  font: inherit;
  font-size: 0.76rem;
  font-weight: 600;
  border-radius: var(--radius, 6px);
  padding: 0.35rem 0.75rem;
  cursor: pointer;
}
.caret-composer .cc-ghost {
  background: transparent;
  color: var(--ink-soft, #6a6157);
  border: 1px solid var(--rule, #ddd2bd);
}
.caret-composer .cc-ghost:hover {
  color: var(--ink, #211c18);
  border-color: var(--rule-strong, #c8bba1);
}
.caret-composer .cc-solid {
  background: var(--accent, #c2410c);
  color: var(--accent-ink, #fff7ed);
  border: 1px solid var(--accent, #c2410c);
}
.caret-composer .cc-solid:hover {
  background: var(--accent-bright, #ea580c);
}
`;
