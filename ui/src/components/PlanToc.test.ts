import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import { capture, flushUntil, render } from "@ui/test-mount.ts";
import PlanToc from "@/components/PlanToc.svelte";
import type { TocHeading } from "$lib/toc.ts";

// The same three-level shape PlanBreadcrumbs.test.ts uses, so the two heading
// surfaces are read against one fixture: "Details" sits under "Approach", which
// shares its level with "Verification".
const HEADINGS: TocHeading[] = [
  { level: 1, text: "Overview", line: 1 },
  { level: 2, text: "Approach", line: 5 },
  { level: 3, text: "Details", line: 9 },
  { level: 2, text: "Verification", line: 20 },
];

function trigger(target: HTMLElement): HTMLButtonElement | null {
  return target.querySelector<HTMLButtonElement>("[data-slot='popover-trigger']");
}

/** The portalled panel. bits-ui teleports popover content to document.body. */
function panel(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>("[data-slot='popover-content']");
}

function listbox(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>("[data-slot='command-list']");
}

/** Every row the listbox holds, in document order — the selectable headings
 * (role=option) and the dimmed ancestors kept only for context
 * (role=presentation). */
function rows(): HTMLElement[] {
  return [
    ...(listbox()?.querySelectorAll<HTMLElement>("[role='option'],[role='presentation']") ?? []),
  ];
}

function options(): HTMLElement[] {
  return [...(listbox()?.querySelectorAll<HTMLElement>("[role='option']") ?? [])];
}

function field(): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>("[data-slot='command-input']");
}

function label(row: HTMLElement): string {
  return row.textContent?.trim() ?? "";
}

/** Open the popup and wait for its portalled content. The flush BEFORE the click
 * is load-bearing: render() leaves the mount's effects pending, and a click landing
 * on that unsettled graph flips the trigger's aria-expanded while bits-ui's portal
 * presence misses the transition entirely (the order PlanBreadcrumbs.test.ts uses). */
async function open(target: HTMLElement, flush: () => void): Promise<void> {
  flush();
  trigger(target)?.click();
  await flushUntil(flush, () => listbox() !== null);
}

/** Type into the filter field the way a reviewer would, so the bound query — and
 * with it the filtered tree — updates. */
async function typeQuery(value: string, flush: () => void): Promise<void> {
  const el = field();
  if (el === null) throw new Error("filter field not mounted");
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await flushUntil(flush, () => options().length > 0);
}

describe("PlanToc surface", () => {
  test("renders a trigger and nothing else until it is opened", () => {
    const { target } = render(PlanToc, { headings: HEADINGS, activeLine: 9, onJump: () => {} });
    expect(trigger(target)?.textContent?.trim()).toBe("Contents");
    expect(panel()).toBeNull();
  });

  // A popover anchored to its trigger, not a centered overlay: bits-ui's popover
  // content is what carries the anchoring, so its slot is the contract.
  test("opens a popover holding a labelled listbox", async () => {
    const { target, flush } = render(PlanToc, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await open(target, flush);
    expect(panel()).not.toBeNull();
    expect(listbox()?.getAttribute("aria-label")).toBe("Plan headings");
    expect(panel()?.querySelector("[data-slot='command-input']")).not.toBeNull();
  });

  test("renders every heading in document order, indented by level", async () => {
    const { target, flush } = render(PlanToc, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await open(target, flush);
    expect(rows().map(label)).toEqual(["Overview", "Approach", "Details", "Verification"]);
    expect(rows().map((r) => r.style.getPropertyValue("--toc-depth"))).toEqual([
      "0",
      "1",
      "2",
      "1",
    ]);
    // Every heading is a destination while nothing is filtered.
    expect(options().length).toBe(4);
  });

  // Driven by the activeLine prop — the same value the breadcrumbs bar receives —
  // rather than by any scroll tracking of its own.
  test("marks the heading being read, and only that one", async () => {
    const { target, flush } = render(PlanToc, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await open(target, flush);
    const marked = rows().filter((r) => r.getAttribute("aria-current") === "location");
    expect(marked.map(label)).toEqual(["Details"]);
  });

  test("keeps a filtered match at its own depth under a dimmed ancestor", async () => {
    const { target, flush } = render(PlanToc, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await open(target, flush);
    await typeQuery("details", flush);
    expect(rows().map(label)).toEqual(["Overview", "Approach", "Details"]);
    expect(rows().map((r) => r.style.getPropertyValue("--toc-depth"))).toEqual(["0", "1", "2"]);
    expect(options().map(label)).toEqual(["Details"]);
  });

  // The ancestors are there to place the match, not to be picked: assistive tech
  // sees presentation, and neither row is one of the command's items.
  test("exposes unmatched ancestors as presentational, not as options", async () => {
    const { target, flush } = render(PlanToc, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await open(target, flush);
    await typeQuery("details", flush);
    const context = rows().filter((r) => r.getAttribute("role") === "presentation");
    expect(context.map(label)).toEqual(["Overview", "Approach"]);
    for (const row of context) {
      expect(row.getAttribute("data-slot")).not.toBe("command-item");
      expect(row.hasAttribute("data-value")).toBe(false);
    }
  });

  test("shows helper text when the plan has no headings", async () => {
    const { target, flush } = render(PlanToc, { headings: [], activeLine: null, onJump: () => {} });
    await open(target, flush);
    expect(options().length).toBe(0);
    expect(listbox()?.textContent?.trim()).toBe("No headings in plan");
  });

  test("reports the picked heading's source line", async () => {
    const jump = capture<number>();
    const { target, flush } = render(PlanToc, {
      headings: HEADINGS,
      activeLine: 1,
      onJump: jump.cb,
    });
    await open(target, flush);
    options()[3]?.click();
    flush();
    expect(jump.last()).toBe(20);
  });
});
