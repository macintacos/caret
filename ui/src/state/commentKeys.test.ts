import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import type { CardHandle, CommentStop, FocusedStop } from "$lib/diffview/commentStops";

import { createCommentKeys } from "./commentKeys";

const commentStop: CommentStop = { ref: { kind: "comment", id: "a" }, start: 3, line: 4, slot: 4 };
const otherStop: CommentStop = { ref: { kind: "comment", id: "b" }, start: 8, line: 9, slot: 9 };
const resumeStop: CommentStop = { ref: { kind: "resume", key: "6:7" }, start: 6, line: 7, slot: 7 };

function fakeHandle(expanded: boolean) {
  const calls: string[] = [];
  const handle: CardHandle = {
    expand: () => calls.push("expand"),
    collapse: () => calls.push("collapse"),
    edit: () => calls.push("edit"),
    discard: () => calls.push("discard"),
    expanded: () => expanded,
  };
  return { handle, calls };
}

function setup(opts: { focused: FocusedStop | null; active?: Element | null }) {
  const resumed: string[] = [];
  const keys = createCommentKeys({
    stops: () => [commentStop, resumeStop, otherStop],
    focusedStop: () => opts.focused,
    resume: (key) => resumed.push(key),
    activeElement: () => opts.active ?? null,
  });
  return { keys, resumed };
}

const onComment: FocusedStop = { ref: commentStop.ref, line: 4 };

/** The first button in `html`, attached to the document. */
function buttonIn(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  const button = host.querySelector("button");
  if (!button) throw new Error("fixture has no button");
  return button;
}

describe("createCommentKeys", () => {
  test("no key is live without a hovered stop", () => {
    const { keys } = setup({ focused: null });
    expect(keys.live("activate")).toBe(false);
  });

  test("a resume marker takes only activate, which resumes its scratch", () => {
    const { keys, resumed } = setup({ focused: { ref: resumeStop.ref, line: 7 } });
    expect(keys.live("activate")).toBe(true);
    expect(keys.live("edit")).toBe(false);
    keys.run("activate");
    expect(resumed).toEqual(["6:7"]);
  });

  test("activate expands a collapsed card and edits an expanded one", () => {
    const collapsed = fakeHandle(false);
    const { keys } = setup({ focused: onComment });
    keys.register("a", collapsed.handle);
    keys.run("activate");
    expect(collapsed.calls).toEqual(["expand"]);

    const open = fakeHandle(true);
    keys.register("a", open.handle);
    keys.run("activate");
    expect(open.calls).toEqual(["edit"]);
  });

  test("run routes each key to the hovered card's handle", () => {
    const { handle, calls } = fakeHandle(true);
    const { keys } = setup({ focused: onComment });
    keys.register("a", handle);
    keys.run("collapse");
    keys.run("discard");
    keys.run("editInsert");
    expect(calls).toEqual(["collapse", "discard", "edit"]);
  });

  test("an unregistered handle is dropped, a replaced one kept", () => {
    const first = fakeHandle(false);
    const second = fakeHandle(false);
    const { keys } = setup({ focused: onComment });
    const off = keys.register("a", first.handle);
    keys.register("a", second.handle);
    off();
    keys.expand("a");
    expect(second.calls).toEqual(["expand"]);
  });

  test("no key is live under the discard confirm", () => {
    const active = buttonIn('<div role="alertdialog"><button>Discard</button></div>');
    const { keys } = setup({ focused: onComment, active });
    expect(keys.live("collapse")).toBe(false);
  });

  test("no key is live while focus is inside an open composer", () => {
    const active = buttonIn('<div class="composer" role="dialog"><button>Save</button></div>');
    const { keys } = setup({ focused: onComment, active });
    keys.register("a", fakeHandle(true).handle);
    expect(keys.live("collapse")).toBe(false);
    expect(keys.live("discard")).toBe(false);
  });

  test("Enter yields to a focused control outside every card", () => {
    const { keys } = setup({ focused: onComment, active: buttonIn("<button>Approve</button>") });
    expect(keys.live("activate")).toBe(false);
  });

  test("Enter yields to a focused control in the hovered stop's own card", () => {
    const active = buttonIn('<div data-annotation-card="a"><button>chip</button></div>');
    const { keys } = setup({ focused: onComment, active });
    expect(keys.live("activate")).toBe(false);
  });

  test("Enter acts on the hovered stop while a control in another card holds focus", () => {
    const active = buttonIn('<div data-annotation-card="b"><button>chip</button></div>');
    const { keys } = setup({ focused: { ref: resumeStop.ref, line: 7 }, active });
    expect(keys.live("activate")).toBe(true);
  });
});
