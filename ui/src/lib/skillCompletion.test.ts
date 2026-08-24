import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { SkillRef } from "@core/lib/types";
import { markdownExtensions } from "$lib/markdownEditor.ts";

import { skillCompletion } from "./skillCompletion.ts";

// The `/` source is what turns the EXC-1174 seam into a feature, so these drive a
// REAL EditorView with the source installed rather than calling it as a function:
// what matters is whether a list paints, what it inserts, and — the criterion a
// pure call can't reach — that an ordinary path in prose leaves no list sitting
// open over the text. Mirrors the live-view pattern in markdownEditor.test.ts.

const SKILLS: SkillRef[] = [
  { name: "git", origin: "user" },
  { name: "deploy", origin: "project" },
  { name: "superpowers:brainstorming", origin: "plugin" },
];

/** Each mount gets its own review id: the source memoises per review, and a shared
 * id would let one test's cached list answer another's fetch. */
let nextReview = 0;
function reviewId(): string {
  return `rev-${nextReview++}`;
}

function mount(fetchSkills: (id: string) => Promise<SkillRef[]>, id = reviewId()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    root: document,
    state: EditorState.create({
      doc: "",
      extensions: markdownExtensions({
        placeholder: "",
        ariaLabel: "Comment",
        reviewContext: { reviewId: id, cwd: "/w/caret", adapter: "claude" },
        completionSources: [skillCompletion(fetchSkills)],
      }),
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

const type = (view: EditorView, text: string) =>
  view.dispatch({
    changes: { from: view.state.doc.length, insert: text },
    selection: { anchor: view.state.doc.length + text.length },
    userEvent: "input.type",
  });
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const painted = (view: EditorView) => view.dom.querySelector(".cm-tooltip-autocomplete") !== null;
const rows = (view: EditorView) =>
  Array.from(view.dom.querySelectorAll(".cm-completionLabel")).map((n) => n.textContent);
const details = (view: EditorView) =>
  Array.from(view.dom.querySelectorAll(".cm-completionDetail")).map((n) => n.textContent);

const all = async () => SKILLS;

describe("skillCompletion triggering", () => {
  test("paints a list on `/` at the start of a line", async () => {
    const { view, dispose } = mount(all);
    try {
      type(view, "/");
      await settle(400);
      expect(painted(view)).toBe(true);
      // Row order on an empty query is CodeMirror's (it sorts by label), so this
      // pins the offer, not the ordering.
      expect(rows(view)?.sort()).toEqual(["/deploy", "/git", "/superpowers:brainstorming"]);
    } finally {
      dispose();
    }
  });

  test("paints a list on `/` after a space", async () => {
    const { view, dispose } = mount(all);
    try {
      type(view, "try /");
      await settle(400);
      expect(painted(view)).toBe(true);
    } finally {
      dispose();
    }
  });

  test("filters as the reviewer keeps typing", async () => {
    const { view, dispose } = mount(all);
    try {
      type(view, "/dep");
      await settle(400);
      expect(rows(view)).toEqual(["/deploy"]);
    } finally {
      dispose();
    }
  });

  test("leaves no list open over an ordinary path in prose", async () => {
    const { view, dispose } = mount(all);
    try {
      type(view, "see src/lib");
      await settle(400);
      expect(painted(view)).toBe(false);
    } finally {
      dispose();
    }
  });

  test("leaves no list open over a relative path", async () => {
    const { view, dispose } = mount(all);
    try {
      type(view, "./lib");
      await settle(400);
      expect(painted(view)).toBe(false);
    } finally {
      dispose();
    }
  });
});

describe("skillCompletion insertion", () => {
  test("inserts a plugin skill in its namespaced form", async () => {
    const { view, dispose } = mount(all);
    try {
      type(view, "/superp");
      await settle(400);
      expect(painted(view)).toBe(true);
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      expect(view.state.doc.toString()).toBe("/superpowers:brainstorming");
    } finally {
      dispose();
    }
  });

  test("tells two sources of the same bare name apart by their origin", async () => {
    const { view, dispose } = mount(async () => [
      { name: "deploy", origin: "user" },
      { name: "deploy", origin: "project" },
    ]);
    try {
      type(view, "/dep");
      await settle(400);
      expect(rows(view)).toEqual(["/deploy", "/deploy"]);
      expect(details(view)).toEqual(["user", "project"]);
    } finally {
      dispose();
    }
  });
});

describe("skillCompletion degradation", () => {
  test("paints nothing when the agent has no skills", async () => {
    const { view, dispose } = mount(async () => []);
    try {
      type(view, "/");
      await settle(400);
      expect(painted(view)).toBe(false);
    } finally {
      dispose();
    }
  });

  test("paints nothing, and does not throw, when the fetch rejects", async () => {
    const { view, dispose } = mount(async () => {
      throw new Error("daemon unreachable");
    });
    try {
      type(view, "/");
      await settle(400);
      expect(painted(view)).toBe(false);
    } finally {
      dispose();
    }
  });
});

describe("skillCompletion per-review caching", () => {
  test("fetches once per review, however many editors ask", async () => {
    const asked: string[] = [];
    const fetchSkills = async (id: string) => {
      asked.push(id);
      return SKILLS;
    };
    const id = reviewId();
    const a = mount(fetchSkills, id);
    const b = mount(fetchSkills, id);
    try {
      type(a.view, "/");
      type(b.view, "/");
      await settle(400);
      expect(asked).toEqual([id]);
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  test("two reviews each complete from their own agent's skills", async () => {
    const lists: Record<string, SkillRef[]> = {};
    const first = reviewId();
    const second = reviewId();
    lists[first] = [{ name: "git", origin: "user" }];
    lists[second] = [{ name: "caret:demo", origin: "command" }];
    const fetchSkills = async (id: string) => lists[id] ?? [];
    const a = mount(fetchSkills, first);
    const b = mount(fetchSkills, second);
    try {
      type(a.view, "/");
      type(b.view, "/");
      await settle(400);
      expect(rows(a.view)).toEqual(["/git"]);
      expect(rows(b.view)).toEqual(["/caret:demo"]);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
