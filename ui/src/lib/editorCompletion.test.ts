import { describe, expect, test } from "bun:test";

import type { CompletionSource } from "@codemirror/autocomplete";

import { fileCompletion } from "$lib/fileCompletion.ts";

import {
  COMPLETION_SOURCES,
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

  test("the module registry is what the production call path installs", () => {
    // markdownExtensions passes no sources, so this reads the module registry.
    // Pinned because a registry that loses an entry means every feedback editor
    // silently offers less than it should — the failure a registration mistake
    // produces, and one no other test in this file would catch. The count is part
    // of the pin: `skillCompletion()` is called per registration, so it has no
    // stable identity to match on the way `fileCompletion` does.
    expect(COMPLETION_SOURCES).toContain(fileCompletion);
    expect(COMPLETION_SOURCES).toHaveLength(2); // file references, and skills
    expect(reviewCompletion(CONTEXT).length).toBeGreaterThan(0);
  });

  test("binds each source to the review the editor belongs to", () => {
    const seen: ReviewContext[] = [];
    reviewCompletion(CONTEXT, [recordingSource(seen), recordingSource(seen)]);
    expect(seen).toEqual([CONTEXT, CONTEXT]);
  });
});
