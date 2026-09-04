// CodeMirror 6 configuration for MarkdownEditor.svelte, the other half of the
// editor swap boundary. A plain module rather than inline in the component script
// so tsc type-checks the CodeMirror generics and classes directly.
import { closeCompletion, completionStatus, startCompletion } from "@codemirror/autocomplete";
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
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import {
  completionListOpen,
  type ReviewCompletionSource,
  type ReviewContext,
  reviewCompletion,
} from "$lib/editorCompletion.ts";
import {
  type RefRecognitionDeps,
  recognizedRefs,
  refKey,
  refRecognition,
  scanRefTokens,
} from "$lib/editorRefs.ts";
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
  /** The completion sources to offer, defaulting to the module registry. Injected
   * so a unit can open a real list — the Escape contract below is about what a
   * painted list does, which no amount of pure-function testing reaches. */
  completionSources?: readonly ReviewCompletionSource[];
  /** The gates and timer chip recognition runs on, defaulting to the daemon and
   * a real clock. Injected for the same reason as `completionSources`: what a
   * chip does is a property of the painted editor, and driving the resolve
   * window beats sleeping through it. */
  refDeps?: RefRecognitionDeps;
}

// The editor's own scheme, NOT the diff view's: the shiki themes there paint from
// eleven shiki-only hues that are not ColorTokens, so a `var(--x)` highlight style
// has no way to name them. Tokens only (hex/var, never oklch).
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

// A reference caret can actually resolve (EXC-1177). Shared geometry on
// `.cm-md-ref`, but the tint is per KIND: a comment routinely carries both, and two
// identical pills make the reviewer read the text to tell which is which.
const pathChipDeco = Decoration.mark({ class: "cm-md-ref cm-md-ref-path" });
const skillChipDeco = Decoration.mark({ class: "cm-md-ref cm-md-ref-skill" });

function buildCodeDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  // Chips ride this same pass rather than a sibling plugin, so code marks and
  // reference marks are always built from one view of the document.
  const recognized = view.state.field(recognizedRefs, false);
  const chips =
    recognized === undefined || recognized.size === 0
      ? []
      : scanRefTokens(view.state).filter((token) => recognized.has(refKey(token)));
  // A codespan that IS a chip gives up its own pill: two marks over one range nest,
  // so their fills composite, padding stacks and the 0.92em sizes multiply — which
  // reads as two chips that failed to line up. The rendered plan settles it the same
  // way (svelte-rules.md § CSS-token discipline, on `data-md-cite`).
  const chipped = new Map(chips.map((token) => [`${token.from}:${token.to}`, token.kind] as const));

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "InlineCode") {
          if (!chipped.has(`${node.from}:${node.to}`)) {
            decos.push(inlineCodeDeco.range(node.from, node.to));
          }
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
  for (const [range, kind] of chipped) {
    const [from, to] = range.split(":").map(Number) as [number, number];
    decos.push((kind === "skill" ? skillChipDeco : pathChipDeco).range(from, to));
  }
  return Decoration.set(decos, true);
}
const codeHighlighter = ViewPlugin.fromClass(
  class {
    decorations = Decoration.none;
    constructor(view: EditorView) {
      this.decorations = buildCodeDecorations(view);
    }
    update(u: ViewUpdate) {
      // The recognized set is replaced wholesale, so identity is the whole staleness
      // test, and refRecognition skips a dispatch that would change nothing.
      const refsChanged =
        u.state.field(recognizedRefs, false) !== u.startState.field(recognizedRefs, false);
      if (u.docChanged || u.viewportChanged || refsChanged) {
        this.decorations = buildCodeDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// CM-internal styling, kept here rather than the component <style> because
// Svelte's scoping can't reach CM's own DOM. min/max height plus overflow is the
// auto-grow. Tokens only (hex/var) — the embedded Chromium mangles oklch.
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
  // A recognized reference: the geometry both kinds share. Mono at the inline-code
  // pill's own scale, so a path chipped in prose reads like the same path inside
  // backticks. Roomier than that pill, because the `@` the completion inserted is
  // inside the fill (editorRefs.ts § withSigil) and a sigil pressed against its left
  // edge reads as a chip that started in the wrong place; `em` keeps both paddings
  // proportional to the 0.92em face. Deliberately no transition — the mark is a
  // fresh element each time the recognized set moves, so there is no from-state.
  ".cm-md-ref": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.92em",
    color: "var(--ink)",
    borderRadius: "4px",
    padding: "0.12em 0.32em",
  },
  // A resolved path. `--chip-ref` is what the rendered plan already spends on one
  // (diffview/coreStyles.ts), so the composing and reading sides tint a reference
  // identically and theme.test.ts's pins on that token cover this surface too. An
  // alpha tint rather than a lightness step, so it reads on both grounds.
  // Deliberately NOT the neutral --chip, which is declared for chrome controls.
  ".cm-md-ref-path": {
    backgroundColor: "var(--chip-ref)",
  },
  // A skill the reviewing agent can reach. `--chip-skill` rides the `attention`
  // hue — neither the accent (selection) nor semantic (ok/danger) — which keeps it a
  // full hue-step from the path's green in every theme; theme.test.ts pins that.
  ".cm-md-ref-skill": {
    backgroundColor: "var(--chip-skill)",
  },
  // The completion list. @codemirror/autocomplete's stock tooltip is light-mode
  // only — a near-white panel inheriting the editor's text colour, so under a dark
  // scheme every unselected row is white on white. Reachable from here because the
  // stack configures no `tooltips({ parent })`, so CodeMirror mounts tooltips into
  // `view.dom` (the fact `completionListOpen` in editorCompletion.ts relies on).
  //
  // Every selector repeats `.cm-tooltip.cm-tooltip-autocomplete`, matching the
  // doubled class the base theme nests its list rules under. Dropping the first
  // class loses on specificity — not order — so the rule silently does nothing.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--paper-raised)",
    color: "var(--ink)",
    border: "1px solid var(--rule)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow-chip)",
    overflow: "hidden",
  },
  // Mono: every row is an identifier the reviewer is citing, not UI chrome.
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-sm)",
    maxHeight: "14rem",
  },
  // A flex row so the NAME truncates when a namespaced skill outruns the panel. The
  // origin comes last in source order, so the stock block layout would clip exactly
  // the field that tells two same-named skills apart.
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "baseline",
    padding: "0.15rem 0.5rem",
  },
  ".cm-completionLabel": { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  // The accent's wash, not the accent: amber itself stays reserved for the
  // wordmark and the primary action.
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-wash)",
    color: "var(--ink)",
  },
  // What the reviewer's typing matched. Weight alone carried this while the only
  // source filtered by prefix; a subsequence match over a path scatters single
  // characters the length of the row (`srlbfoo` against `src/lib/foo.ts`), and seven
  // bolded lone glyphs in mono read as noise. `--mark` is the token for a marked
  // region of the document, and being translucent it composites over the selected
  // row's `--accent-wash` rather than fighting it.
  ".cm-completionMatchedText": {
    textDecoration: "none",
    fontWeight: "600",
    backgroundColor: "var(--mark)",
  },
  // Metadata, so it recedes — but `flex: none` keeps it from shrinking away beside
  // the truncating label.
  ".cm-completionDetail": {
    color: "var(--ink-faint)",
    fontStyle: "normal",
    flex: "none",
    marginLeft: "0.75rem",
  },
  // The stale twin of the selected row. Both sources re-query per keystroke against
  // the daemon, so a dimmed stale list is the common case, not an edge. Same
  // specificity as the rule above — it wins by sitting after it, not by accident.
  ".cm-tooltip.cm-tooltip-autocomplete-disabled > ul > li[aria-selected]": {
    backgroundColor: "var(--chip)",
    color: "var(--ink-soft)",
  },
  // What the list says when a search stopped short of the whole answer (EXC-1175).
  // Receded and set in the prose face: a statement ABOUT the list, not a row in it.
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-xs)",
    color: "var(--ink-faint)",
    borderBottom: "1px solid var(--rule)",
    padding: "0.3rem 0.5rem",
    opacity: 1,
  },
  // That the preview window exists at all (EXC-1186) — a statement ABOUT the list,
  // like the stopped-search header above, and outside the `<ul>` so it stays put
  // while the rows scroll under it. A real element rather than generated content,
  // which is what lets the chord wear the chrome's own keycaps: `::before` can draw
  // a sentence but not a `<kbd>`. completionPreview.ts builds it.
  ".cm-tooltip.cm-tooltip-autocomplete .caret-completion-hint": {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-xs)",
    color: "var(--ink-faint)",
    borderBottom: "1px solid var(--rule)",
    padding: "0.3rem 0.5rem",
  },
});

