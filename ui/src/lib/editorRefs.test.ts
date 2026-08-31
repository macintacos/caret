import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { FileRefKind, SkillRef } from "@core/lib/types";
import { drainMicrotasks as drain, fakeTimers } from "@ui/test-helpers.ts";
import type { ReviewContext } from "$lib/editorCompletion.ts";

import { recognizedRefs, refKey, refRecognition, scanRefTokens } from "./editorRefs.ts";

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

/** `[refKey, chipped text]` for every run the scan found — what will be asked
 * about, which gate will be asked, and what would wear the chip. The kind is in
 * the key because the two namespaces overlap and which one claimed a run is part
 * of what these cases pin. */
function scanned(doc: string): [string, string][] {
  return scanRefTokens(stateOf(doc)).map((t) => [refKey(t), doc.slice(t.from, t.to)]);
}

describe("scanRefTokens — what counts as a reference in prose", () => {
  test("a path carrying a separator is a candidate", () => {
    expect(scanned("rework src/lib/foo.ts today")).toEqual([
      ["path:src/lib/foo.ts", "src/lib/foo.ts"],
    ]);
  });

  test("a bare filename with an extension is a candidate", () => {
    expect(scanned("see README.md")).toEqual([["path:README.md", "README.md"]]);
  });

  test("a bare word is NOT a candidate, however real a directory of that name is", () => {
    // worthAsking is what keeps prose scanning honest wherever it happens — this
    // whole-document scan and the plan view's parenthesized scope alike: without
    // that clause every word is asked about, and `test` chips the moment a
    // `test/` exists beside it.
    expect(scanned("this test is broken and src is fine")).toEqual([]);
  });

  test("a cited line rides inside the chip but not inside the key", () => {
    expect(scanned("break at src/a.ts:42")).toEqual([["path:src/a.ts", "src/a.ts:42"]]);
  });

  test("the `@` a reviewer completed with rides inside the chip", () => {
    // The sigil is part of the reference the reviewer wrote — the `@` source
    // inserts it (fileCompletion.ts) — so a chip that stops after it leaves the
    // one character that says "this is a reference" sitting outside the pill.
    expect(scanned("rework @src/lib/foo.ts today")).toEqual([
      ["path:src/lib/foo.ts", "@src/lib/foo.ts"],
    ]);
  });

  test("the `@` rides in with a cited line too", () => {
    expect(scanned("break at @src/a.ts:42")).toEqual([["path:src/a.ts", "@src/a.ts:42"]]);
  });

  test("an `@` mid-word is left where it is", () => {
    // Only a boundary `@` is the completion's sigil; `someone@host.com` is an
    // address, and the same test keeps the `@` list from opening over one.
    expect(scanned("mail someone@host.com now")).toEqual([["path:host.com", "host.com"]]);
  });

  test("an `@` opening the document still rides in", () => {
    expect(scanned("@src/a.ts")).toEqual([["path:src/a.ts", "@src/a.ts"]]);
  });

  // Every case above ends its document on the reference itself. A reviewer does
  // not: the most ordinary place to write a path is the end of a sentence, and
  // both token classes admit `.`, so the stop lands inside the run unless it is
  // trimmed off both the key and the chip.
  test("a full stop ends the sentence rather than the path", () => {
    expect(scanned("please fix src/lib/foo.ts.")).toEqual([
      ["path:src/lib/foo.ts", "src/lib/foo.ts"],
    ]);
  });

  test("a full stop ends the sentence rather than the skill", () => {
    expect(scanned("then run /git.")).toEqual([["skill:/git", "/git"]]);
  });

  test("a colon after a skill introduces the next clause", () => {
    expect(scanned("run /git: it fixes this")).toEqual([["skill:/git", "/git"]]);
  });

  test("a bare slash names no skill", () => {
    expect(scanned("either / or")).toEqual([]);
  });

  test("a URL is not a reference, tail and all", () => {
    expect(scanned("see https://example.com/app.ts")).toEqual([]);
  });

  test("a skill after whitespace is a candidate, namespace and all", () => {
    expect(scanned("try /superpowers:brainstorming first")).toEqual([
      ["skill:/superpowers:brainstorming", "/superpowers:brainstorming"],
    ]);
  });

  test("a skill opening the document is a candidate", () => {
    expect(scanned("/git it")).toEqual([["skill:/git", "/git"]]);
  });

  test("a path's interior slash never reads as a skill", () => {
    expect(scanned("rework src/lib/foo.ts")).toEqual([["path:src/lib/foo.ts", "src/lib/foo.ts"]]);
  });
});

