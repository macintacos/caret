import "@ui/support/mount.ts";

import { describe, expect, test } from "bun:test";

import type { ComponentProps } from "svelte";

import { flushUntil, render } from "@ui/support/mount.ts";
import UnsentCommentsDialog from "@/components/UnsentCommentsDialog.svelte";

const twoItems = [
  { label: "General", text: "reconsider the rollout" },
  { label: "Line 7", text: "explain the cold cost" },
];

const approveProps = {
  open: true,
  items: twoItems,
  action: "Approve",
  consequence: "Approving accepts the plan and starts the agent's work.",
  icon: "check" as const,
  onConfirm: () => {},
  onRequestChanges: () => {},
  onCancel: () => {},
};

const rejectProps = {
  open: true,
  items: twoItems,
  action: "Reject",
  consequence: "The agent will be told the plan was rejected and to wait.",
  onConfirm: () => {},
  onRequestChanges: () => {},
  onCancel: () => {},
};

// bits-ui AlertDialog portals its content to document.body on a deferred tick, so
// render/structure is asserted against the body after an effect+timer flush (the
// shadcn-foundation verdict). Interaction — Escape, the confirming keystroke (a bare
// Enter for reject, the focused notes editor's ⌘↵ for approve), the button callbacks,
// and the no-backdrop-dismiss behavior — is real-browser and lives in
// test/e2e/approve.e2e.ts + reject.e2e.ts.
const q = (sel: string) => document.body.querySelector(sel);
const content = () => q("[data-slot='alert-dialog-content']");
const mounted = () => content() !== null;
const description = () => q("[data-slot='alert-dialog-description']");
// The confirm action is the last button in the footer band (Cancel, [Request
// changes], Confirm) — a plain Button, since the Modal shell owns the alertdialog
// primitive, so it's located positionally rather than by an action-specific slot.
const confirm = () =>
  [...document.body.querySelectorAll("[data-slot='alert-dialog-footer'] button")].at(-1) ?? null;

const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(label));

async function mount(props: ComponentProps<typeof UnsentCommentsDialog>) {
  const { flush } = render(UnsentCommentsDialog, props);
  await flushUntil(flush, mounted);
}

describe("UnsentCommentsDialog render", () => {
  test("names the pending count, pluralized", async () => {
    await mount(approveProps);
    expect(description()?.textContent).toContain("2 pending comments");
  });

  test("singularizes the count for one pending comment", async () => {
    await mount({ ...approveProps, items: [{ label: "Line 3", text: "tighten" }] });
    expect(description()?.textContent).toContain("1 pending comment");
    expect(description()?.textContent).not.toContain("1 pending comments");
  });

  test("previews each pending comment's label and text", async () => {
    await mount(approveProps);
    const rows = document.body.querySelectorAll(".comments .comment");
    expect(rows.length).toBe(2);
    const preview = q(".comments")?.textContent ?? "";
    expect(preview).toContain("General");
    expect(preview).toContain("reconsider the rollout");
    expect(preview).toContain("Line 7");
    expect(preview).toContain("explain the cold cost");
  });

  test("the Approve variant sends its comments and reads with the approve vocabulary", async () => {
    await mount({ ...approveProps, comments: twoItems, items: [] });
    // The dialog's accessible name is its Title (bits-ui wires aria-labelledby to it).
    expect(q("[data-slot='alert-dialog-title']")?.textContent).toContain("Approve this plan?");
    expect(confirm()?.textContent).toContain("Approve with comments");
    expect(confirm()?.textContent).not.toContain("anyway");
    expect(button("Request changes")).toBeDefined();
    const sent = q("[aria-label='Comments sent with your approval']")?.textContent ?? "";
    expect(sent).toContain("reconsider the rollout");
    expect(sent).toContain("explain the cold cost");
    expect(description()?.textContent).toContain(
      "Approving accepts the plan and starts the agent's work.",
    );
    expect(description()?.textContent).toContain("Request changes");
  });

  test("an Approve with only scratches confirms plainly and lists them as not sent", async () => {
    await mount({ ...approveProps, comments: [], items: [{ label: "Line 3", text: "draft" }] });
    expect(confirm()?.textContent).toContain("Approve");
    expect(confirm()?.textContent).not.toContain("with comments");
    expect(confirm()?.textContent).not.toContain("anyway");
    const group = q("[aria-label='Unsaved drafts, not sent']");
    expect(group?.textContent).toContain("draft");
    expect(group?.querySelectorAll("button").length).toBe(0);
  });

  test("an Approve with comments and scratches shows both groups", async () => {
    await mount({
      ...approveProps,
      comments: twoItems,
      items: [{ label: "Line 3", text: "draft" }],
    });
    expect(confirm()?.textContent).toContain("Approve with comments");
    expect(q("[aria-label='Comments sent with your approval']") !== null).toBe(true);
    expect(q("[aria-label='Unsaved drafts, not sent']") !== null).toBe(true);
  });

  test("an Approve with nothing queued is a plain confirm with the notes field", async () => {
    await mount({ ...approveProps, comments: [], items: [], showNotes: true });
    expect(q(".comments") !== null).toBe(false);
    expect(button("Request changes")).toBeUndefined();
    expect(q(".cm-content") !== null).toBe(true);
  });

  test("a warning replaces the delivery sentence in the description", async () => {
    await mount({ ...approveProps, comments: twoItems, items: [], warning: "x-warning" });
    expect(description()?.textContent).toContain("x-warning");
    expect(description()?.textContent).not.toContain("without another planning round");
    expect(confirm()?.textContent).toContain("Approve with comments");
  });

  test("the Reject variant swaps in the reject vocabulary and accessible name", async () => {
    await mount(rejectProps);
    expect(q("[data-slot='alert-dialog-title']")?.textContent).toContain("Reject this plan?");
    expect(confirm()?.textContent).toContain("Reject anyway");
    expect(description()?.textContent).toContain(
      "The agent will be told the plan was rejected and to wait.",
    );
  });

  test("with no pending comments it is a plain confirm — no warning, no preview, no divert, no 'anyway'", async () => {
    await mount({ ...rejectProps, items: [] });
    expect(description()?.textContent).not.toContain("pending comment");
    expect(q(".comments")).toBeNull();
    const requestChanges = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Request changes"),
    );
    expect(requestChanges).toBeUndefined();
    expect(confirm()?.textContent).toContain("Reject");
    expect(confirm()?.textContent).not.toContain("anyway");
  });
});

// The optional reviewer note (EXC-791) uses the same live-markdown editor as the
// inline comment composer (EXC-803), so it parses markdown as the reviewer types.
describe("UnsentCommentsDialog notes field (EXC-803)", () => {
  test("hosts the live-markdown editor for the agent note when showNotes is set", async () => {
    await mount({ ...approveProps, showNotes: true });
    const editor = q(".cm-content");
    expect(editor).not.toBeNull();
    // Its accessible name is what the approve e2e (and a screen reader) locate it by.
    expect(editor?.getAttribute("aria-label")).toBe("Notes for the agent");
  });

  test("omits the notes field without showNotes (the reject variant)", async () => {
    await mount(approveProps);
    expect(q(".cm-content")).toBeNull();
    expect(q(".field")).toBeNull();
  });
});
