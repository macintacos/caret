import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import {
  CompletionContext,
  type CompletionResult,
  completionStatus,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type { SkillRef } from "@core/lib/types";
import {
  allowCompletionAccept,
  drainMicrotasks,
  mountEditor,
  completionListPainted as painted,
  settleCompletion,
  typeInto as type,
  until,
} from "@ui/test-helpers.ts";
import type { PreviewableCompletion, RowPreview } from "$lib/completionPreview.ts";

import { createSkillCache, type DescribeSkill, skillCompletion } from "./skillCompletion.ts";

// The `/` source is what turns the EXC-1174 seam into a feature, so the
// triggering and insertion cases drive a REAL EditorView with the source
// installed rather than calling it as a function: what matters there is whether a
// list paints, what it inserts, and — the criterion a pure call can't reach —
// that an ordinary path in prose leaves no list sitting open over the text. The
// live-view scaffolding is shared with markdownEditor.test.ts
// (ui/test-helpers.ts). The preview-panel block at the foot of the file is pure
// and says so where it sits.

const SKILLS: SkillRef[] = [
  { name: "git", origin: "user" },
  { name: "deploy", origin: "project" },
  { name: "superpowers:brainstorming", origin: "plugin" },
  { name: "team/deploy", origin: "command" },
];

/** Each mount gets its own review id, so one test's cached list can never answer
 * another's fetch even when they share a source. */
let nextReview = 0;
function reviewId(): string {
  return `rev-${nextReview++}`;
}

/** Mount an editor whose only completion source is `source`, bound to `id`. */
function mount(source: ReturnType<typeof skillCompletion>, id = reviewId()) {
  return mountEditor({
    placeholder: "",
    ariaLabel: "Comment",
    reviewContext: { reviewId: id, cwd: "/w/caret", adapter: "claude" },
    completionSources: [source],
  });
}

/** A source over a fixed list — the common case. */
function sourceOver(skills: SkillRef[]) {
  return skillCompletion(async () => skills);
}

const rows = (view: EditorView) =>
  Array.from(view.dom.querySelectorAll(".cm-completionLabel")).map((n) => n.textContent);
const details = (view: EditorView) =>
  Array.from(view.dom.querySelectorAll(".cm-completionDetail")).map((n) => n.textContent);

describe("skillCompletion triggering", () => {
  test("paints a list on `/` at the start of a line", async () => {
    const { view, dispose } = mount(sourceOver(SKILLS));
    try {
      type(view, "/");
      expect(await until(() => painted(view))).toBe(true);
      // Row order on an empty query is CodeMirror's (it sorts by label), so this
      // pins the offer, not the ordering.
      expect(rows(view).sort()).toEqual([
        "/deploy",
        "/git",
        "/superpowers:brainstorming",
        "/team/deploy",
      ]);
    } finally {
      dispose();
    }
  });

  test("paints a list on `/` after a space", async () => {
    const { view, dispose } = mount(sourceOver(SKILLS));
    try {
      type(view, "try /");
      expect(await until(() => painted(view))).toBe(true);
    } finally {
      dispose();
    }
  });

  test("filters as the reviewer keeps typing", async () => {
    const { view, dispose } = mount(sourceOver(SKILLS));
    try {
      type(view, "/dep");
      expect(await until(() => rows(view).length === 2)).toBe(true);
      // CodeMirror matches within the name, not just at its start, so a nested
      // command whose leaf begins "dep" is a legitimate hit alongside the bare one.
      expect(rows(view)).toEqual(["/deploy", "/team/deploy"]);
    } finally {
      dispose();
    }
  });

  test("keeps filtering past the slash inside a nested command name", async () => {
    // The name grammar has to match what the adapters emit: OpenCode names a
    // nested command by its path, so typing the next character of a name the list
    // just offered must not kill the list.
    const { view, dispose } = mount(sourceOver(SKILLS));
    try {
      type(view, "/team/dep");
      expect(await until(() => painted(view))).toBe(true);
      expect(rows(view)).toEqual(["/team/deploy"]);
    } finally {
      dispose();
    }
  });

  test("leaves no list open over an ordinary path in prose", async () => {
    const { view, dispose } = mount(sourceOver(SKILLS));
    try {
      type(view, "see src/lib");
      await settleCompletion();
      expect(painted(view)).toBe(false);
    } finally {
      dispose();
    }
  });

  test("leaves no list open over a multi-segment path in prose", async () => {
    // The slash in the token class must not turn a deeper path into a trigger:
    // matchBefore anchors at the cursor, so the whole run is tested at its FIRST
    // slash, whose preceding character is still a word character.
    const { view, dispose } = mount(sourceOver(SKILLS));
    try {
      type(view, "see src/lib/api.ts");
      await settleCompletion();
      expect(painted(view)).toBe(false);
    } finally {
      dispose();
    }
  });

  test("leaves no list open over a relative path", async () => {
    const { view, dispose } = mount(sourceOver(SKILLS));
    try {
      type(view, "./lib");
      await settleCompletion();
      expect(painted(view)).toBe(false);
    } finally {
      dispose();
    }
  });
});

describe("skillCompletion insertion", () => {
  test("inserts a plugin skill in its namespaced form", async () => {
    const { view, dispose } = mount(sourceOver(SKILLS));
    try {
      type(view, "/superp");
      // Accepting needs CodeMirror's own state to be active with a selection —
      // a stricter precondition than a painted tooltip, and the exact one the
      // completion keymap checks before it claims Enter.
      expect(await until(() => completionStatus(view.state) === "active")).toBe(true);
      await allowCompletionAccept();
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      // …and the space after it: a citation is a word in a sentence, so Enter
      // leaves the cursor ready for the next one rather than flush against the
      // name, where the next character would extend the reference.
      expect(view.state.doc.toString()).toBe("/superpowers:brainstorming ");
    } finally {
      dispose();
    }
  });

  test("tells two sources of the same bare name apart by their origin", async () => {
    const { view, dispose } = mount(
      sourceOver([
        { name: "deploy", origin: "user" },
        { name: "deploy", origin: "project" },
      ]),
    );
    try {
      type(view, "/dep");
      expect(await until(() => rows(view).length === 2)).toBe(true);
      expect(rows(view)).toEqual(["/deploy", "/deploy"]);
      expect(details(view)).toEqual(["user", "project"]);
    } finally {
      dispose();
    }
  });
});

describe("skillCompletion degradation", () => {
  test("paints nothing when the agent has no skills", async () => {
    const { view, dispose } = mount(sourceOver([]));
    try {
      type(view, "/");
      await settleCompletion();
      expect(painted(view)).toBe(false);
    } finally {
      dispose();
    }
  });

  test("paints nothing, and does not throw, when the fetch rejects", async () => {
    const { view, dispose } = mount(
      skillCompletion(async () => {
        throw new Error("daemon unreachable");
      }),
    );
    try {
      type(view, "/");
      await settleCompletion();
      expect(painted(view)).toBe(false);
    } finally {
      dispose();
    }
  });

  test("retries after a failure rather than staying dark for the tab's life", async () => {
    // A daemon that was restarting must not disable completion permanently: only
    // a SUCCESSFUL enumeration is cached.
    let attempt = 0;
    const source = skillCompletion(async () => {
      attempt++;
      if (attempt === 1) throw new Error("daemon restarting");
      return SKILLS;
    });
    const id = reviewId();
    const first = mount(source, id);
    try {
      type(first.view, "/");
      await settleCompletion();
      expect(painted(first.view)).toBe(false);
    } finally {
      first.dispose();
    }
    const second = mount(source, id);
    try {
      type(second.view, "/");
      expect(await until(() => painted(second.view))).toBe(true);
    } finally {
      second.dispose();
    }
  });
});

describe("skillCompletion per-review caching", () => {
  test("fetches once per review, however many editors ask", async () => {
    // editorCompletion.ts builds ONE source for the whole app, so this mounts one
    // source into two editors — the production wiring, not a module global.
    const asked: string[] = [];
    const source = skillCompletion(async (id) => {
      asked.push(id);
      return SKILLS;
    });
    const id = reviewId();
    const a = mount(source, id);
    const b = mount(source, id);
    try {
      type(a.view, "/");
      type(b.view, "/");
      expect(await until(() => painted(a.view) && painted(b.view))).toBe(true);
      expect(asked).toEqual([id]);
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  test("re-fetches after a null snapshot rather than keeping the failed answer", async () => {
    // `null` is how the daemon round trip reports a transient failure — offline, a
    // 5xx, a restart. Caching it would disable completion for the tab's life over
    // one unlucky keystroke, so the entry is dropped and the next `/` asks again.
    let attempt = 0;
    const source = skillCompletion(async () => {
      attempt++;
      return attempt === 1 ? null : SKILLS;
    });
    const id = reviewId();
    const first = mount(source, id);
    try {
      type(first.view, "/");
      await settleCompletion();
      expect(painted(first.view)).toBe(false);
    } finally {
      first.dispose();
    }
    const second = mount(source, id);
    try {
      type(second.view, "/");
      expect(await until(() => painted(second.view))).toBe(true);
    } finally {
      second.dispose();
    }
  });

  test("keeps a genuinely empty snapshot, so an agent with no skills is asked once", async () => {
    // The codex case, and the cost the cache exists to avoid: an empty list is a
    // real answer, so it is cached like any other rather than re-asked per `/`.
    let asked = 0;
    const source = skillCompletion(async () => {
      asked++;
      return [];
    });
    const id = reviewId();
    const a = mount(source, id);
    const b = mount(source, id);
    try {
      type(a.view, "/");
      await settleCompletion();
      type(b.view, "/");
      await settleCompletion();
      expect(painted(a.view)).toBe(false);
      expect(asked).toBe(1);
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
    const source = skillCompletion(async (id) => lists[id] ?? []);
    const a = mount(source, first);
    const b = mount(source, second);
    try {
      type(a.view, "/");
      type(b.view, "/");
      expect(await until(() => painted(a.view) && painted(b.view))).toBe(true);
      expect(rows(a.view)).toEqual(["/git"]);
      expect(rows(b.view)).toEqual(["/caret:demo"]);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});

// createSkillCache is the enumeration itself, lifted out of the `/` source's
// closure so the editor's chip recognizer (lib/editorRefs.ts, EXC-1177) reads the
// same one — a review's plugin tree is walked once however many surfaces ask
// about it. The source's own caching behaviour is pinned above, through a real
// view; these drive the cache directly.
describe("createSkillCache", () => {
  test("asks once per review, however many callers ask", async () => {
    const asked: string[] = [];
    const cache = createSkillCache(async (id) => {
      asked.push(id);
      return SKILLS;
    });
    const id = reviewId();
    expect(await Promise.all([cache(id), cache(id), cache(id)])).toEqual([SKILLS, SKILLS, SKILLS]);
    expect(asked).toEqual([id]);
  });

  test("keeps each review's own list", async () => {
    const lists: Record<string, SkillRef[]> = {
      a: [{ name: "git", origin: "user" }],
      b: [{ name: "caret:demo", origin: "command" }],
    };
    const cache = createSkillCache(async (id) => lists[id] ?? []);
    expect(await cache("a")).toEqual(lists.a as SkillRef[]);
    expect(await cache("b")).toEqual(lists.b as SkillRef[]);
  });

  test("answers a rejected fetch with an empty list and retries the next ask", async () => {
    // Only a SUCCESSFUL enumeration is cached: a daemon that was restarting must
    // not disable recognition for the rest of the tab's life.
    let attempt = 0;
    const cache = createSkillCache(async () => {
      attempt++;
      if (attempt === 1) throw new Error("daemon restarting");
      return SKILLS;
    });
    const id = reviewId();
    expect(await cache(id)).toEqual([]);
    expect(await cache(id)).toEqual(SKILLS);
  });
});

// The Ctrl+Space preview over a `/` row (EXC-1186). Unlike the triggering and
// insertion cases above, what a row carries is pure — what the panel would be
// asked for, what it would be titled, and what it says when the skill describes
// itself nowhere — so a bare EditorState drives it, the same shape
// fileCompletion.test.ts uses for its half. Where the panel is DRAWN, and that a
// keypress opens it at all, is the panel's own business
// (completionPreview.test.ts) and the browser's (test/e2e/).
describe("the row preview", () => {
  /** A description lookup that records what it was asked. Never rejects, exactly
   * as `api.ts`'s does — every failure there is already a null. */
  function fakeDescribe(
    seen: Array<[string, SkillRef]>,
    answer: string | null = "Plan before writing",
  ): DescribeSkill {
    return (id, skill) => {
      seen.push([id, skill]);
      return Promise.resolve(answer);
    };
  }

  /** Run a `/` source over `doc` with the cursor at its end. */
  function complete(
    doc: string,
    describe: DescribeSkill,
    skills: SkillRef[] = SKILLS,
  ): Promise<CompletionResult | null> {
    const state = EditorState.create({ doc });
    const source = skillCompletion(
      async () => skills,
      describe,
    )({
      reviewId: "rev-1",
      cwd: "/w/caret",
    });
    return Promise.resolve(source(new CompletionContext(state, doc.length, false)));
  }

  /** The preview the row for `label` carries. */
  function previewOf(result: CompletionResult | null, label: string): RowPreview {
    const option = result?.options.find((o) => o.label === label) as
      | PreviewableCompletion
      | undefined;
    if (option?.preview === undefined) throw new Error(`expected a preview for ${label}`);
    return option.preview;
  }

  /** A throwaway body filled from that row's preview, and settled — which is when
   * the read it started has written into it. */
  async function bodyFor(result: CompletionResult | null, label: string): Promise<HTMLElement> {
    const body = document.createElement("div");
    await previewOf(result, label).fill(body, new AbortController().signal);
    await drainMicrotasks();
    return body;
  }

  test("nothing is asked until the panel asks — a query alone describes no skill", async () => {
    // The toggle is not the source's business: every row carries a preview, and
    // the panel decides whether to draw one. Reading here would ask about every
    // skill in the list on every `/` keystroke.
    const seen: Array<[string, SkillRef]> = [];
    const result = await complete("/", fakeDescribe(seen));
    expect(result?.options.every((o) => (o as PreviewableCompletion).preview !== undefined)).toBe(
      true,
    );
    expect(seen).toEqual([]);
  });

  test("the panel shows the highlighted skill's own description", async () => {
    const result = await complete("/", fakeDescribe([], "Plan before writing"));
    expect((await bodyFor(result, "/git")).textContent).toContain("Plan before writing");
  });

  test("the preview is titled with the name it describes", async () => {
    const result = await complete("/", fakeDescribe([]));
    expect(previewOf(result, "/git").title).toBe("/git");
  });

  test("each row asks about its own name and origin, not its label", async () => {
    // The label carries the leading `/` because that is what gets inserted; the
    // lookup key is the row itself. The origin travels with it because it is what
    // tells two roots offering one bare name apart — keyed on the name alone, one
    // of them would be described twice.
    const seen: Array<[string, SkillRef]> = [];
    const result = await complete("/", fakeDescribe(seen));
    await bodyFor(result, "/superpowers:brainstorming");
    expect(seen).toEqual([["rev-1", { name: "superpowers:brainstorming", origin: "plugin" }]]);
  });

  test("two roots offering one bare name get keys the panel can tell apart", async () => {
    // The key is what decides whether arrowing between rows refetches. These two
    // share a label deliberately — keyed on that, the second row would look like
    // the first to the panel and show the first's description.
    const result = await complete("/", fakeDescribe([]), [
      { name: "deploy", origin: "user" },
      { name: "deploy", origin: "project" },
    ]);
    const keys = (result?.options ?? []).map((o) => (o as PreviewableCompletion).preview?.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  test("a skill that describes itself nowhere says so, plainly", async () => {
    // Null is the ordinary answer for a skill with no description AND for every
    // failure behind it, so this one sentence is the whole no-answer state.
    const result = await complete("/", fakeDescribe([], null));
    expect((await bodyFor(result, "/git")).textContent).toContain("No description");
  });

  test("a read landing after the reviewer arrowed on writes nothing", async () => {
    let land: (description: string | null) => void = () => {};
    const describe: DescribeSkill = () =>
      new Promise((resolve) => {
        land = resolve;
      });
    const result = await complete("/", describe);
    const body = document.createElement("div");
    // The panel aborts the row's read the moment the selection moves, and the
    // read it started is still in flight — its element is off screen.
    const controller = new AbortController();
    const filling = previewOf(result, "/git").fill(body, controller.signal);
    controller.abort();
    land("Plan before writing");
    await filling;
    await drainMicrotasks();
    expect(body.textContent).not.toContain("Plan before writing");
  });
});
