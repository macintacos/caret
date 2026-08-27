// The reference-completion seam for MarkdownEditor.svelte — the contract every
// `@`/`/` completion source registers against, and the extension factory that
// binds them to the review the editor is composing feedback for. It sits beside
// markdownEditor.ts rather than inside it: that module owns the editor's styling
// and key handling, this one owns the registry two independent features add
// themselves to, so they never edit the same lines.
import {
  acceptCompletion,
  autocompletion,
  type CompletionSource,
  moveCompletionSelection,
} from "@codemirror/autocomplete";
import { type Extension, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";

import { completionPreview, type PreviewToggle, previewToggle } from "$lib/completionPreview.ts";
import { fileCompletion } from "$lib/fileCompletion.ts";
import { readShortcutHints } from "$lib/shortcutHintsPref.ts";
import { skillCompletion } from "$lib/skillCompletion.ts";

/**
 * The review a feedback editor is composing against. The three fields EXC-390
 * specified for its sources: the id names the review, `cwd` names the working
 * directory a file lookup would root at, and `adapter` the environment a skill
 * lookup would be scoped to. Which of them a given source actually reads is that
 * source's business.
 */
export interface ReviewContext {
  reviewId: string;
  cwd: string;
  /** The active adapter's id ("claude" | "opencode" | …), read from the health
   * probe. Undefined until the probe lands, or for a daemon predating the field. */
  adapter?: string;
}

/**
 * A completion source, bound to the review its editor belongs to. The factory
 * shape (rather than a bare `CompletionSource`) is what lets a source close over
 * the review's cwd and adapter without reading them from a module global.
 */
export type ReviewCompletionSource = (review: ReviewContext) => CompletionSource;

// Every source the feedback editors offer. Each feature adds one import and one
// entry here and owns nothing else in this file, so the file-reference source and
// the skill source can land in either order without touching each other. A plain
// array literal rather than a runtime `register()` registry: the set is static
// and known at build time, so there is no mount ordering to get wrong and nothing
// for the bundler to mis-shake.
export const COMPLETION_SOURCES: readonly ReviewCompletionSource[] = [
  fileCompletion,
  skillCompletion(),
];

/** Whether a completion list is PAINTED, which is the only thing Escape and the
 * preview toggle should key off. Deliberately not `completionStatus(state) ===
 * "active"`: while a source re-queries, autocomplete keeps the previous list on
 * screen (dimmed, `disabled`) and reports "pending" for that whole window, so the
 * status test hands Escape to the surrounding dialog with a list still visible —
 * and a source that re-queries per keystroke re-enters that window on every
 * character. No exported accessor distinguishes the two (`currentCompletions` and
 * friends all gate on `!open.disabled`), so the DOM is the ground truth. It is
 * reachable because the editor's stack configures no `tooltips({ parent })`, which
 * leaves CodeMirror mounting tooltips into `view.dom`. */
export function completionListOpen(view: EditorView): boolean {
  return view.dom.querySelector(".cm-tooltip-autocomplete") !== null;
}

/**
 * The chords a painted completion list claims, ahead of everything else.
 *
 * Every one of them declines the key when no list is painted, so the editor
 * behaves exactly as it did before completion existed: Tab still indents, Enter
 * still breaks a line, and Ctrl+Space still falls through to autocomplete's own
 * binding, which opens a list where there was none.
 *
 * Why each is here rather than left to autocomplete's stock keymap:
 *
 *   * **Ctrl+Space** is caret's own, and flips the preview toggle. Nothing else:
 *     the panel reads the toggle when it renders (completionPreview.ts), so the
 *     list is left exactly where the reviewer had arrowed it to.
 *   * **Tab / Shift-Tab** walk the list. The stock keymap binds only the arrows,
 *     and the editor's own Tab indents — so without an earlier claim, Tab over an
 *     open list would insert four spaces into the query.
 *   * **Enter** accepts and then types the space the reviewer would type next. A
 *     reference is a word in a sentence, and the stock `acceptCompletion` leaves
 *     the cursor flush against the name, where the next character would extend the
 *     reference rather than follow it.
 */
function completionChords(toggle: PreviewToggle): Extension {
  const overList =
    (run: (view: EditorView) => boolean) =>
    (view: EditorView): boolean =>
      completionListOpen(view) && run(view);
  return Prec.highest(
    keymap.of([
      {
        key: "Ctrl-Space",
        run: overList((view) => {
          toggle.toggle();
          // The panel is drawn by a view plugin, and a key handler that changes
          // no state produces no view update — so the flip on its own would
          // repaint nothing. An empty transaction is the smallest thing that runs
          // the update cycle: no changes and no selection, so the document is
          // untouched, `onInput` (gated on `docChanged`) never fires, and
          // autocomplete's own state — the reviewer's place in the list included
          // — is carried through unchanged.
          view.dispatch({});
          return true;
        }),
      },
      { key: "Tab", run: overList(moveCompletionSelection(true)) },
      { key: "Shift-Tab", run: overList(moveCompletionSelection(false)) },
      {
        key: "Enter",
        run: overList((view) => {
          if (!acceptCompletion(view)) return false;
          view.dispatch(view.state.replaceSelection(" "));
          return true;
        }),
      },
    ]),
  );
}

/**
 * The effects the completion stack reads that are neither the review nor the
 * sources: whether the preview panel is open, and whether the reviewer wants
 * shortcut hints shown at all. Each has a production default; a unit overrides
 * the one its case is about, the same shape `RefRecognitionDeps` sits in.
 */
export interface CompletionDeps {
  /** Whether the preview panel is open, defaulting to the app's own toggle.
   * Injected, a unit drives both states without touching it. */
  toggle?: PreviewToggle;
  /** Whether the shortcut-hint affordances are shown, defaulting to the real
   * preference read. A thunk rather than a boolean because the hint strip is
   * redrawn on every view update, so a toggle in Settings is picked up live. */
  showHints?: () => boolean;
}

/**
 * The autocomplete half of the editor's extension stack, or nothing at all when
 * there is no review to complete against and nothing registered to complete
 * with — so an editor mounted without review context behaves exactly as it did
 * before completion existed.
 *
 * autocompletion()'s stock keymap is kept, and `completionChords` sits in front of
 * it. Both install at `Prec.highest`, which is what lets an open list claim its
 * keys ahead of the editor's indent and default keymaps — a guarantee of
 * precedence rather than of array position.
 * Neither contends with the editor's submit/cancel chords: those ride a
 * `Prec.highest` domEventHandlers plugin, and every keymap — however high its own
 * precedence — is dispatched by a single `Prec.default` view plugin, because a
 * facet's `enables` extension is flattened at `Prec.default` regardless of what
 * pulled it in. The chord handler is therefore always earlier in the handler array,
 * and `runHandlers` stops at the first handler that returns true.
 *
 * @param review - The review the editor belongs to, or undefined for a surface
 *   mounted outside one.
 * @param sources - The registered sources; defaults to the module registry and is
 *   injectable so a unit can compose against a source of its own.
 * @param deps - The preview toggle and the shortcut-hints read, each defaulting
 *   to the app's own.
 */
export function reviewCompletion(
  review: ReviewContext | undefined,
  sources: readonly ReviewCompletionSource[] = COMPLETION_SOURCES,
  deps: CompletionDeps = {},
): Extension[] {
  if (review === undefined || sources.length === 0) return [];
  const { toggle = previewToggle, showHints = readShortcutHints } = deps;
  return [
    // Ahead of autocompletion()'s own keymap, which binds `Ctrl-Space` and `Enter`
    // too. Both flatten to `Prec.highest`, so precedence cannot separate them and
    // array position is what decides: `runHandlers` walks the handlers in order
    // and stops at the first that returns true.
    completionChords(toggle),
    autocompletion({
      // `icons: false` drops the per-type gutter CodeMirror renders for EVERY
      // option, whether or not the option declares a `type` — an empty box of
      // indent, and a stock emoji when it isn't empty. Neither source names a
      // type, so the column buys nothing.
      icons: false,
      override: sources.map((source) => source(review)),
    }),
    completionPreview(toggle, showHints),
  ];
}
