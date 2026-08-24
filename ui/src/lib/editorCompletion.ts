// The reference-completion seam for MarkdownEditor.svelte — the contract every
// `@`/`/` completion source registers against, and the extension factory that
// binds them to the review the editor is composing feedback for. It sits beside
// markdownEditor.ts rather than inside it: that module owns the editor's styling
// and key handling, this one owns the registry two independent features add
// themselves to, so they never edit the same lines.
import { autocompletion, type CompletionSource, completionKeymap } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

/**
 * The review a feedback editor is composing against. Every reference-completion
 * source needs all three: the id names the review, `cwd` roots a file lookup,
 * and `adapter` scopes a skill lookup to the environment the plan came from.
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
const COMPLETION_SOURCES: readonly ReviewCompletionSource[] = [];

/**
 * The autocomplete half of the editor's extension stack, or nothing at all when
 * there is no review to complete against and nothing registered to complete
 * with — so an editor mounted without review context behaves exactly as it did
 * before completion existed.
 *
 * `defaultKeymap: false` is deliberate. autocompletion()'s own keymap installs at
 * `Prec.highest`, the same precedence as the editor's submit/cancel chord handler,
 * leaving the two ordered only by their position in the extension array. Binding
 * the completion keys at default precedence instead makes the chord handler
 * unambiguously outrank them (see markdownEditor.ts § chordAction), and placing
 * this ahead of the indent and default keymaps still lets an open list claim
 * ArrowUp/ArrowDown/Enter before cursor motion and newline insertion do.
 *
 * @param review - The review the editor belongs to, or undefined for a surface
 *   mounted outside one.
 * @param sources - The registered sources; defaults to the module registry and is
 *   injectable so a unit can compose against a source of its own.
 */
export function reviewCompletion(
  review: ReviewContext | undefined,
  sources: readonly ReviewCompletionSource[] = COMPLETION_SOURCES,
): Extension[] {
  if (review === undefined || sources.length === 0) return [];
  return [
    autocompletion({ override: sources.map((source) => source(review)), defaultKeymap: false }),
    keymap.of(completionKeymap),
  ];
}
