// CodeMirror 6 configuration for MarkdownEditor.svelte — the syntax-visible
// markdown editing surface. Kept as a plain module (not inline in the component
// script) so tsc type-checks the CodeMirror generics/classes directly; it is the
// other half of the swap boundary, paired with MarkdownEditor.svelte. Swapping
// the editor engine means replacing this file and the component together; the
// composer, the annotation-card edit field, and the saved-comment render path
// stay untouched.
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { type Extension, Prec, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { isCancelKey, isSubmitChord } from "./keys.ts";

export interface MarkdownEditorOptions {
  placeholder: string;
  ariaLabel: string;
  /** Live value on every edit. */
  onInput?: (text: string) => void;
  /** ⌘/Ctrl+Enter. */
  onSubmitChord?: () => void;
  /** Esc. */
  onCancelChord?: () => void;
}

// The markdown grammar tags strong/emphasis/heading/link/url and the syntax
// markers (meta), but NOT inline- or fenced-code CONTENT — so code monospace
// comes from a decoration over the InlineCode/FencedCode nodes (below), and the
// rest from this tag→style map. Colours are caret tokens (hex/var, never oklch).
const highlightStyle = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.heading, fontWeight: "700", color: "var(--ink)" },
  { tag: [tags.link, tags.url], color: "var(--accent)", textDecoration: "underline" },
  { tag: tags.quote, color: "var(--ink-soft)" },
  // The literal markdown markers (**, `, #, >, -, ```): kept visible but receded.
  { tag: tags.meta, color: "var(--ink-faint)" },
]);

// Mark inline + fenced code so CSS can give it the monospace font and a tint.
const codeDeco = Decoration.mark({ class: "cm-md-code" });
function buildCodeDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "InlineCode" || node.name === "FencedCode") {
          builder.add(node.from, node.to, codeDeco);
        }
      },
    });
  }
  return builder.finish();
}
const codeHighlighter = ViewPlugin.fromClass(
  class {
    decorations = Decoration.none;
    constructor(view: EditorView) {
      this.decorations = buildCodeDecorations(view);
    }
    update(u: { view: EditorView; docChanged: boolean; viewportChanged: boolean }) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildCodeDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// CM-internal styling. Kept here (CM injects it unscoped) rather than the
// component <style> because Svelte's scoping can't reach CM's own DOM. The
// scroller sets the prose font (overriding CM's default monospace); min/max
// height plus overflow is the auto-grow: it grows with content to the cap, then
// scrolls. Tokens only (hex/var) — the embedded Chromium mangles oklch.
const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--ink)" },
  ".cm-scroller": {
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-md)",
    lineHeight: "var(--leading-snug)",
    maxHeight: "22rem",
    overflowY: "auto",
  },
  ".cm-content": {
    padding: "0.45rem 0.55rem",
    minHeight: "calc(var(--text-md) * var(--leading-snug) * 3)",
    caretColor: "var(--accent)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in lab, var(--accent) 22%, transparent)",
  },
  ".cm-placeholder": { color: "var(--ink-faint)" },
  ".cm-md-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.92em",
    backgroundColor: "var(--paper-sunk)",
    borderRadius: "3px",
    padding: "0.05em 0.15em",
  },
});

/** The extension stack for a comment-composer markdown editor. */
export function markdownExtensions(opts: MarkdownEditorOptions): Extension[] {
  return [
    history(),
    markdown(),
    syntaxHighlighting(highlightStyle),
    codeHighlighter,
    EditorView.lineWrapping,
    placeholder(opts.placeholder),
    opts.ariaLabel ? EditorView.contentAttributes.of({ "aria-label": opts.ariaLabel }) : [],
    // Chords first, so Esc/⌘-Enter are intercepted before default keys.
    Prec.highest(
      EditorView.domEventHandlers({
        keydown: (e) => {
          if (isSubmitChord(e)) {
            e.preventDefault();
            opts.onSubmitChord?.();
            return true;
          }
          if (isCancelKey(e)) {
            e.preventDefault();
            opts.onCancelChord?.();
            return true;
          }
          return false;
        },
      }),
    ),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    theme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onInput?.(u.state.doc.toString());
    }),
  ];
}
