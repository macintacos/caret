import "../../test-mount.ts";

import { describe, expect, test } from "bun:test";
import type { Annotation } from "@core/types";
import type { ComponentProps } from "svelte";
import type { ComposerScratch } from "../lib/diffview/commenting.ts";
import { capture, flushUntil, render } from "../../test-mount.ts";
import RequestChangesDialog from "./RequestChangesDialog.svelte";

// Now composed on the shared Modal (bits-ui Dialog): its content portals to
// document.body on a deferred tick, so structure/render is asserted against the
// body after an effect+timer flush (the shadcn-foundation verdict). Real-browser
// interaction — Escape/backdrop dismiss, textarea autofocus, and the Collapsible
// disclosures expanding — is covered in test/e2e/request-changes.e2e.ts.

const ann = (id: string, comment: string): Annotation => ({
  id,
  blockId: "b0",
  startOffset: 0,
  endOffset: 3,
  quote: "abc",
  comment,
});

const lineAnn = (id: string, startLine: number, endLine: number, comment: string): Annotation => ({
  id,
  startLine,
  endLine,
  comment,
});

const scratch = (startLine: number, endLine: number, text: string): ComposerScratch => ({
  key: `${startLine}:${endLine}`,
  startLine,
  endLine,
  text,
});

const baseProps = {
  annotations: [] as Annotation[],
  generalComment: "",
  planText: "",
  scratches: [] as ComposerScratch[],
  onGeneralCommentInput: () => {},
  onSubmit: () => {},
  onCancel: () => {},
  onSaveScratch: () => {},
  onDiscardScratch: () => {},
  onDiscardAnnotation: () => {},
  onDraftAnnotation: () => {},
};

const q = (sel: string) => document.body.querySelector(sel);
const content = () => q("[data-slot='dialog-content']");
const mounted = () => content() !== null;
const summary = () => q(".summary");
const label = () => q(".field .lbl");
// The confirm bubble a Discard opens; its "Discard" button completes the action.
const confirmButton = () =>
  [...document.body.querySelectorAll(".confirm-popover .confirm")].find(
    (b) => b.textContent?.trim() === "Discard",
  ) as HTMLButtonElement | undefined;
const footerButtons = () => [
  ...document.body.querySelectorAll("[data-slot='dialog-footer'] button"),
];
const sendButton = () =>
  (footerButtons().find((b) => b.textContent?.includes("Send for revision")) ??
    null) as HTMLButtonElement | null;
const cancelButton = () =>
  (footerButtons().find((b) => b.textContent?.trim() === "Cancel") ??
    null) as HTMLButtonElement | null;

async function mount(props: ComponentProps<typeof RequestChangesDialog>) {
  const { flush } = render(RequestChangesDialog, props);
  await flushUntil(flush, mounted);
}

describe("RequestChangesDialog render", () => {
  test("shows the empty-state when nothing is pending", async () => {
    await mount(baseProps);
    expect(summary()?.classList.contains("empty")).toBe(true);
    // No phantom "0 comments" — the empty-state nudges the reviewer instead.
    expect(summary()?.textContent).not.toContain("0 comment");
    expect(summary()?.textContent?.toLowerCase()).toContain("no comments");
  });

  test("a general comment alone clears the empty-state even with no inline comments", async () => {
    await mount({ ...baseProps, generalComment: "please revise the approach" });
    expect(summary()?.classList.contains("empty")).toBe(false);
  });

  test("a non-blank inline comment clears the empty-state and counts", async () => {
    await mount({ ...baseProps, annotations: [ann("a1", "tighten this")] });
    expect(summary()?.classList.contains("empty")).toBe(false);
    expect(summary()?.textContent).toContain("1 comment");
  });

  test("counts a line-anchored annotation", async () => {
    await mount({
      ...baseProps,
      annotations: [lineAnn("l1", 2, 2, "tighten")],
      planText: ["a", "b", "c"].join("\n"),
    });
    expect(summary()?.textContent).toContain("1 comment");
  });

  test("counts mixed line + legacy annotations together", async () => {
    await mount({
      ...baseProps,
      annotations: [lineAnn("l1", 1, 1, "fix"), ann("a1", "also fix")],
      planText: ["a", "b"].join("\n"),
    });
    expect(summary()?.textContent).toContain("2 comments");
  });

  test("reports the distinct-line count only when comments share a line", async () => {
    await mount({
      ...baseProps,
      annotations: [lineAnn("l1", 2, 2, "first"), lineAnn("l2", 2, 2, "second")],
      planText: ["a", "b", "c"].join("\n"),
    });
    // Two comments collapse onto one line: surface both numbers.
    expect(summary()?.textContent).toContain("2 comments on 1 line");
  });

  test("omits the line count when every comment sits on its own line", async () => {
    await mount({
      ...baseProps,
      annotations: [lineAnn("l1", 1, 1, "a"), lineAnn("l2", 2, 2, "b")],
      planText: ["a", "b"].join("\n"),
    });
    // "2 comments on 2 lines" is redundant — collapse to just the comment count.
    const text = summary()?.textContent ?? "";
    expect(text).toContain("2 comments");
    expect(text).not.toContain("on 2 lines");
  });

  test("hides the preview and disables submit when there is nothing to send", async () => {
    await mount(baseProps);
    expect(q(".preview")).toBeNull();
    expect(sendButton()?.disabled).toBe(true);
  });

  test("shows the preview and enables submit once there is content", async () => {
    await mount({ ...baseProps, generalComment: "needs more detail" });
    expect(q(".preview")).not.toBeNull();
    expect(sendButton()?.disabled).toBe(false);
  });
});

