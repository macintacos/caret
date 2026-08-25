import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import type { CompletionSource } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { completionListPainted as painted, typeInto, until } from "@ui/test-helpers.ts";
import { createPreviewToggle, type PreviewToggle } from "$lib/completionPreview.ts";
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

// The Ctrl+Space preview binding (EXC-1186). What it decides — whether a list is
// painted — is only knowable from a real view, and the flip has to be followed by
// a re-query for the panel to repaint at all, so this drives a live EditorView
// over the extensions `reviewCompletion` returns rather than asserting on a
// command in isolation.
describe("Ctrl+Space over the completion list", () => {
  /** A source that always offers a row, and counts how often it was asked. */
  function countingSource(calls: { n: number }): CompletionSource {
    return (ctx) => {
      calls.n++;
      return { from: ctx.pos, options: [{ label: "alpha.ts" }] };
    };
  }

  function mountList(toggle: PreviewToggle, source: CompletionSource) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      parent: host,
      root: document,
      state: EditorState.create({
        doc: "",
        extensions: reviewCompletion(CONTEXT, [() => source], toggle),
      }),
    });
    return {
      view,
      dispose: () => {
        view.destroy();
        host.remove();
      },
    };
  }

  const ctrlSpace = (view: EditorView) =>
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", ctrlKey: true, bubbles: true, cancelable: true }),
    );

  test("opens the preview over a painted list, and closes it again", async () => {
    const toggle = createPreviewToggle();
    const { view, dispose } = mountList(toggle, countingSource({ n: 0 }));
    try {
      typeInto(view, "@a");
      expect(await until(() => painted(view))).toBe(true);

      ctrlSpace(view);
      expect(toggle.on()).toBe(true);

      ctrlSpace(view);
      expect(toggle.on()).toBe(false);
    } finally {
      dispose();
    }
  });

  test("re-queries the sources, which is the only way the panel repaints", async () => {
    // CompletionTooltip.updateSel re-evaluates a row's `info` only when the
    // selected element changes, so flipping the toggle alone would leave the
    // panel exactly as it was.
    const calls = { n: 0 };
    const toggle = createPreviewToggle();
    const { view, dispose } = mountList(toggle, countingSource(calls));
    try {
      typeInto(view, "@a");
      expect(await until(() => painted(view))).toBe(true);
      const before = calls.n;

      ctrlSpace(view);
      expect(toggle.on()).toBe(true);
      expect(await until(() => calls.n > before)).toBe(true);
    } finally {
      dispose();
    }
  });

  test("with no list painted it leaves the key to autocomplete's own binding", async () => {
    // Which opens a list, exactly as it did before the preview existed.
    const toggle = createPreviewToggle();
    const { view, dispose } = mountList(toggle, countingSource({ n: 0 }));
    try {
      expect(painted(view)).toBe(false);

      ctrlSpace(view);
      expect(await until(() => painted(view))).toBe(true);
      expect(toggle.on()).toBe(false);
    } finally {
      dispose();
    }
  });
});
