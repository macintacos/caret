import { describe, expect, test } from "bun:test";

import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";

import type { FileSearchResponse } from "@core/lib/types";
import type { ReviewContext } from "$lib/editorCompletion.ts";
import { createFileCompletion, type SearchFiles, subsequenceRanges } from "$lib/fileCompletion.ts";

// The `@` file-reference source (EXC-1175). Everything it decides is pure —
// whether the text before the cursor is a trigger, what query that trigger
// carries, and what the daemon's answer becomes — so a bare EditorState and a
// fake search exercise it fully. Whether CodeMirror then PAINTS the list, and
// what choosing a row leaves in the document, is real-browser behaviour and
// lives in test/e2e/file-completion.e2e.ts.

const REVIEW: ReviewContext = { reviewId: "rev-1", cwd: "/w/caret", adapter: "claude" };

/** A search that records what it was asked and answers with `answer`. */
function fakeSearch(
  seen: Array<{ reviewId: string; query: string }>,
  answer: FileSearchResponse = { paths: [], stoppedAt: null },
): SearchFiles {
  return (reviewId, query) => {
    seen.push({ reviewId, query });
    return Promise.resolve(answer);
  };
}

/** Run the source over `doc` with the cursor at its end. */
function complete(
  doc: string,
  search: SearchFiles,
  review: ReviewContext = REVIEW,
): Promise<CompletionResult | null> {
  const state = EditorState.create({ doc });
  const source = createFileCompletion(search)(review);
  return Promise.resolve(source(new CompletionContext(state, doc.length, false)));
}

describe("createFileCompletion", () => {
  test("an @ opens a list of the files the daemon matched", async () => {
    const search = fakeSearch([], { paths: ["src/app.ts", "src/lib/foo.ts"], stoppedAt: null });
    const result = await complete("see @", search);
    expect(result?.options.map((o) => o.label)).toEqual(["src/app.ts", "src/lib/foo.ts"]);
  });

  test("the query is the text after the @, and the review is the editor's own", async () => {
    const seen: Array<{ reviewId: string; query: string }> = [];
    await complete("see @srlbfoo", fakeSearch(seen));
    expect(seen).toEqual([{ reviewId: "rev-1", query: "srlbfoo" }]);
  });

  test("two reviews each complete from their own review", async () => {
    const seen: Array<{ reviewId: string; query: string }> = [];
    await complete("@a", fakeSearch(seen), { reviewId: "rev-1", cwd: "/w/one" });
    await complete("@a", fakeSearch(seen), { reviewId: "rev-2", cwd: "/w/two" });
    expect(seen.map((s) => s.reviewId)).toEqual(["rev-1", "rev-2"]);
  });

  test("the completed range starts at the @, so choosing a row replaces the trigger", async () => {
    const search = fakeSearch([], { paths: ["src/app.ts"], stoppedAt: null });
    const result = await complete("see @srlb", search);
    expect(result?.from).toBe("see ".length);
    // Nothing overrides `apply`: CodeMirror replaces the whole completed range
    // with the label, which is what carries the `@` away with the query.
    expect(result?.options.every((o) => o.apply === undefined)).toBe(true);
  });

  test("the daemon is the only thing that decides a match", async () => {
    const search = fakeSearch([], { paths: ["src/lib/foo.ts"], stoppedAt: null });
    // CodeMirror's own matcher refuses a two-character pattern that is neither a
    // prefix, a word start, nor an adjacent run — so filtering on top of the
    // daemon would drop rows it had already matched.
    const result = await complete("@oo", search);
    expect(result?.filter).toBe(false);
    expect(result?.options.map((o) => o.label)).toEqual(["src/lib/foo.ts"]);
  });

  test("the result cap says so, and says narrowing reaches the rest", async () => {
    const search = fakeSearch([], { paths: ["a.ts", "b.ts"], stoppedAt: "results" });
    const result = await complete("@", search);
    const sections = new Set(result?.options.map((o) => o.section));
    expect(sections.size).toBe(1);
    expect(String([...sections][0])).toContain("2");
    expect(String([...sections][0])).toContain("keep typing");
  });

  test("the scan cap never tells the reviewer to keep typing", async () => {
    // Narrowing cannot extend a walk that gave up — the next query gives up in
    // the same place — so the one remedy that works for the result cap is the
    // one thing this header must not promise.
    const search = fakeSearch([], { paths: ["a.ts", "b.ts"], stoppedAt: "scan" });
    const header = String((await complete("@", search))?.options[0]?.section);
    expect(header).toContain("2");
    expect(header).not.toContain("keep typing");
  });

  test("a complete answer carries no header", async () => {
    const search = fakeSearch([], { paths: ["a.ts"], stoppedAt: null });
    expect((await complete("@", search))?.options.every((o) => o.section === undefined)).toBe(true);
  });

  test("a review with no working directory never asks", async () => {
    // `cwd` is optional on both adapters' hook payloads and defaults to "", and
    // such a review can only ever 404 — once per debounced keystroke.
    const seen: Array<{ reviewId: string; query: string }> = [];
    expect(await complete("@src", fakeSearch(seen), { reviewId: "rev-1", cwd: "" })).toBeNull();
    expect(seen).toEqual([]);
  });

  test("a search that finds nothing leaves no list open", async () => {
    expect(await complete("@zzz", fakeSearch([]))).toBeNull();
  });

  test("prose with no @ never asks the daemon and never opens a list", async () => {
    const seen: Array<{ reviewId: string; query: string }> = [];
    expect(await complete("edit src/lib/foo.ts please", fakeSearch(seen))).toBeNull();
    expect(seen).toEqual([]);
  });

  test("an @ inside a word is not a trigger", async () => {
    const seen: Array<{ reviewId: string; query: string }> = [];
    expect(await complete("mail me at someone@example", fakeSearch(seen))).toBeNull();
    expect(seen).toEqual([]);
  });

  test("an @ at the start of the document is a trigger", async () => {
    const seen: Array<{ reviewId: string; query: string }> = [];
    await complete("@", fakeSearch(seen));
    expect(seen).toEqual([{ reviewId: "rev-1", query: "" }]);
  });

  test("whitespace after the @ ends the trigger", async () => {
    const seen: Array<{ reviewId: string; query: string }> = [];
    expect(await complete("@src ", fakeSearch(seen))).toBeNull();
    expect(seen).toEqual([]);
  });

  test("the list says which characters the query matched", async () => {
    const search = fakeSearch([], { paths: ["src/lib/foo.ts"], stoppedAt: null });
    const result = await complete("@srlbfoo", search);
    // `filter: false` turns off CodeMirror's own match ranges along with its
    // filtering — it passes `getMatch ? getMatch(option) : []` — so without this
    // the row renders with no emphasised span anywhere in it.
    const option = result?.options[0];
    if (option === undefined) throw new Error("expected a row to read the ranges off");
    const ranges = result?.getMatch?.(option) ?? [];
    expect(ranges.length).toBeGreaterThan(0);
    // Read the ranges back off the label: what is emphasised must be exactly what
    // the reviewer typed, in order. An off-by-one paints the neighbours instead
    // and this is the assertion that catches it.
    const label = "src/lib/foo.ts";
    const emphasised: string[] = [];
    for (let i = 0; i < ranges.length; i += 2)
      emphasised.push(label.slice(ranges[i], ranges[i + 1]));
    expect(emphasised.join("")).toBe("srlbfoo");
  });

  test("completion needs no adapter, so every agent gets it", async () => {
    const seen: Array<{ reviewId: string; query: string }> = [];
    const search = fakeSearch(seen, { paths: ["a.ts"], stoppedAt: null });
    // The codex adapter never sets `adapter`; nothing here reads it.
    const result = await complete("@a", search, { reviewId: "rev-1", cwd: "/w/caret" });
    expect(result?.options.map((o) => o.label)).toEqual(["a.ts"]);
  });
});

