// The `@` file-reference source for the feedback editors (EXC-1175): typing `@`
// opens the files under the review's own working directory, and choosing one
// leaves its cwd-relative path behind as literal text. Nothing else — a
// reference is text, so the completion inserts text and no decoration, no mark,
// and no widget.
//
// It registers against the seam in editorCompletion.ts and owns nothing else
// there, so it and the skill source can land in either order.

import type { Completion, CompletionResult, CompletionSource } from "@codemirror/autocomplete";

import type { FileSearchResponse } from "@core/lib/types";
import { searchFiles } from "$lib/api.ts";
import type { ReviewCompletionSource } from "$lib/editorCompletion.ts";

/** Asking the daemon which files under a review's cwd match a query. Never
 * rejects — `api.ts` degrades a failed request to no matches, which is what
 * lets this source treat "nothing came back" as its only failure mode. */
export type SearchFiles = (reviewId: string, query: string) => Promise<FileSearchResponse>;

// The trigger: an `@` and everything up to the cursor that is neither
// whitespace nor another `@`. Whitespace ends it, so a reviewer who types `@`
// and then a space is back in prose and the list closes on its own.
const TRIGGER = /@[^\s@]*/;

// An `@` only triggers at a word boundary, which is what keeps `someone@host`
// in prose from opening a file list. `matchBefore` has already anchored the
// match to the cursor, so this is the one thing left to ask about it.
function atWordBoundary(before: string): boolean {
  return before === "" || /\s/.test(before);
}

/**
 * What the list says when the daemon stopped at a cap: how much of the answer is
 * on screen, and the one thing the reviewer can do about it. Rendered by
 * CodeMirror as a header above the rows, so it is a statement rather than a
 * selectable row that would insert nothing.
 */
function truncationHeader(shown: number): string {
  return `First ${shown} matches — keep typing to narrow`;
}

/**
 * A completion source offering the files under `review.cwd`, asking `search` for
 * the matches.
 *
 * The factory over an injected search is what lets a unit drive the source with
 * no daemon and no network; `fileCompletion` below is the production binding.
 */
export function createFileCompletion(search: SearchFiles): ReviewCompletionSource {
  return (review): CompletionSource =>
    async (context): Promise<CompletionResult | null> => {
      const trigger = context.matchBefore(TRIGGER);
      if (trigger === null) return null;
      if (!atWordBoundary(context.state.sliceDoc(Math.max(0, trigger.from - 1), trigger.from))) {
        return null;
      }

      const { paths, truncated } = await search(review.reviewId, trigger.text.slice(1));
      if (paths.length === 0) return null;

      const section = truncated ? truncationHeader(paths.length) : undefined;
      const options: Completion[] = paths.map((path) => ({ label: path, section }));
      return {
        // The range starts at the `@` itself, so CodeMirror's default apply
        // carries the trigger away with the query and leaves only the path. A
        // `@src/lib/foo.ts` in the resulting plan would resolve to nothing.
        from: trigger.from,
        // The daemon already matched, by subsequence over the whole path.
        // Re-filtering here would drop rows it accepted: CodeMirror's matcher
        // refuses a two-character pattern that is neither a prefix, a word
        // start, nor an adjacent run, so `@oo` would lose `src/lib/foo.ts`.
        // One authority for what matches, and it is the one that walked the tree.
        filter: false,
        options,
      };
    };
}

/** The registered source, bound to the real daemon search. */
export const fileCompletion: ReviewCompletionSource = createFileCompletion(searchFiles);
