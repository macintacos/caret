// The `@` file-reference source for the feedback editors (EXC-1175): typing `@`
// opens the files under the review's own working directory, and choosing one
// leaves its cwd-relative path behind as literal text. Nothing else — a
// reference is text, so the completion inserts text and no decoration, no mark,
// and no widget.
//
// It registers against the seam in editorCompletion.ts and owns nothing else
// there, so it and the skill source can land in either order.

import type { Completion, CompletionResult, CompletionSource } from "@codemirror/autocomplete";

import type { FileSearchResponse, SearchStop } from "@core/lib/types";
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
 * What the list says when the search stopped short: how many rows are on screen,
 * and — only where it is true — that narrowing reaches the rest. Rendered by
 * CodeMirror as a header above the rows, so it is a statement ABOUT the list
 * rather than a selectable row that would insert nothing.
 *
 * The two causes get different sentences because the remedy differs. Against the
 * result cap more matches exist and a longer query reaches them; against the scan
 * cap the walk gave up before the end of the tree, and the next query gives up in
 * the same place — so "keep typing" would send the reviewer after something
 * typing cannot reach.
 */
function stoppedHeader(shown: number, stoppedAt: SearchStop): string {
  return stoppedAt === "results"
    ? `First ${shown} matches — keep typing to narrow`
    : `First ${shown} matches — this tree is larger than the search reaches`;
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

      // A review whose cwd never arrived (the field is optional on both adapters'
      // hook payloads, and `routeIncomingPlan` defaults it to "") can only ever
      // 404. Asking anyway would spend a request and a log record per keystroke
      // on a permanently known answer.
      if (review.cwd === "") return null;

      const { paths, stoppedAt } = await search(review.reviewId, trigger.text.slice(1));
      // Nothing matched is not an error and gets no list — the editor behaves
      // exactly as it did before completion existed. That covers the walk giving
      // up empty too: CodeMirror paints nothing for an option-free result, so the
      // only way to say so would be a row that is not a file.
      if (paths.length === 0) return null;

      const section = stoppedAt === null ? undefined : stoppedHeader(paths.length, stoppedAt);
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
