// CodeMirror 6 configuration for MarkdownEditor.svelte — the syntax-visible
// markdown editing surface. Kept as a plain module (not inline in the component
// script) so tsc type-checks the CodeMirror generics/classes directly; it is the
// other half of the swap boundary, paired with MarkdownEditor.svelte. Swapping
// the editor engine means replacing this file and the component together; the
// composer, the annotation-card edit field, and the saved-comment render path
// stay untouched.
import { closeCompletion, completionStatus } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, indentUnit, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { type EditorState, type Extension, Prec, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { type ReviewContext, reviewCompletion } from "$lib/editorCompletion.ts";
import { isCancelKey, isSubmitChord } from "$lib/keys.ts";

export interface MarkdownEditorOptions {
  placeholder: string;
  ariaLabel: string;
  /** Reflected onto the editor's `aria-required` when set — the required-field
   * signal a dialog's general-comment field carries when it is the only content. */
  ariaRequired?: boolean;
  /** Live value on every edit. */
  onInput?: (text: string) => void;
  /** ⌘/Ctrl+Enter. */
  onSubmitChord?: () => void;
  /** Esc. */
  onCancelChord?: () => void;
  /** The review this editor composes feedback for. Absent for a surface mounted
   * outside one, which then gets no completion at all. */
  reviewContext?: ReviewContext;
}

// The markdown grammar tags structure (strong/emphasis/heading/link) and the
// syntax markers (meta); the code-* tags below colour fenced-block content once a
// language parses it (see codeLanguages in markdownExtensions). Colours are caret tokens
// (hex/var, never oklch): keyword = accent, string = ok/green, comment = faint,
// names/types/numbers = accent-bright. This is the editor's own scheme, NOT the diff
// view's — the shiki themes there paint syntax from the named colour set's eleven
// shiki-only hues (themes/caret.ts, caret-shiki.ts), and those are not ColorTokens,
// so a `var(--x)` highlight style has no way to name them.
const highlightStyle = HighlightStyle.define([
  // Markdown structure.
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.heading, fontWeight: "700", color: "var(--ink)" },
  { tag: [tags.link, tags.url], color: "var(--accent)", textDecoration: "underline" },
  { tag: tags.quote, color: "var(--ink-soft)" },
  // The literal markdown markers (**, `, #, >, -, ```): kept visible but receded.
  { tag: tags.meta, color: "var(--ink-faint)" },
  // Fenced-code syntax.
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.controlKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
    ],
    color: "var(--accent)",
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--ok)" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: "var(--ink-faint)",
    fontStyle: "italic",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.labelName],
    color: "var(--accent-bright)",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
    color: "var(--accent-bright)",
  },
  { tag: [tags.number, tags.bool, tags.atom], color: "var(--accent-bright)" },
  {
    tag: [
      tags.operator,
      tags.punctuation,
      tags.separator,
      tags.bracket,
      tags.angleBracket,
      tags.squareBracket,
      tags.paren,
      tags.brace,
    ],
    color: "var(--ink-soft)",
  },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--ink)" },
  { tag: [tags.variableName, tags.attributeValue], color: "var(--ink)" },
  { tag: tags.escape, color: "var(--accent-bright)" },
]);

// Inline code stays an inline pill; a fenced block is a full-width band (one line
// decoration per line, rounded at top and bottom) so it reads as one cohesive
// code block rather than a stack of per-line pills.
const inlineCodeDeco = Decoration.mark({ class: "cm-md-code" });
const codeBlockLine = Decoration.line({ class: "cm-md-codeblock" });
const codeBlockOpen = Decoration.line({ class: "cm-md-codeblock cm-md-codeblock-open" });
const codeBlockClose = Decoration.line({ class: "cm-md-codeblock cm-md-codeblock-close" });

function buildCodeDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "InlineCode") {
          decos.push(inlineCodeDeco.range(node.from, node.to));
          return false;
        }
        if (node.name === "FencedCode") {
          const firstLine = view.state.doc.lineAt(node.from).number;
          const lastLine = view.state.doc.lineAt(node.to).number;
          for (let n = firstLine; n <= lastLine; n++) {
            const deco =
              n === firstLine ? codeBlockOpen : n === lastLine ? codeBlockClose : codeBlockLine;
            decos.push(deco.range(view.state.doc.line(n).from));
          }
          return false;
        }
        return undefined;
      },
    });
  }
  return Decoration.set(decos, true);
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
  ".cm-md-codeblock": {
    fontFamily: "var(--font-mono)",
    backgroundColor: "var(--paper-sunk)",
  },
  ".cm-md-codeblock-open": {
    borderTopLeftRadius: "var(--radius)",
    borderTopRightRadius: "var(--radius)",
    paddingTop: "0.2em",
  },
  ".cm-md-codeblock-close": {
    borderBottomLeftRadius: "var(--radius)",
    borderBottomRightRadius: "var(--radius)",
    paddingBottom: "0.2em",
  },
});

