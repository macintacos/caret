import "../../test-mount.ts";

import { describe, expect, test } from "bun:test";
import type { ComponentProps } from "svelte";
import { flushUntil, render } from "../../test-mount.ts";
import UnsentCommentsDialog from "./UnsentCommentsDialog.svelte";

const twoItems = [
  { label: "General", text: "reconsider the rollout" },
  { label: "Line 7", text: "explain the cold cost" },
];

const approveProps = {
  items: twoItems,
  action: "Approve",
  consequence: "Approving accepts the plan and starts the agent's work.",
  icon: "check" as const,
  onConfirm: () => {},
  onRequestChanges: () => {},
  onCancel: () => {},
};

const rejectProps = {
  items: twoItems,
  action: "Reject",
  consequence: "The agent will be told the plan was rejected and to wait.",
  onConfirm: () => {},
  onRequestChanges: () => {},
  onCancel: () => {},
};

// bits-ui AlertDialog portals its content to document.body on a deferred tick, so
// render/structure is asserted against the body after an effect+timer flush (the
// shadcn-foundation verdict). Interaction — Escape/Enter-to-confirm, the button
// callbacks, and the no-backdrop-dismiss behavior — is real-browser and lives in
// test/e2e/approve.e2e.ts + reject.e2e.ts.
const q = (sel: string) => document.body.querySelector(sel);
const content = () => q("[data-slot='alert-dialog-content']");
const mounted = () => content() !== null;
const description = () => q("[data-slot='alert-dialog-description']");
const confirm = () => q("[data-slot='alert-dialog-action']");

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

  test("the Approve variant reads with the approve vocabulary and accessible name", async () => {
    await mount(approveProps);
    expect(content()?.getAttribute("aria-label")).toBe("Approve with pending comments");
    expect(q("[data-slot='alert-dialog-title']")?.textContent).toContain("Approve this plan?");
    expect(confirm()?.textContent).toContain("Approve anyway");
    expect(description()?.textContent).toContain(
      "Approving accepts the plan and starts the agent's work.",
    );
  });

  test("the Reject variant swaps in the reject vocabulary and accessible name", async () => {
    await mount(rejectProps);
    expect(content()?.getAttribute("aria-label")).toBe("Reject with pending comments");
    expect(q("[data-slot='alert-dialog-title']")?.textContent).toContain("Reject this plan?");
    expect(confirm()?.textContent).toContain("Reject anyway");
    expect(description()?.textContent).toContain(
      "The agent will be told the plan was rejected and to wait.",
    );
  });

  test("with no pending comments it is a plain confirm — no warning, no preview, no divert, no 'anyway'", async () => {
    await mount({ ...rejectProps, items: [] });
    // A bare confirmation: distinct accessible name, no comments warning, no preview
    // list, no Request-changes divert, and the confirm button drops the "anyway".
    expect(content()?.getAttribute("aria-label")).toBe("Reject this plan");
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
