import { describe, expect, test } from "bun:test";

import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";

import type { FileSearchResponse } from "@core/lib/types";
import type { ReviewContext } from "$lib/editorCompletion.ts";
import { createFileCompletion, type SearchFiles } from "$lib/fileCompletion.ts";

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

  test("completion needs no adapter, so every agent gets it", async () => {
    const seen: Array<{ reviewId: string; query: string }> = [];
    const search = fakeSearch(seen, { paths: ["a.ts"], stoppedAt: null });
    // The codex adapter never sets `adapter`; nothing here reads it.
    const result = await complete("@a", search, { reviewId: "rev-1", cwd: "/w/caret" });
    expect(result?.options.map((o) => o.label)).toEqual(["a.ts"]);
  });
});