describe("RequestChangesDialog callbacks", () => {
  test("typing the general comment bubbles up through onGeneralCommentInput", async () => {
    const value = capture<string>();
    await mount({ ...baseProps, onGeneralCommentInput: value.cb });
    const textarea = q("textarea") as HTMLTextAreaElement;
    textarea.value = "drafting";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    expect(value.last()).toBe("drafting");
  });

  test("Send for revision submits the trimmed general comment", async () => {
    const submitted = capture<string>();
    await mount({ ...baseProps, generalComment: " needs more detail ", onSubmit: submitted.cb });
    sendButton()?.click();
    expect(submitted.last()).toBe("needs more detail");
  });

  test("Cancel fires onCancel", async () => {
    let canceled = false;
    await mount({ ...baseProps, onCancel: () => (canceled = true) });
    cancelButton()?.click();
    expect(canceled).toBe(true);
  });

  test("Cmd/Ctrl+Enter submits", async () => {
    const submitted = capture<string>();
    await mount({ ...baseProps, generalComment: "send me", onSubmit: submitted.cb });
    // The chord rides the dialog body wrapper; a keydown from the textarea bubbles to it.
    const textarea = q("textarea") as HTMLTextAreaElement;
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
    expect(submitted.last()).toBe("send me");
  });
});

