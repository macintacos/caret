// The `@` file-reference source for the feedback editors (EXC-1175): typing `@`
// opens the files under the review's own working directory, and choosing one
// leaves its cwd-relative path behind as literal text. Nothing else — a
// reference is text, so the completion inserts text and no decoration, no mark,
// and no widget.
//
// A `:42` typed after the filename is part of the reference rather than part of
// the query (EXC-1186): the daemon is asked for the path half, the citation rides
// along into what gets inserted, and the Ctrl+Space preview panel opens on that
// line rather than on the file's head.
//
// It registers against the seam in editorCompletion.ts and owns nothing else
// there, so it and the skill source can land in either order.

import type { Completion, CompletionResult, CompletionSource } from "@codemirror/autocomplete";

import type { FileExcerpt, FileSearchResponse, SearchStop } from "@core/lib/types";
import { getFileExcerpt, HttpError, searchFiles } from "$lib/api.ts";
import {
  type PreviewToggle,
  previewPanel,
  previewToggle,
  renderExcerptLines,
} from "$lib/completionPreview.ts";
import { classify } from "$lib/diffview/fileRefs.ts";
import type { ReviewCompletionSource } from "$lib/editorCompletion.ts";

/** Asking the daemon which files under a review's cwd match a query. Never
 * rejects — `api.ts` degrades a failed request to no matches, which is what
 * lets this source treat "nothing came back" as its only failure mode. */
export type SearchFiles = (reviewId: string, query: string) => Promise<FileSearchResponse>;

/** Reading a window of one of the review's files, for the preview panel. Unlike
 * `SearchFiles` this DOES reject: `api.ts` throws an HttpError on a non-2xx, and
 * telling a file too large to send from any other refusal is exactly what the
 * panel needs it to do. */
export type GetFileExcerpt = (
  reviewId: string,
  path: string,
  line?: number,
  range?: { start: number; end: number },
) => Promise<FileExcerpt>;

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
 * The trigger's text split into what the daemon should be asked for and the line
 * the reviewer cited after it, if any (EXC-1186).
 *
 * `classify` does the parsing: it is the codebase's one definition of
 * "path-shaped", and it already reads every spelling of a line reference a plan
 * writes — `:42`, `:L42`, `#L42`, and a `:42-50` range. A second notion of what a
 * line suffix looks like here would let what the editor completes and what the
 * source view links drift apart on the same text. A run it refuses — nothing with
 * a letter in its last segment, so a bare `@42` — is still a legitimate thing to
 * search for, and falls back to the query as typed.
 *
 * `suffix` is what the citation adds to the inserted path, empty when there was
 * none; `line` is the line the preview panel centres on. A range keeps both its
 * ends, because the reviewer typed both.
 */
function splitCitedLine(typed: string): { query: string; line?: number; suffix: string } {
  const cited = classify(typed);
  if (cited === null || cited.line === undefined) return { query: typed, suffix: "" };
  const end = cited.endLine === undefined ? "" : `-${cited.endLine}`;
  return { query: cited.path, line: cited.line, suffix: `:${cited.line}${end}` };
}

/**
 * Where `query` matched inside `label`, as the flat `[from, to, from, to, …]`
 * pairs CodeMirror's `getMatch` contract asks for.
 *
 * Mirrors the daemon's own matcher (`src/plan/file-search.ts`): greedy, leftmost,
 * case-insensitive, in order. Recomputing it here rather than having the route
 * return positions keeps that answer a plain list of paths, and the emphasis then
 * says exactly why a row is in the list, because it consumes the query the same
 * way the walk did.
 *
 * Adjacent hits merge into one range, so `@src` reads as one emphasised run
 * rather than three abutting spans.
 *
 * Characters are folded one at a time rather than over a pre-lowercased string.
 * The daemon lowercases the whole path, but the handful of characters whose
 * lowercase form is longer than one UTF-16 unit would shift every index after
 * them and paint the emphasis over the wrong characters. Such a path is still
 * offered and still insertable — it only loses its emphasis, which is why the
 * unmatched case returns `[]` rather than throwing.
 */
export function subsequenceRanges(label: string, query: string): number[] {
  // The needle is folded whole, exactly as the daemon folds it, so the characters
  // compared here are the ones that matched there. Only the LABEL is folded per
  // character, because only its indices are handed back.
  const needle = query.toLowerCase();
  const ranges: number[] = [];
  let i = 0;
  // The exclusive end of the range most recently pushed. Tracked alongside rather
  // than read back off `ranges`, which keeps the abutment test a plain number
  // comparison instead of an indexed read.
  let lastEnd = -1;
  for (let h = 0; h < label.length && i < needle.length; h++) {
    if (label.charAt(h).toLowerCase() !== needle.charAt(i)) continue;
    if (lastEnd === h) ranges[ranges.length - 1] = h + 1;
    else ranges.push(h, h + 1);
    lastEnd = h + 1;
    i++;
  }
  // A query this label does not carry in order has no honest emphasis. The daemon
  // matched it, so this is only reachable through the case-folding corner above.
  return i === needle.length ? ranges : [];
}

