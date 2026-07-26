import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { isTopmostDialog, topmostDialogContent } from "$lib/modalStack.ts";

// Build a detached subtree of stacked dialog contents. bits-ui appends each
// portalled dialog to the body in mount order, so the LAST `[data-slot=
// 'dialog-content']` in document order is the modal stacked highest — the one a
// modal-local `/` handler should claim. Pass the container as the `root` so the
// tests stay hermetic (no document.body cleanup).
function stack(count: number): HTMLElement {
  const root = document.createElement("div");
  for (let i = 0; i < count; i++) root.appendChild(dialog(String(i), "open"));
  return root;
}

// One portalled dialog content, tagged with the `data-state` bits-ui writes.
// A "closed" one is a surface playing its exit — still in the DOM (EXC-891),
// but no longer a candidate for the topmost slot.
function dialog(n: string, state: "open" | "closed"): HTMLElement {
  const content = document.createElement("div");
  content.setAttribute("data-slot", "dialog-content");
  content.setAttribute("data-state", state);
  content.dataset.n = n;
  const input = document.createElement("input");
  input.dataset.role = "search";
  content.appendChild(input);
  return content;
}

describe("topmostDialogContent", () => {
  test("returns null when no dialog content is present", () => {
    expect(topmostDialogContent(stack(0))).toBeNull();
  });

  test("returns the sole dialog content when one is open", () => {
    const root = stack(1);
    expect(topmostDialogContent(root)?.dataset.n).toBe("0");
  });

  test("returns the LAST dialog content when several are stacked", () => {
    const root = stack(3);
    expect(topmostDialogContent(root)?.dataset.n).toBe("2");
  });

  // With presence (EXC-891) an exiting dialog outlives its flag, so the last node
  // in document order can be one on its way out — during the guard's divert to
  // Request Changes, both coexist. The key must route to the surface that stays.
  test("skips a dialog that is playing its exit", () => {
    const root = stack(1);
    root.appendChild(dialog("exiting", "closed"));
    expect(topmostDialogContent(root)?.dataset.n).toBe("0");
  });

  test("returns null when the only dialog is playing its exit", () => {
    const root = document.createElement("div");
    root.appendChild(dialog("exiting", "closed"));
    expect(topmostDialogContent(root)).toBeNull();
  });
});

describe("isTopmostDialog", () => {
  test("true for an element inside the topmost (last) dialog", () => {
    const root = stack(2);
    const topInput = root.querySelectorAll("[data-slot='dialog-content'] input")[1] ?? null;
    expect(isTopmostDialog(topInput, root)).toBe(true);
  });

  test("false for an element inside a lower (earlier) dialog", () => {
    const root = stack(2);
    const lowerInput = root.querySelectorAll("[data-slot='dialog-content'] input")[0] ?? null;
    expect(isTopmostDialog(lowerInput, root)).toBe(false);
  });

  test("false for null", () => {
    expect(isTopmostDialog(null, stack(1))).toBe(false);
  });

  test("false for an element outside any dialog content", () => {
    const root = stack(1);
    const stray = document.createElement("input");
    root.appendChild(stray);
    expect(isTopmostDialog(stray, root)).toBe(false);
  });
});