// Retained-but-unsent composer drafts ("scratches", EXC-634): surfaced for a
// conscious Save (graduate into the sent feedback, EXC-635) or Discard.
describe("RequestChangesDialog unsent scratches", () => {
  test("renders no scratch section or drafts-hint when there are no scratches", async () => {
    await mount(baseProps);
    expect(q(".scratches")).toBeNull();
    expect(q(".drafts-hint")).toBeNull();
  });

  test("lists one row per scratch with the text visible in the trigger snippet", async () => {
    await mount({
      ...baseProps,
      scratches: [scratch(3, 3, "half a thought"), scratch(5, 8, "another one")],
    });
    const rows = document.body.querySelectorAll(".scratch-row");
    expect(rows.length).toBe(2);
    // The one-line snippet rides the always-visible disclosure trigger, so the
    // reviewer can scan each unsent draft without expanding it.
    const text = q(".scratches")?.textContent ?? "";
    expect(text).toContain("half a thought");
    expect(text).toContain("another one");
  });

  test("Save/Discard live OUTSIDE the collapsible, so they show without expanding (EXC-746)", async () => {
    await mount({ ...baseProps, scratches: [scratch(5, 8, "graduate me")] });
    const row = q(".scratch-row") as HTMLElement;
    const disclosure = row.querySelector(".scratch-disclosure");
    const actions = row.querySelector(".scratch-actions");
    expect(disclosure).not.toBeNull();
    expect(actions).not.toBeNull();
    // The actions are a sibling of the disclosure, never nested in its collapsible
    // body — what keeps them reachable before any expand. (A unit can only check
    // the structure; the real-visibility guard is the e2e.)
    expect(disclosure?.contains(actions)).toBe(false);
    expect(actions?.querySelector(".save")).not.toBeNull();
    expect(actions?.querySelector(".discard")).not.toBeNull();
  });

  test("reads 'unsent', never 'Draft'", async () => {
    await mount({ ...baseProps, scratches: [scratch(3, 3, "half a thought")] });
    const text = q(".scratches")?.textContent ?? "";
    expect(text.toLowerCase()).toContain("unsent");
    expect(text).not.toContain("Draft");
  });

  test("labels each scratch with its line anchor", async () => {
    await mount({ ...baseProps, scratches: [scratch(3, 3, "one"), scratch(5, 8, "two")] });
    const text = q(".scratches")?.textContent ?? "";
    expect(text).toContain("Line 3");
    expect(text).toContain("Lines 5–8");
  });

  test("Save fires onSaveScratch with the scratch key", async () => {
    const saved = capture<string>();
    await mount({
      ...baseProps,
      scratches: [scratch(5, 8, "graduate me")],
      onSaveScratch: saved.cb,
    });
    (q(".scratch-row .save") as HTMLElement).click();
    expect(saved.last()).toBe("5:8");
  });

  test("Discard opens a confirm popover; only confirming fires onDiscardScratch (EXC-762)", async () => {
    const discarded = capture<string>();
    const { flush } = render(RequestChangesDialog, {
      ...baseProps,
      scratches: [scratch(3, 3, "drop me")],
      onDiscardScratch: discarded.cb,
    });
    await flushUntil(flush, mounted);
    // Clicking Discard opens a confirmation rather than dropping immediately.
    (q(".scratch-row .discard") as HTMLElement).click();
    await flushUntil(flush, () => confirmButton() !== undefined);
    expect(discarded.last()).toBeUndefined();
    // Confirming completes the drop with the scratch key.
    confirmButton()?.click();
    flush();
    expect(discarded.last()).toBe("3:3");
  });

  test("scratches do not count toward the committed tally or clear the empty-state", async () => {
    await mount({
      ...baseProps,
      scratches: [scratch(3, 3, "unsent"), scratch(5, 5, "also unsent")],
    });
    // The committed-comment summary still reads empty: an unsaved scratch is not a
    // comment that will be sent.
    expect(summary()?.classList.contains("empty")).toBe(true);
    // And nothing is sendable, so submit stays disabled and no preview shows.
    expect(sendButton()?.disabled).toBe(true);
    expect(q(".preview")).toBeNull();
  });

  test("surfaces a singular unsent-draft hint so the summary can't contradict the section chip", async () => {
    await mount({
      ...baseProps,
      generalComment: "please revise approach",
      scratches: [scratch(3, 3, "unsent")],
    });
    // The general comment makes the committed tally read "1 comment will be
    // included"; on its own that contradicts the "Unsent comments [1]" chip, so
    // the hint spells out that the draft won't go unless Saved (EXC-746).
    const hint = q(".drafts-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain("1 unsent draft");
  });

  test("pluralizes the unsent-draft hint", async () => {
    await mount({
      ...baseProps,
      scratches: [scratch(3, 3, "one"), scratch(5, 5, "two")],
    });
    const hint = q(".drafts-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain("2 unsent drafts");
  });
});

describe("general comment optional vs required (EXC-762)", () => {
  test("labels the field optional (and aria-required false) when inline comments will be sent", async () => {
    await mount({ ...baseProps, annotations: [lineAnn("a1", 3, 3, "tighten this")] });
    expect(label()?.textContent).toContain("(optional)");
    expect(content()?.querySelector("textarea")?.getAttribute("aria-required")).toBe("false");
  });

  test("drops the optional label and marks the field required when nothing else will be sent", async () => {
    await mount(baseProps);
    expect(label()?.textContent).not.toContain("(optional)");
    const ta = content()?.querySelector("textarea");
    expect(ta?.getAttribute("aria-required")).toBe("true");
    expect(ta?.hasAttribute("required")).toBe(true);
  });
});

describe("inline comments — Discard / Mark as draft (EXC-762)", () => {
  test("lists each committed inline comment with its anchor and text", async () => {
    await mount({ ...baseProps, annotations: [lineAnn("a1", 7, 8, "reconsider the cache")] });
    const section = q(".inline-comments");
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("Lines 7–8");
    expect(section?.textContent).toContain("reconsider the cache");
  });

  test("Mark as draft fires onDraftAnnotation with the line-anchored comment", async () => {
    const drafted = capture<Annotation>();
    await mount({
      ...baseProps,
      annotations: [lineAnn("a1", 7, 8, "reconsider")],
      onDraftAnnotation: drafted.cb,
    });
    (q(".inline-row .mark-draft") as HTMLElement).click();
    expect(drafted.last()?.id).toBe("a1");
  });

  test("a legacy (selection-anchored) comment offers Discard but no Mark as draft", async () => {
    await mount({ ...baseProps, annotations: [ann("l1", "old style")] });
    const row = q(".inline-row") as HTMLElement;
    expect(row.querySelector(".mark-draft")).toBeNull();
    expect(row.querySelector(".discard")).not.toBeNull();
  });

  test("Discard opens a confirm popover; only confirming fires onDiscardAnnotation", async () => {
    const discarded = capture<string>();
    const { flush } = render(RequestChangesDialog, {
      ...baseProps,
      annotations: [lineAnn("a1", 7, 8, "reconsider")],
      onDiscardAnnotation: discarded.cb,
    });
    await flushUntil(flush, mounted);
    (q(".inline-row .discard") as HTMLElement).click();
    await flushUntil(flush, () => confirmButton() !== undefined);
    expect(discarded.last()).toBeUndefined();
    confirmButton()?.click();
    flush();
    expect(discarded.last()).toBe("a1");
  });
});

describe("compiled feedback preview (EXC-762)", () => {
  test("relabels the preview disclosure and still shows it when there is feedback", async () => {
    await mount({ ...baseProps, generalComment: "please revise" });
    expect(q(".preview")).not.toBeNull();
    expect(q(".preview-trigger")?.textContent).toContain("Compiled feedback preview");
  });
});
