import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import {
  type CompletionSource,
  completionStatus,
  selectedCompletionIndex,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import {
  allowCompletionAccept,
  completionListPainted as painted,
  typeInto,
  until,
} from "@ui/support/helpers.ts";
import { createPreviewToggle, type PreviewToggle } from "$lib/completionPreview.ts";
import { fileCompletion } from "$lib/fileCompletion.ts";

import {
  COMPLETION_SOURCES,
  type CompletionDeps,
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

/** A live editor over one source and the given deps, in a detached host. */
function mountWith(source: CompletionSource, deps: CompletionDeps) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    root: document,
    state: EditorState.create({
      doc: "",
      extensions: reviewCompletion(CONTEXT, [() => source], deps),
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

// The chords a painted list claims (EXC-1186). Whether a list is painted is only
// knowable from a real view, and every one of these bindings is gated on it, so
// this drives a live EditorView over the extensions `reviewCompletion` returns
// rather than asserting on a command in isolation.
describe("the chords a painted completion list claims", () => {
  /** A source that always offers two rows, and counts how often it was asked. */
  function countingSource(calls: { n: number }): CompletionSource {
    return (ctx) => {
      calls.n++;
      return { from: ctx.pos, options: [{ label: "alpha.ts" }, { label: "beta.ts" }] };
    };
  }

  function mountList(toggle: PreviewToggle, source: CompletionSource) {
    return mountWith(source, { toggle, showHints: () => false });
  }

  const press = (view: EditorView, init: KeyboardEventInit) =>
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  const ctrlSpace = (view: EditorView) => press(view, { key: " ", ctrlKey: true });
  const tab = (view: EditorView) => press(view, { key: "Tab" });
  const shiftTab = (view: EditorView) => press(view, { key: "Tab", shiftKey: true });
  const enter = (view: EditorView) => press(view, { key: "Enter" });

  /** Paint a list and wait out both gates every one of these chords is behind. */
  async function listReady(view: EditorView): Promise<void> {
    typeInto(view, "@a");
    expect(await until(() => painted(view))).toBe(true);
    expect(await until(() => completionStatus(view.state) === "active")).toBe(true);
    await allowCompletionAccept();
  }

  test("Ctrl+Space opens the preview over a painted list, and closes it again", async () => {
    const toggle = createPreviewToggle();
    const { view, dispose } = mountList(toggle, countingSource({ n: 0 }));
    try {
      await listReady(view);

      ctrlSpace(view);
      expect(toggle.on()).toBe(true);

      ctrlSpace(view);
      expect(toggle.on()).toBe(false);
    } finally {
      dispose();
    }
  });

  test("Ctrl+Space re-queries nothing, so the list the reviewer is reading stands", async () => {
    // The window reads the toggle when it renders, so there is nothing to re-run.
    // A re-query would restart the list at its first row and throw away the row
    // the reviewer asked about — the whole reason the window is caret's own.
    const calls = { n: 0 };
    const toggle = createPreviewToggle();
    const { view, dispose } = mountList(toggle, countingSource(calls));
    try {
      await listReady(view);
      const before = calls.n;
      const row = selectedCompletionIndex(view.state);

      ctrlSpace(view);
      expect(toggle.on()).toBe(true);
      expect(calls.n).toBe(before);
      expect(selectedCompletionIndex(view.state)).toBe(row);
    } finally {
      dispose();
    }
  });

  test("with no list painted Ctrl+Space is left to autocomplete's own binding", async () => {
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

  test("Tab walks down the list and Shift+Tab walks back up", async () => {
    const { view, dispose } = mountList(createPreviewToggle(), countingSource({ n: 0 }));
    try {
      await listReady(view);
      expect(selectedCompletionIndex(view.state)).toBe(0);

      tab(view);
      expect(selectedCompletionIndex(view.state)).toBe(1);

      shiftTab(view);
      expect(selectedCompletionIndex(view.state)).toBe(0);
    } finally {
      dispose();
    }
  });

  test("with no list painted Tab is left to the rest of the stack", async () => {
    // Which is where the editor's own indent lives — capturing Tab
    // unconditionally would put four spaces in a reviewer's list instead.
    let reached = false;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      parent: host,
      root: document,
      state: EditorState.create({
        doc: "",
        extensions: [
          reviewCompletion(CONTEXT, [() => countingSource({ n: 0 })], {
            toggle: createPreviewToggle(),
            showHints: () => false,
          }),
          keymap.of([
            {
              key: "Tab",
              run: () => {
                reached = true;
                return true;
              },
            },
          ]),
        ],
      }),
    });
    try {
      expect(painted(view)).toBe(false);
      tab(view);
      expect(reached).toBe(true);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  test("Enter accepts the highlighted row and leaves a space after it", async () => {
    // A citation is a word in a sentence: without the space the cursor sits flush
    // against the name, where the next character extends the reference instead of
    // following it.
    const { view, dispose } = mountList(createPreviewToggle(), countingSource({ n: 0 }));
    try {
      await listReady(view);
      enter(view);
      expect(view.state.doc.toString()).toBe("@aalpha.ts ");
      expect(view.state.selection.main.head).toBe(view.state.doc.length);
    } finally {
      dispose();
    }
  });

  test("with no list painted Enter is left alone", async () => {
    const { view, dispose } = mountList(createPreviewToggle(), countingSource({ n: 0 }));
    try {
      expect(painted(view)).toBe(false);
      enter(view);
      // Nothing was accepted and no space was inserted; what Enter does then is
      // the editor's own business, not this stack's.
      expect(view.state.doc.toString()).toBe("");
    } finally {
      dispose();
    }
  });
});

// The hint strip is drawn by the preview plugin (completionPreview.ts), which owns
// its markup and its two sentences. What belongs here is narrower: that
// `reviewCompletion` hands the plugin the deps it was given, so the preference and
// the toggle reach it at all.
describe("the shortcut-hint wiring", () => {
  function alwaysOffers(): CompletionSource {
    return (ctx) => ({ from: ctx.pos, options: [{ label: "alpha.ts" }] });
  }

  /** Paint a list and report whether the strip is above it. */
  async function stripWith(deps: CompletionDeps): Promise<boolean> {
    const { view, dispose } = mountWith(alwaysOffers(), deps);
    try {
      typeInto(view, "@a");
      expect(await until(() => painted(view))).toBe(true);
      return await until(() => view.dom.querySelector(".caret-completion-hint") !== null);
    } finally {
      dispose();
    }
  }

  test("hints on: the strip is drawn above the list", async () => {
    expect(await stripWith({ toggle: createPreviewToggle(), showHints: () => true })).toBe(true);
  });

  test("hints off: no strip, and the shortcut keeps working", async () => {
    // The preference hides the affordance, never the shortcut — which the
    // Ctrl+Space cases above pin separately.
    expect(await stripWith({ toggle: createPreviewToggle(), showHints: () => false })).toBe(false);
  });
});