/**
 * The window the panel asks for: a file's first twenty lines, or the twenty
 * around a cited line — nine above it and ten below, because a reader carries on
 * downward from the line they named. Both ends are clamped by the daemon, so a
 * line past the end of a file comes back as that file's tail rather than as an
 * error.
 */
function previewWindow(line: number | undefined): { start: number; end: number } {
  if (line === undefined) return { start: 1, end: 20 };
  return { start: Math.max(1, line - 9), end: line + 10 };
}

/**
 * What the panel says when the read failed.
 *
 * Every failure is an ordinary answer rendered as a plain sentence: the list stays
 * open, every other row still works, and nothing throws into CodeMirror. The two
 * are told apart because the remedies differ — nothing the reviewer can do makes a
 * file small enough to send, while a file that could not be read may simply have
 * moved since the plan named it.
 */
function previewFailure(err: unknown): string {
  return err instanceof HttpError && err.status === 413
    ? "This file is too large to preview."
    : "This file could not be read.";
}

/**
 * The preview panel for one row: the file's lines around whatever the reviewer
 * cited, or a sentence saying why they are not there.
 *
 * Handed back synchronously with an empty body that the read fills in when it
 * lands — `updateSel`'s async branch skips the `aria-describedby` wiring its sync
 * branch does, so a row that awaited its answer would go undescribed and the panel
 * would arrive late. `destroy`, which CodeMirror calls the moment the selection
 * moves, cancels that write: a read landing after the reviewer has arrowed on
 * fills an element that is no longer on screen.
 */
function filePreview(
  excerpt: GetFileExcerpt,
  reviewId: string,
  line: number | undefined,
): (option: Completion) => { dom: HTMLElement; destroy: () => void } {
  return (option) => {
    const { dom, body } = previewPanel(option.label);
    let live = true;
    // The window is stated outright, so the centring `line` parameter is left
    // unset — `start`/`end` win over it at the route anyway.
    excerpt(reviewId, option.label, undefined, previewWindow(line)).then(
      (found) => {
        if (live) renderExcerptLines(body, found, line);
      },
      (err: unknown) => {
        if (live) body.textContent = previewFailure(err);
      },
    );
    return {
      dom,
      destroy: () => {
        live = false;
      },
    };
  };
}

/**
 * A completion source offering the files under `review.cwd`, asking `search` for
 * the matches.
 *
 * The factory over injected effects is what lets a unit drive the source with no
 * daemon and no network; `fileCompletion` below is the production binding.
 *
 * @param search - How to ask which files match a query.
 * @param excerpt - How to read the lines the preview panel shows.
 * @param toggle - Whether the reviewer has the panel open. Injected, a unit gets
 *   one of its own, so its state can neither be read from nor leak into the app's.
 */
export function createFileCompletion(
  search: SearchFiles,
  excerpt: GetFileExcerpt = getFileExcerpt,
  toggle: PreviewToggle = previewToggle,
): ReviewCompletionSource {
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

      const { query, line, suffix } = splitCitedLine(trigger.text.slice(1));
      const { paths, stoppedAt } = await search(review.reviewId, query);
      // Nothing matched is not an error and gets no list — the editor behaves
      // exactly as it did before completion existed. That covers the walk giving
      // up empty too: CodeMirror paints nothing for an option-free result, so the
      // only way to say so would be a row that is not a file.
      if (paths.length === 0) return null;

      const section = stoppedAt === null ? undefined : stoppedHeader(paths.length, stoppedAt);
      // The toggle is read HERE, at query time, and not by the panel at render
      // time: `updateSel` re-evaluates `info` only when the selected element
      // changes, so a panel that asked would never be asked again — see
      // completionPreview.ts.
      const info = toggle.on() ? filePreview(excerpt, review.reviewId, line) : undefined;
      const options: Completion[] = paths.map((path) => ({
        label: path,
        section,
        info,
        // The label stays the bare path, so the list still reads as paths; the
        // cited line rides in on the insertion instead. Undefined where nothing
        // was cited, which CodeMirror reads exactly as an absent `apply`: its
        // default replaces the range with the label.
        apply: suffix === "" ? undefined : `${path}${suffix}`,
      }));
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
        // …which is also why this has to be supplied. Turning the filter off
        // turns off the match ranges with it: CodeMirror hands each option
        // `getMatch ? getMatch(option) : []`, and the empty array renders a label
        // with no emphasised span anywhere in it. Without this the `@` list is the
        // one place in the editor that never shows why a row is a match.
        getMatch: (option) => subsequenceRanges(option.label, query),
        options,
      };
    };
}

/** The registered source, bound to the real daemon search. */
export const fileCompletion: ReviewCompletionSource = createFileCompletion(searchFiles);