// One indent level. Four spaces so a list nest (indentMore, which reads this
// facet) and the "just enter four spaces" fallback below are the same width.
const INDENT_UNIT = "    ";

// A list-item line: optional leading indent, then a bullet (-, *, +) or an
// ordered marker (1. / 1)), then whitespace. When the cursor is on such a line,
// Tab nests the item; anywhere else it inserts literal spaces. (Wrapped
// continuation lines of a list item — rare in a review comment — are treated as
// non-list and get spaces.)
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/;

/** Whether any selection head sits on a markdown list-item line — the signal for
 * Tab to nest the item rather than insert spaces. Exported for unit tests. */
export function cursorInList(state: EditorState): boolean {
  return state.selection.ranges.some((range) => LIST_LINE.test(state.doc.lineAt(range.head).text));
}

/** What the editor's chord layer does with a keydown: submit, dismiss an open
 * completion list, cancel the editor, or nothing (leaving the key to the rest of
 * the stack). Escape is the interesting case — an open list owns it, and the
 * surrounding dialog owns it otherwise. Exported for unit tests. */
export function chordAction(
  e: KeyboardEvent,
  completionOpen: boolean,
): "submit" | "closeCompletion" | "cancel" | null {
  if (isSubmitChord(e)) return "submit";
  if (!isCancelKey(e)) return null;
  return completionOpen ? "closeCompletion" : "cancel";
}

// Tab indents (indentMore, using the four-space indentUnit) when there is a
// selection — every line the selection touches shifts one level right, so
// highlighting several lines and pressing Tab indents them all — or when an empty
// cursor sits in a list (nesting that item). An empty cursor outside a list just
// inserts four literal spaces. Shift-Tab outdents so an indent can come back out.
// Capturing Tab means it no longer tabs focus out of the editor — a deliberate
// trade for in-field list editing; Esc still dismisses the composer.
const indentKeymap = keymap.of([
  {
    key: "Tab",
    run: (view) => {
      const { state } = view;
      if (state.selection.ranges.some((range) => !range.empty) || cursorInList(state)) {
        return indentMore(view);
      }
      view.dispatch(state.replaceSelection(INDENT_UNIT));
      return true;
    },
    shift: indentLess,
  },
]);

/** The extension stack for a comment-composer markdown editor. */
export function markdownExtensions(opts: MarkdownEditorOptions): Extension[] {
  return [
    history(),
    // codeLanguages: the full @codemirror/language-data set (~140 languages),
    // each lazy-loaded on demand when a fenced block declares it — so the initial
    // bundle stays lean and new languages need no code change here.
    markdown({ codeLanguages: languages }),
    syntaxHighlighting(highlightStyle),
    codeHighlighter,
    EditorView.lineWrapping,
    indentUnit.of(INDENT_UNIT),
    placeholder(opts.placeholder),
    EditorView.contentAttributes.of({
      ...(opts.ariaLabel ? { "aria-label": opts.ariaLabel } : {}),
      ...(opts.ariaRequired !== undefined ? { "aria-required": String(opts.ariaRequired) } : {}),
    }),
    // Chords first, so Esc/⌘-Enter are intercepted before default keys.
    Prec.highest(
      EditorView.domEventHandlers({
        keydown: (e, view) => {
          const action = chordAction(e, completionStatus(view.state) === "active");
          if (action === null) return false;
          e.preventDefault();
          if (action === "submit") opts.onSubmitChord?.();
          else if (action === "cancel") opts.onCancelChord?.();
          else {
            // The dialogs around this editor listen for Escape on `document` and
            // do NOT check defaultPrevented (bits-ui's escape layer), so a
            // preventDefault alone would dismiss the list AND the dialog under it.
            e.stopPropagation();
            closeCompletion(view);
          }
          return true;
        },
      }),
    ),
    // Completion, after the chords so an open list never steals them, and before
    // the keymaps below so it claims ArrowUp/ArrowDown/Enter first. Empty without
    // a review context or a registered source.
    ...reviewCompletion(opts.reviewContext),
    // Tab indent/outdent, before the default keymap (which leaves Tab unbound).
    indentKeymap,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    theme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onInput?.(u.state.doc.toString());
    }),
  ];
}
