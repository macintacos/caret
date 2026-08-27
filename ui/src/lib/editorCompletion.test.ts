import { describe, expect, test } from "bun:test";

import type { CompletionSource } from "@codemirror/autocomplete";

import {
  type ReviewCompletionSource,
  type ReviewContext,
  reviewCompletion,
} from "./editorCompletion.ts";

// reviewCompletion composes the registered sources into the editor's extension
// stack. Composition is pure — no view, no DOM — so a bare call exercises it
// fully; whether a list actually paints is CodeMirror's own concern.

const CONTEXT: ReviewContext = { reviewId: "rev-1", cwd: "/w/caret", adapter: "claude" };

/** A source that records the context it was bound to. Returns no completions —
 * this suite asks who the factory was called with, not what it offers. */
function recordingSource(seen: ReviewContext[]): ReviewCompletionSource {
  return (review) => {
    seen.push(review);
    return (() => null) satisfies CompletionSource;
  };
}

describe("reviewCompletion", () => {
  test("contributes nothing without a review context", () => {
    const seen: ReviewContext[] = [];
    expect(reviewCompletion(undefined, [recordingSource(seen)])).toEqual([]);
    expect(seen).toEqual([]);
  });

  test("contributes nothing when no source is registered", () => {
    expect(reviewCompletion(CONTEXT, [])).toEqual([]);
  });

  test("contributes extensions once a source is registered", () => {
    const seen: ReviewContext[] = [];
    expect(reviewCompletion(CONTEXT, [recordingSource(seen)]).length).toBeGreaterThan(0);
  });

  test("registers no source yet, so this change installs no completion", () => {
    // The production call path: markdownExtensions passes no sources, so this reads
    // the module registry. It is empty on purpose — EXC-1174 ships the seam, not a
    // feature. The first sibling to register a source updates this line; that is
    // the point of pinning it.
    expect(reviewCompletion(CONTEXT)).toEqual([]);
  });

  test("binds each source to the review the editor belongs to", () => {
    const seen: ReviewContext[] = [];
    reviewCompletion(CONTEXT, [recordingSource(seen), recordingSource(seen)]);
    expect(seen).toEqual([CONTEXT, CONTEXT]);
  });
});