describe("subsequenceRanges", () => {
  /** The emphasised substrings, which is what the ranges mean on screen. */
  function emphasised(label: string, query: string): string[] {
    const ranges = subsequenceRanges(label, query);
    const out: string[] = [];
    for (let i = 0; i < ranges.length; i += 2) out.push(label.slice(ranges[i], ranges[i + 1]));
    return out;
  }

  test("a scattered subsequence emphasises exactly the characters typed", () => {
    expect(emphasised("src/lib/foo.ts", "srlbfoo")).toEqual(["sr", "l", "b", "foo"]);
  });

  test("adjacent hits merge into one run rather than abutting spans", () => {
    // Three separate [n, n+1] pairs would render as three <span>s in a row —
    // the same characters, but a background wash would seam between them.
    expect(subsequenceRanges("src/lib/foo.ts", "src")).toEqual([0, 3]);
  });

  test("matching folds case, because the daemon matched lowercased", () => {
    expect(emphasised("README.md", "rm")).toEqual(["R", "M"]);
  });

  test("an empty query emphasises nothing", () => {
    expect(subsequenceRanges("src/app.ts", "")).toEqual([]);
  });

  test("a query the label does not carry in order emphasises nothing", () => {
    // Unreachable from the source — the daemon already matched — so the contract
    // is that it degrades to no emphasis rather than to a wrong one.
    expect(subsequenceRanges("src/app.ts", "zz")).toEqual([]);
    expect(subsequenceRanges("src/app.ts", "pa")).toEqual([]);
  });

  test("every range is a valid slice of the label", () => {
    const label = "ui/src/lib/markdownEditor.ts";
    const ranges = subsequenceRanges(label, "uimded");
    expect(ranges.length % 2).toBe(0);
    for (let i = 0; i < ranges.length; i += 2) {
      // `?? -1` rather than a non-null assertion: a missing entry fails the first
      // expectation instead of being asserted away.
      const from = ranges[i] ?? -1;
      const to = ranges[i + 1] ?? -1;
      expect(from).toBeGreaterThanOrEqual(0);
      expect(from).toBeLessThan(to);
      expect(to).toBeLessThanOrEqual(label.length);
    }
  });
});
