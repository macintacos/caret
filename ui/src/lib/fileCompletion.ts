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

import type { CompletionResult, CompletionSource } from "@codemirror/autocomplete";

import type { FileExcerpt, FileSearchResponse, SearchStop } from "@core/lib/types";
import { appearance } from "@/state/appearance.svelte.ts";
import { getFileExcerpt, HttpError, searchFiles } from "$lib/api.ts";
import {
  type PreviewableCompletion,
  type RowPreview,
  renderExcerptLines,
} from "$lib/completionPreview.ts";
import { classify } from "$lib/diffview/fileRefs.ts";
import { highlightChunk } from "$lib/diffview/highlight.ts";
import type { ReviewCompletionSource } from "$lib/editorCompletion.ts";

/** Asking the daemon which files under a review's cwd match a query. Never
 * rejects — `api.ts` degrades a failed request to no matches, which is what
 * lets this source treat "nothing came back" as its only failure mode. */
export type SearchFiles = (reviewId: string, query: string) => Promise<FileSearchResponse>;

/** Reading a range of lines from one of the review's files, for the preview
 * panel. Unlike
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

/** A line reference begun and not finished: one of `classify`'s own separators
 * (`:`, `:L`, `#L`, `:#L`), plus whatever digits and range dash have been typed
 * after it. Anchored to the end, so it only ever trims a trailing run. */
const PARTIAL_CITATION = /(?::?#L?|:L?)\d*(?:[-–,]L?\d*)?$/;

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
 * ends, because the reviewer typed both. A column is dropped — the excerpt route
 * has no notion of one — and a reversed range comes back in order, because
 * `classify` normalises it for every consumer.
 *
 * A citation the reviewer has STARTED — `api.ts:`, `api.ts#L`, `api.ts:42-` — is
 * a path plus an intention, and cites no line yet. Its opening is trimmed off the
 * query rather than searched: the daemon matches by subsequence over paths, no
 * path carries a `:`, so asking as typed would empty the list for exactly the
 * keystrokes between the colon and the number it belongs to — on this feature's
 * own happy path.
 */
function splitCitedLine(typed: string): { query: string; line?: number; suffix: string } {
  const cited = classify(typed);
  if (cited === null || cited.line === undefined) {
    return { query: typed.replace(PARTIAL_CITATION, ""), suffix: "" };
  }
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
 * The range of lines the panel asks for: a file's first twenty lines, or the twenty
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
 * Colours an excerpt already on screen, in place.
 *
 * A second pass rather than part of the fill, and deliberately: the panel waits
 * on `fill` before showing anything, and shiki's first call loads a grammar off
 * disk — so highlighting inside it would hold the reviewer at the loading bars
 * for a read that has already landed, and a slow grammar would time the whole
 * answer out. The lines go up plain and gain their colour when it arrives, which
 * is the order the plan view's own preview takes (components/FilePreview.svelte).
 *
 * Never throws: `highlightChunk` degrades every failure — an unknown grammar, a
 * line too long to tokenize — to no rows at all, and no rows leaves the plain
 * text exactly where it is. The counts are checked because the line numbers are
 * the excerpt's and the markup is shiki's; a disagreement would colour lines with
 * their neighbours' tokens.
 */
async function paintHighlight(
  body: HTMLElement,
  excerpt: FileExcerpt,
  signal: AbortSignal,
): Promise<void> {
  const { rows } = await highlightChunk(
    excerpt.lines.join("\n"),
    excerpt.language,
    appearance.themeId,
  );
  if (signal.aborted || rows.length !== excerpt.lines.length) return;
  const spans = body.querySelectorAll(".caret-preview-code");
  if (spans.length !== rows.length) return;
  spans.forEach((span, i) => {
    span.innerHTML = rows[i] as string;
  });
}

/**
 * What one row shows in the preview panel: the file's lines around whatever the
 * reviewer cited, or a sentence saying why they are not there.
 *
 * The `key` is the path and the cited line together, which is what the answer
 * actually depends on — so narrowing a query that leaves this row highlighted
 * re-uses the lines already on screen instead of blanking and refetching them per
 * keystroke, while typing the `2` of `:42` does move the excerpt.
 *
 * The abort signal is what keeps a slow read from writing into a body the
 * reviewer has already arrowed away from — the excerpt and the colour both.
 */
function filePreview(
  excerpt: GetFileExcerpt,
  reviewId: string,
  path: string,
  line: number | undefined,
): RowPreview {
  return {
    title: path,
    key: `${path}:${line ?? ""}`,
    fill: async (body, signal) => {
      let found: FileExcerpt;
      try {
        // The range is stated outright, so the centring `line` parameter is left
        // unset — `start`/`end` win over it at the route anyway.
        found = await excerpt(reviewId, path, undefined, previewWindow(line));
      } catch (err) {
        // Resolved rather than rejected: this IS the answer, and the panel's own
        // "no information found" would say less than the sentence below does.
        if (!signal.aborted) body.textContent = previewFailure(err);
        return;
      }
      if (signal.aborted) return;
      renderExcerptLines(body, found, line);
      // Not awaited: the lines are the answer, and the colour catches up into the
      // panel the caller is about to mount them in.
      void paintHighlight(body, found, signal);
    },
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
 */
export function createFileCompletion(
  search: SearchFiles,
  excerpt: GetFileExcerpt = getFileExcerpt,
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
      // Every row carries its preview whatever the toggle says. Whether one is
      // SHOWN is the panel's own decision, read at render time (see
      // completionPreview.ts) — deciding it here would tie the answer to whatever
      // the toggle happened to say when the query ran, and only a re-query could
      // change it back.
      const options: PreviewableCompletion[] = paths.map((path) => ({
        label: path,
        section,
        preview: filePreview(excerpt, review.reviewId, path, line),
        // The label stays the bare path, so the list still reads as paths, and
        // the insertion puts the `@` back in front of it: the trigger is part of
        // the reference the reviewer is writing, and the chip in the composer is
        // drawn over `@path` as one run. The cited line rides along on the same
        // string.
        apply: `@${path}${suffix}`,
      }));
      return {
        // The range starts at the `@` itself, so the whole reference — trigger
        // included — is what `apply` replaces, rather than leaving the typed `@`
        // to sit in front of a second one.
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