/**
 * Re-arms completion after a deletion.
 *
 * autocomplete only ARMS a source on `input.type` (`getUpdateType`); a
 * `delete.backward` carries no activating bit, so a source that answered null once
 * stays Inactive through every backspace and the list never comes back. Under a
 * subsequence match the usual way to reach zero matches is a typo, and backspace is
 * the reflex correction — so the feature would go silently dead for that token.
 *
 * Deferred out of the update because `startCompletion` dispatches, which CodeMirror
 * refuses from inside an update listener.
 */
const reopenAfterDelete = EditorView.updateListener.of((update) => {
  if (!update.docChanged || completionStatus(update.state) !== null) return;
  if (!update.transactions.some((tr) => tr.isUserEvent("delete"))) return;
  queueMicrotask(() => startCompletion(update.view));
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
 * the stack). Escape is the interesting case — a list that is on screen owns it,
 * and the surrounding dialog owns it otherwise. `completionOpen` means *painted*,
 * not "the completion state machine is active"; see `completionListOpen` in
 * editorCompletion.ts. Exported for unit tests. */
export function chordAction(
  e: KeyboardEvent,
  completionOpen: boolean,
): "submit" | "closeCompletion" | "cancel" | null {
  if (isSubmitChord(e)) return "submit";
  if (!isCancelKey(e)) return null;
  return completionOpen ? "closeCompletion" : "cancel";
}

// Tab indents a selection or a list item, and inserts four literal spaces
// otherwise. Capturing Tab means it no longer tabs focus out of the editor — a
// deliberate trade for in-field list editing; Esc still dismisses the composer.
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
  // Empty for a surface with no review or no registered source. The re-arm rides
  // along with it: an editor offering no completion has nothing to re-arm, and a
  // listener on every update of every editor is not free.
  const completion = reviewCompletion(opts.reviewContext, opts.completionSources);
  const completionStack = completion.length === 0 ? [] : [...completion, reopenAfterDelete];
  return [
    history(),
    // codeLanguages: the full @codemirror/language-data set (~140 languages),
    // each lazy-loaded on demand when a fenced block declares it — so the initial
    // bundle stays lean and new languages need no code change here.
    markdown({ codeLanguages: languages }),
    syntaxHighlighting(highlightStyle),
    codeHighlighter,
    // What codeHighlighter reads to chip a reference. Contributes nothing —
    // not even the state field — for a surface mounted outside a review.
    refRecognition(opts.reviewContext, opts.refDeps),
    EditorView.lineWrapping,
    indentUnit.of(INDENT_UNIT),
    placeholder(opts.placeholder),
    EditorView.contentAttributes.of({
      ...(opts.ariaLabel ? { "aria-label": opts.ariaLabel } : {}),
      ...(opts.ariaRequired !== undefined ? { "aria-required": String(opts.ariaRequired) } : {}),
    }),
    // Chords first, outranking every keymap including autocomplete's own
    // `Prec.highest` one: a keymap's precedence orders it against other keymaps, but
    // the dispatcher running them all is a single `Prec.default` view plugin, so a
    // `Prec.highest` domEventHandlers plugin is always earlier in the array.
    Prec.highest(
      EditorView.domEventHandlers({
        keydown: (e, view) => {
          const action = chordAction(e, completionListOpen(view));
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
    // Its own keymap is `Prec.highest`, so an open list claims Arrow keys and Enter
    // ahead of the keymaps below by precedence, not by position here.
    ...completionStack,
    // Tab indent/outdent, before the default keymap (which leaves Tab unbound).
    indentKeymap,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    theme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onInput?.(u.state.doc.toString());
    }),
  ];
}
