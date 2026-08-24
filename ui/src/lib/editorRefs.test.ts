import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { FileRefKind, SkillRef } from "@core/lib/types";
import type { ReviewContext } from "$lib/editorCompletion.ts";

import { recognizedRefs, refRecognition, scanRefTokens, type Timers } from "./editorRefs.ts";

// The chip layer's two halves, tested apart. scanRefTokens is pure: given a
// document it says which runs are REFERENCE-SHAPED and where a chip over each
// would sit — no network, no daemon, no opinion about whether any of them exist.
// refRecognition is the async half that asks the daemon which of them do, and
// what it owes the editor is a scheduling contract rather than an answer: one
// request per pause however fast the reviewer types, and a superseded answer
// dropped rather than painted. Both timers and both gates are injected, so the
// window is driven rather than slept through (doc/agents/browser-testing.md
// § Timing discipline, typescript-rules.md § Dependency injection).

const REVIEW: ReviewContext = { reviewId: "rev-1", cwd: "/w/caret", adapter: "claude" };

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown()] });
}

/** `[key, chipped text]` for every run the scan found, which is what every case
 * below actually asserts: what will be asked about, and what would wear the chip. */
function scanned(doc: string): [string, string][] {
  return scanRefTokens(stateOf(doc)).map((t) => [t.key, doc.slice(t.from, t.to)]);
}

describe("scanRefTokens — what counts as a reference in prose", () => {
  test("a path carrying a separator is a candidate", () => {
    expect(scanned("rework src/lib/foo.ts today")).toEqual([["src/lib/foo.ts", "src/lib/foo.ts"]]);
  });

  test("a bare filename with an extension is a candidate", () => {
    expect(scanned("see README.md")).toEqual([["README.md", "README.md"]]);
  });

  test("a bare word is NOT a candidate, however real a directory of that name is", () => {
    // The whole reason the editor may scan prose where the plan view refuses to:
    // without this clause every word is asked about, and `test` chips the moment
    // a `test/` exists beside it.
    expect(scanned("this test is broken and src is fine")).toEqual([]);
  });

  test("a cited line rides inside the chip but not inside the key", () => {
    expect(scanned("break at src/a.ts:42")).toEqual([["src/a.ts", "src/a.ts:42"]]);
  });

  test("a URL is not a reference, tail and all", () => {
    expect(scanned("see https://example.com/app.ts")).toEqual([]);
  });

  test("a skill after whitespace is a candidate, namespace and all", () => {
    expect(scanned("try /superpowers:brainstorming first")).toEqual([
      ["/superpowers:brainstorming", "/superpowers:brainstorming"],
    ]);
  });

  test("a skill opening the document is a candidate", () => {
    expect(scanned("/git it")).toEqual([["/git", "/git"]]);
  });

  test("a path's interior slash never reads as a skill", () => {
    expect(scanned("rework src/lib/foo.ts")).toEqual([["src/lib/foo.ts", "src/lib/foo.ts"]]);
  });
});

