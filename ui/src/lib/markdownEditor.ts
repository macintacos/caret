// CodeMirror 6 configuration for MarkdownEditor.svelte — the syntax-visible
// markdown editing surface. Kept as a plain module (not inline in the component
// script) so tsc type-checks the CodeMirror generics/classes directly; it is the
// other half of the swap boundary, paired with MarkdownEditor.svelte. Swapping
// the editor engine means replacing this file and the component together; the
// composer, the annotation-card edit field, and the saved-comment render path
// stay untouched.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { type Extension, Prec, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  keymap,
  placeholder,
} from "@codemirror/view";
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

// The markdown grammar tags structure (strong/emphasis/heading/link) and the
// syntax markers (meta); the code-* tags below colour fenced-block content once a
// language parses it (see codeLanguages in markdownExtensions). Colours are caret tokens
// (hex/var, never oklch) and mirror the diff view's shiki palette: keyword =
// accent, string = ok/green, comment = faint, names/types/numbers = accent-bright.
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
