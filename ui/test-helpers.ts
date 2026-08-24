// Shared fetch-stub scaffolding for UI tests that observe uiLog's wire batches
// (src/lib/log.ts buffers events and POSTs them to /api/logs). Install with
// logCapture() in beforeEach and restore() in afterEach: the module-global
// uiLog buffer is drained at install AND at restore — while the stub is live —
// so records can't bleed between cases or suites sharing one bun process.
// Imported as ../../test-helpers.ts by the lib tests (cf. test-setup.ts).
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { flush } from "./src/lib/log.ts";
import { type MarkdownEditorOptions, markdownExtensions } from "./src/lib/markdownEditor.ts";

export interface FetchCall {
  url: string;
  options: RequestInit | undefined;
}

/** Parse one captured /api/logs call's body into its event batch. */
export function batchEvents(call: FetchCall): Array<Record<string, unknown>> {
  const parsed = JSON.parse(call.options?.body as string) as {
    events: Array<Record<string, unknown>>;
  };
  return parsed.events;
}

export interface LogCapture {
  /** Captured /api/logs POSTs in arrival order. Same array identity for the
   * capture's lifetime, so a test installing its own fetch double can keep
   * recording into it (cf. log.test.ts's rejecting-fetch case). */
  calls: FetchCall[];
  /** Every captured batch's events, flattened in arrival order. */
  events(): Array<Record<string, unknown>>;
  /** Concatenated raw bodies — for negative (must-not-contain) assertions. */
  text(): string;
  /** Drain the buffer through the stub, then restore the original fetch. */
  restore(): void;
}

/**
 * Stub `globalThis.fetch`: `/api/logs` POSTs are captured (and answered 204);
 * any other URL routes to `respond` (default 204), so API-client tests can
 * answer their own endpoints per test.
 */
export function logCapture(
  respond: (url: string, options: RequestInit | undefined) => Promise<Response> = () =>
    Promise.resolve(new Response(null, { status: 204 })),
): LogCapture {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, options?: RequestInit) => {
    if (url === "/api/logs") {
      calls.push({ url, options });
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return respond(url, options);
  }) as typeof globalThis.fetch;
  // Drain residue from prior cases/suites into the stub, then discard it so
  // this capture starts clean.
  flush();
  calls.length = 0;
  return {
    calls,
    events: () => calls.flatMap(batchEvents),
    text: () => calls.map((c) => c.options?.body as string).join(""),
    restore() {
      flush(); // drain this case's residue while the stub still captures it
      globalThis.fetch = originalFetch;
      calls.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Live-editor scaffolding for the completion suites (markdownEditor.test.ts,
// skillCompletion.test.ts). Both drive a REAL EditorView with the production
// extension stack, because what they assert — whether a list is painted, and who
// owns Escape while it is — is not reachable by calling a source as a function.
// Shared here rather than copied: `.cm-tooltip-autocomplete` is production's own
// selector (markdownEditor.ts's completionListOpen keys on it), so a test-side
// copy of that literal is a second place for it to drift.

/** Mount a MarkdownEditor extension stack over a throwaway host. `dispose`
 * destroys the view and removes the host; call it in a `finally`. */
export function mountEditor(opts: MarkdownEditorOptions): {
  view: EditorView;
  dispose: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    root: document,
    state: EditorState.create({ doc: "", extensions: markdownExtensions(opts) }),
  });
  return {
    view,
    dispose: () => {
      view.destroy();
      host.remove();
    },
  };
}

/** Append `text` at the cursor as a real typing transaction — `userEvent` is what
 * makes @codemirror/autocomplete treat it as typing and activate. */
export function typeInto(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: view.state.doc.length, insert: text },
    selection: { anchor: view.state.doc.length + text.length },
    userEvent: "input.type",
  });
}

/** Delete the character before the cursor, as a `delete.backward` user event —
 * the transaction a real Backspace produces, and the one completion re-arming
 * keys off. */
export function backspaceIn(view: EditorView): void {
  view.dispatch({
    changes: { from: view.state.doc.length - 1, to: view.state.doc.length },
    selection: { anchor: view.state.doc.length - 1 },
    userEvent: "delete.backward",
  });
}

/** Whether a completion list is PAINTED — the DOM is the ground truth, exactly as
 * production's `completionListOpen` reads it. */
export function completionListPainted(view: EditorView): boolean {
  return view.dom.querySelector(".cm-tooltip-autocomplete") !== null;
}

/** @codemirror/autocomplete's own activation delay plus its view-update sync
 * window — the two deadlines a list has to clear before it can paint. Named
 * because a bare number here would be a fixed sleep with nothing in `ui/` holding
 * it (doc/agents/browser-testing.md § Timing discipline); these are the library's
 * numbers, and they are what would have to change to invalidate the waits below. */
export const COMPLETION_PAINT_MS = 100 + 100;

/** @codemirror/autocomplete's `interactionDelay` facet: how long after a list
 * opens it refuses to ACCEPT a completion, so a keystroke already in flight can't
 * pick an option the reviewer never saw. Selecting and painting are unaffected —
 * only acceptance — which is why a test that types and immediately presses Enter
 * gets a newline rather than the completion. */
export const COMPLETION_INTERACTION_MS = 75;

/** Poll `pred` until it holds, or the budget runs out; returns its final value.
 * Faster than a fixed sleep on the happy path and immune to host contention,
 * which is the whole reason the unit lane reddens under the gate. */
export async function until(pred: () => boolean, budgetMs = 5000): Promise<boolean> {
  const started = performance.now();
  while (!pred() && performance.now() - started < budgetMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return pred();
}

/** Give a list that should NOT appear long enough to appear. The one place a
 * fixed wait is right: there is no state to poll toward, so the assertion is
 * "still nothing after both of CodeMirror's deadlines". */
export async function settleCompletion(): Promise<void> {
  await new Promise((r) => setTimeout(r, COMPLETION_PAINT_MS * 2));
}

/** Wait out `interactionDelay` so the next Enter is allowed to accept. Fixed
 * rather than polled because there is nothing observable to poll toward: the
 * deadline lives on the completion state's timestamp, which no export surfaces. */
export async function allowCompletionAccept(): Promise<void> {
  await new Promise((r) => setTimeout(r, COMPLETION_INTERACTION_MS + 25));
}