describe("scanRefTokens — code", () => {
  test("a single-token codespan needs no separator, and the chip covers the backticks", () => {
    // Backticks are the author saying "this is a path" — the same licence
    // buildFileRefLayer reads them as — so the prose clause is dropped inside one.
    expect(scanned("see `Makefile` now")).toEqual([["Makefile", "`Makefile`"]]);
  });

  test("a codespan holding whitespace is a command, not a path", () => {
    expect(scanned("run `bun test` first")).toEqual([]);
  });

  test("a fenced block is skipped entirely", () => {
    expect(scanned("```\nsrc/lib/foo.ts\n```")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/** A timer a test steps by hand: nothing fires until `fire()` is called. */
function fakeTimers(): Timers & { fire: () => void; pending: () => number } {
  let queued: (() => void) | undefined;
  return {
    set(fn) {
      queued = fn;
      return 1;
    },
    clear() {
      queued = undefined;
    },
    fire() {
      const run = queued;
      queued = undefined;
      run?.();
    },
    pending: () => (queued === undefined ? 0 : 1),
  };
}

/** A `resolveFileRefs` double whose answers are handed back on demand, so a test
 * can settle two in-flight requests in whichever order it wants to prove. */
function deferredResolver() {
  const waiting: Array<(kinds: Record<string, FileRefKind>) => void> = [];
  const asked: string[][] = [];
  return {
    asked,
    settle(at: number, kinds: Record<string, FileRefKind>) {
      (waiting[at] as (k: Record<string, FileRefKind>) => void)(kinds);
    },
    resolvePaths(_id: string, paths: string[]) {
      asked.push(paths);
      return new Promise<Record<string, FileRefKind>>((r) => waiting.push(r));
    },
  };
}

function mount(deps: Parameters<typeof refRecognition>[1], doc = "") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    root: document,
    state: EditorState.create({ doc, extensions: [markdown(), refRecognition(REVIEW, deps)] }),
  });
  return {
    view,
    known: () => [...view.state.field(recognizedRefs)].sort(),
    edit: (insert: string) =>
      view.dispatch({ changes: { from: view.state.doc.length, insert }, userEvent: "input.type" }),
    dispose: () => {
      view.destroy();
      host.remove();
    },
  };
}

const SKILLS: SkillRef[] = [{ name: "git", origin: "user" }];

/** Let the settled promises behind a resolve run to the dispatch. One macrotask
 * turn drains the whole microtask chain, and every promise in these cases is
 * already settled or settled by hand — so this is a queue drain, not a sleep
 * waiting for something that might not have happened yet. */
const drain = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("refRecognition", () => {
  test("recognizes the paths the daemon resolved and the skills the agent has", async () => {
    const timers = fakeTimers();
    const editor = mount(
      {
        timers,
        resolvePaths: async () => ({ "src/a.ts": "file" }),
        lookupSkills: async () => SKILLS,
      },
      "rework src/a.ts and src/gone.ts with /git, not /nope",
    );
    try {
      timers.fire();
      await drain();
      expect(editor.known()).toEqual(["/git", "src/a.ts"]);
    } finally {
      editor.dispose();
    }
  });

  test("asks nothing of a review whose cwd never arrived", async () => {
    const timers = fakeTimers();
    const asked: string[][] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      parent: host,
      root: document,
      state: EditorState.create({
        doc: "rework src/a.ts",
        extensions: [
          markdown(),
          refRecognition(
            { reviewId: "rev-1", cwd: "" },
            {
              timers,
              resolvePaths: async (_id, paths) => {
                asked.push(paths);
                return {};
              },
              lookupSkills: async () => [],
            },
          ),
        ],
      }),
    });
    try {
      timers.fire();
      await drain();
      expect(asked).toEqual([]);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  test("offers nothing at all without a review to recognize against", () => {
    expect(refRecognition(undefined)).toEqual([]);
  });

  test("rapid typing schedules one resolve, not one per keystroke", async () => {
    const timers = fakeTimers();
    const resolver = deferredResolver();
    const editor = mount({
      timers,
      resolvePaths: resolver.resolvePaths,
      lookupSkills: async () => [],
    });
    try {
      editor.edit("a.ts ");
      editor.edit("b.ts ");
      editor.edit("c.ts");
      // Three keystrokes, one armed timer — each edit replaced the last one's.
      expect(timers.pending()).toBe(1);
      timers.fire();
      await drain();
      expect(resolver.asked).toEqual([["a.ts", "b.ts", "c.ts"]]);
    } finally {
      editor.dispose();
    }
  });

  test("a superseded answer never repaints the document that outran it", async () => {
    const timers = fakeTimers();
    const resolver = deferredResolver();
    const editor = mount(
      { timers, resolvePaths: resolver.resolvePaths, lookupSkills: async () => [] },
      "a.ts",
    );
    try {
      timers.fire(); // request 0, over "a.ts"
      await drain();
      editor.edit(" b.ts");
      timers.fire(); // request 1, over "a.ts b.ts"
      await drain();
      expect(resolver.asked).toEqual([["a.ts"], ["a.ts", "b.ts"]]);

      resolver.settle(1, { "b.ts": "file" });
      await drain();
      expect(editor.known()).toEqual(["b.ts"]);

      // The older request lands late, claiming a.ts resolves. It is dropped —
      // an absence, so there is nothing to poll toward and the drain is the
      // whole assertion's setup.
      resolver.settle(0, { "a.ts": "file" });
      await drain();
      expect(editor.known()).toEqual(["b.ts"]);
    } finally {
      editor.dispose();
    }
  });

  test("a reference edited until it no longer resolves stops being recognized", async () => {
    const timers = fakeTimers();
    const onDisk: Record<string, FileRefKind> = { "src/a.ts": "file" };
    const editor = mount(
      {
        timers,
        resolvePaths: async (_id, paths) =>
          Object.fromEntries(
            paths.filter((p) => onDisk[p]).map((p) => [p, onDisk[p] as FileRefKind]),
          ),
        lookupSkills: async () => [],
      },
      "src/a.ts",
    );
    try {
      timers.fire();
      await drain();
      expect(editor.known()).toEqual(["src/a.ts"]);

      editor.edit("x");
      timers.fire();
      await drain();
      expect(editor.known()).toEqual([]);
    } finally {
      editor.dispose();
    }
  });
});