describe("scanRefTokens — code", () => {
  test("a single-token codespan needs no separator, and the chip covers the backticks", () => {
    // Backticks are the author saying "this is a path" — the same licence
    // buildFileRefLayer reads them as — so the prose clause is dropped inside one.
    expect(scanned("see `Makefile` now")).toEqual([["path:Makefile", "`Makefile`"]]);
  });

  test("a codespan holding whitespace is a command, not a path", () => {
    expect(scanned("run `bun test` first")).toEqual([]);
  });

  test("an indented code block is skipped too", () => {
    expect(scanned("prose\n\n    src/lib/foo.ts\n")).toEqual([]);
  });

  test("masking a codespan does not manufacture a skill boundary after it", () => {
    // Blanked with spaces, the `/deploy` here would read as whitespace-preceded
    // and be offered to the SKILL gate at a boundary the reviewer never typed.
    // It stays a path candidate, which the daemon then refuses for being
    // absolute — so it never chips either way.
    expect(scanned("see `foo.ts`/deploy")).toEqual([
      ["path:foo.ts", "`foo.ts`"],
      ["path:/deploy", "/deploy"],
    ]);
  });

  test("a fenced block is skipped entirely", () => {
    expect(scanned("```\nsrc/lib/foo.ts\n```")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

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

function mount(deps: Parameters<typeof refRecognition>[1], doc = "", review = REVIEW) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    root: document,
    state: EditorState.create({ doc, extensions: [markdown(), refRecognition(review, deps)] }),
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

describe("refRecognition", () => {
  test("recognizes the paths the daemon resolved and the skills the agent has", async () => {
    const timers = fakeTimers();
    const editor = mount(
      {
        ...timers,
        resolvePaths: async () => ({ "src/a.ts": "file" }),
        lookupSkills: async () => SKILLS,
      },
      "rework src/a.ts and src/gone.ts with /git, not /nope",
    );
    try {
      timers.fire();
      await drain();
      expect(editor.known()).toEqual(["path:src/a.ts", "skill:/git"]);
    } finally {
      editor.dispose();
    }
  });

  test("asks nothing of a review whose cwd never arrived", async () => {
    const timers = fakeTimers();
    const asked: string[][] = [];
    const editor = mount(
      {
        ...timers,
        resolvePaths: async (_id, paths) => {
          asked.push(paths);
          return {};
        },
        lookupSkills: async () => [],
      },
      "rework src/a.ts",
      { reviewId: "rev-1", cwd: "" },
    );
    try {
      timers.fire();
      await drain();
      expect(asked).toEqual([]);
    } finally {
      editor.dispose();
    }
  });

  test("offers nothing at all without a review to recognize against", () => {
    expect(refRecognition(undefined)).toEqual([]);
  });

  test("rapid typing schedules one resolve, not one per keystroke", async () => {
    const timers = fakeTimers();
    const resolver = deferredResolver();
    const editor = mount({
      ...timers,
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
      { ...timers, resolvePaths: resolver.resolvePaths, lookupSkills: async () => [] },
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
      expect(editor.known()).toEqual(["path:b.ts"]);

      // The older request lands late, claiming a.ts resolves. It is dropped —
      // an absence, so there is nothing to poll toward and the drain is the
      // whole assertion's setup.
      resolver.settle(0, { "a.ts": "file" });
      await drain();
      expect(editor.known()).toEqual(["path:b.ts"]);
    } finally {
      editor.dispose();
    }
  });

  test("drops an answer that lands after the view is gone", async () => {
    // The generation bump in destroy() is the only thing between a late resolve
    // and a dispatch into a destroyed view, so it needs a case that could break
    // it (typescript-rules.md § Test-assertion discipline).
    const timers = fakeTimers();
    const resolver = deferredResolver();
    const editor = mount(
      { ...timers, resolvePaths: resolver.resolvePaths, lookupSkills: async () => [] },
      "a.ts",
    );
    timers.fire();
    await drain();
    editor.dispose();
    resolver.settle(0, { "a.ts": "file" });
    await drain(); // the dispatch would throw on a destroyed view if it happened
  });

  test("a path and a skill spelled the same do not grant each other a chip", async () => {
    // `classify("/git")` accepts, so a `/git` codespan is a PATH candidate spelled
    // exactly like the skill. Keyed on the string alone, the skill's existence
    // would chip a codespan the filesystem never answered for.
    const timers = fakeTimers();
    const editor = mount(
      {
        ...timers,
        resolvePaths: async () => ({}),
        lookupSkills: async () => SKILLS,
      },
      "run /git over `/git`",
    );
    try {
      timers.fire();
      await drain();
      expect(editor.known()).toEqual(["skill:/git"]);
    } finally {
      editor.dispose();
    }
  });

  test("refKey separates the two namespaces", () => {
    expect(refKey({ kind: "skill", key: "/git" })).not.toBe(refKey({ kind: "path", key: "/git" }));
  });

  test("a reference edited until it no longer resolves stops being recognized", async () => {
    const timers = fakeTimers();
    const onDisk: Record<string, FileRefKind> = { "src/a.ts": "file" };
    const editor = mount(
      {
        ...timers,
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
      expect(editor.known()).toEqual(["path:src/a.ts"]);

      editor.edit("x");
      timers.fire();
      await drain();
      expect(editor.known()).toEqual([]);
    } finally {
      editor.dispose();
    }
  });
});
