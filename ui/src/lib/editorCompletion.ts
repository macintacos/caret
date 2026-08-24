// The reference-completion seam for MarkdownEditor.svelte — the contract every
// `@`/`/` completion source registers against, and the extension factory that
// binds them to the review the editor is composing feedback for. It sits beside
// markdownEditor.ts rather than inside it: that module owns the editor's styling
// and key handling, this one owns the registry two independent features add
// themselves to, so they never edit the same lines.
import { autocompletion, type CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

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
const COMPLETION_SOURCES: readonly ReviewCompletionSource[] = [skillCompletion()];

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
 */
export function reviewCompletion(
  review: ReviewContext | undefined,
  sources: readonly ReviewCompletionSource[] = COMPLETION_SOURCES,
): Extension[] {
  if (review === undefined || sources.length === 0) return [];
  return [autocompletion({ override: sources.map((source) => source(review)) })];
}
