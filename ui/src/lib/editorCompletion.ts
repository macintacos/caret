// The reference-completion seam for MarkdownEditor.svelte — the contract every
// `@`/`/` completion source registers against, and the extension factory that
// binds them to the review the editor is composing feedback for. It sits beside
// markdownEditor.ts rather than inside it: that module owns the editor's styling
// and key handling, this one owns the registry two independent features add
// themselves to, so they never edit the same lines.
import { autocompletion, type CompletionSource, startCompletion } from "@codemirror/autocomplete";
import { type Extension, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";

import { type PreviewToggle, previewToggle } from "$lib/completionPreview.ts";
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
 * Ctrl+Space over a painted completion list opens the preview panel beside it,
 * and a second one closes it (EXC-1186).
 *
 * The flip is followed by `startCompletion`, and that is the whole mechanism: the
 * panel is a row's `Completion.info`, and `CompletionTooltip.updateSel`
 * re-evaluates that only when the selected `<li>` element changes — so flipping
 * the toggle on its own would leave the panel exactly as it was.
 * `startCompletionEffect` forces every source back to Pending and re-queries, and
 * the sources read the toggle as they answer.
 *
 * With NO list painted this declines the key, leaving autocomplete's own
 * `Ctrl-Space` binding to open one — exactly what it did before the preview
 * existed. There is nothing to preview until there is a highlighted row.
 */
function previewKeymap(toggle: PreviewToggle): Extension {
  return Prec.highest(
    keymap.of([
      {
        key: "Ctrl-Space",
        run: (view) => {
          if (!completionListOpen(view)) return false;
          toggle.toggle();
          startCompletion(view);
          return true;
        },
      },
    ]),
  );
}

/**
 * The classes the completion tooltip wears, which is what draws the hint strip
 * above the list — the theme puts the sentence in a `::before` on the tooltip
 * itself (see markdownEditor.ts).
 *
 * A class rather than a section, and that is the whole reason the strip can say
 * two different things. A section is a property of a GROUP OF ROWS, so routing
 * the hint through one would make both sources depend on the shortcut-hints
 * preference for a third feature's benefit — and `fileCompletion` already spends
 * its section slot on the "First N matches" header. `tooltipClass` is re-evaluated
 * on every view update, so this live-tracks both the preference and the toggle
 * with no re-query, and lives entirely in this module.
 *
 * The preference hides the AFFORDANCE, never the shortcut: Ctrl+Space keeps
 * working with the strip gone, exactly as every other hint in the chrome does.
 */
function hintClass(showHints: () => boolean, toggle: PreviewToggle): () => string {
  return () => {
    if (!showHints()) return "";
    return toggle.on() ? "caret-completion-hint caret-preview-open" : "caret-completion-hint";
  };
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
   * preference read. A thunk rather than a boolean because `tooltipClass` is
   * asked on every view update, so a toggle in Settings is picked up live. */
  showHints?: () => boolean;
}

/**
 * The autocomplete half of the editor's extension stack, or nothing at all when
 * there is no review to complete against and nothing registered to complete
 * with — so an editor mounted without review context behaves exactly as it did
 * before completion existed.
 *
 * autocompletion()'s stock keymap is kept. It installs at `Prec.highest`, which is
 * what lets an open list claim ArrowUp/ArrowDown/Enter ahead of the editor's indent
 * and default keymaps — a guarantee of precedence rather than of array position.
 * It does not contend with the editor's submit/cancel chords: those ride a
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
    // Ahead of autocompletion()'s own keymap, which binds `Ctrl-Space` too. Both
    // flatten to `Prec.highest`, so precedence cannot separate them and array
    // position is what decides: `runHandlers` walks the handlers in order and
    // stops at the first that returns true.
    previewKeymap(toggle),
    autocompletion({
      // `icons: false` drops the per-type gutter CodeMirror renders for EVERY
      // option, whether or not the option declares a `type` — an empty box of
      // indent, and a stock emoji when it isn't empty. Neither source names a
      // type, so the column buys nothing.
      icons: false,
      tooltipClass: hintClass(showHints, toggle),
      override: sources.map((source) => source(review)),
    }),
  ];
}
