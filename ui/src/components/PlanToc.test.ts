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
 * (role=option) and the dimmed ancestors kept only for context. Matched on the
 * context row's own class rather than on `aria-hidden`, which Icon.svelte also
 * stamps on every decorative glyph inside a row. */
function rows(): HTMLElement[] {
  return [...(listbox()?.querySelectorAll<HTMLElement>("[role='option'],.toc-context") ?? [])];
}

function options(): HTMLElement[] {
  return [...(listbox()?.querySelectorAll<HTMLElement>("[role='option']") ?? [])];
}

function contextRows(): HTMLElement[] {
  return [...(listbox()?.querySelectorAll<HTMLElement>(".toc-context") ?? [])];
}

/** The helper text, which is a sibling of the listbox rather than a row in it. */
function helper(): HTMLElement | null {
  return panel()?.querySelector<HTMLElement>(".toc-empty") ?? null;
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

/** Dismiss the popup before the test ends. Load-bearing rather than tidy: bits-ui's
 * portal presence waits for an `animationend` that never fires under happy-dom, so
 * content left open at unmount keeps its effects alive into the NEXT test file,
 * where they read deriveds whose owner is already destroyed and svelte warns
 * `derived_inert` — the effect half of the same leak ui/test-mount.ts purges the DOM
 * half of. Guarded, so it is a no-op in the test whose pick already closed it. */
async function close(target: HTMLElement, flush: () => void): Promise<void> {
  if (listbox() === null) return;
  trigger(target)?.click();
  await flushUntil(flush, () => listbox() === null);
}

/** Type into the filter field the way a reviewer would, so the bound query — and
 * with it the filtered tree — updates. `done` says what settling looks like for
 * this query: a query that matches nothing never grows the option set, so polling
 * on that alone would burn every try and return silently green. */
async function typeQuery(
  value: string,
  flush: () => void,
  done: () => boolean = () => options().length > 0,
): Promise<void> {
  const el = field();
  if (el === null) throw new Error("filter field not mounted");
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await flushUntil(flush, done);
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
    expect(listbox()?.getAttribute("role")).toBe("listbox");
    expect(listbox()?.getAttribute("aria-label")).toBe("Plan headings");
    // The field is named here rather than by the command's own label element,
    // which the vendored primitive leaves empty — so the name is worth pinning.
    expect(field()?.getAttribute("aria-label")).toBe("Filter headings");
    await close(target, flush);
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
    await close(target, flush);
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
    await close(target, flush);
  });

  // Opening scrolled to the current heading rests on seeding the command's value,
  // and the scroll itself is real-browser. The SELECTION that triggers it is not —
  // it is an attribute, and it is the half a bits-ui bump could silently break
  // while leaving every other assertion here green.
  test("opens with the heading being read pre-selected", async () => {
    const { target, flush } = render(PlanToc, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await open(target, flush);
    await flushUntil(flush, () => options().some((o) => o.hasAttribute("data-selected")));
    const chosen = options().filter((o) => o.getAttribute("aria-selected") === "true");
    expect(chosen.map(label)).toEqual(["Details"]);
    await close(target, flush);
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
    await close(target, flush);
  });

  // The ancestors are there to place the match, not to be picked: they are not
  // among the command's items, and they are out of the accessibility tree
  // entirely, so the listbox owns nothing but options.
  test("exposes unmatched ancestors as inert context, not as options", async () => {
    const { target, flush } = render(PlanToc, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await open(target, flush);
    await typeQuery("details", flush);
    expect(contextRows().map(label)).toEqual(["Overview", "Approach"]);
    for (const row of contextRows()) {
      expect(row.getAttribute("aria-hidden")).toBe("true");
      expect(row.getAttribute("data-slot")).not.toBe("command-item");
      expect(row.hasAttribute("data-value")).toBe(false);
    }
    await close(target, flush);
  });

  test("shows helper text when the plan has no headings", async () => {
    const { target, flush } = render(PlanToc, { headings: [], activeLine: null, onJump: () => {} });
    await open(target, flush);
    expect(options().length).toBe(0);
    expect(helper()?.textContent?.trim()).toBe("No headings in plan");
    // A status message about the list, not a row in it.
    expect(listbox()?.contains(helper())).toBe(false);
    await close(target, flush);
  });

  // A query that hits nothing is a different message from a plan that has no
  // headings, and only the second is a property of the plan.
  test("shows helper text when a query matches nothing", async () => {
    const { target, flush } = render(PlanToc, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await open(target, flush);
    await typeQuery("nothing matches this", flush, () => options().length === 0);
    expect(rows().length).toBe(0);
    expect(helper()?.textContent?.trim()).toBe("No headings match");
    // Narrowing to nothing is the one case aria-activedescendant cannot narrate —
    // there is no active option left to name — so the message says it out loud.
    expect(helper()?.getAttribute("role")).toBe("status");
    await close(target, flush);
  });

  // EXC-1096's narration contract: the field names the row the roving walk is on, so
  // the reviewer hears the list narrow without focus ever leaving the field. This is
  // the whole reason the epic vendored `command` over reusing the breadcrumbs bar's
  // dropdown, and it rests on the Viewport that command-list.svelte renders — see
  // ui/src/lib/shadcn-command-popover.test.ts for the primitive-level pin.
  test("the filter field narrates the row the selection is on", async () => {
    const { target, flush } = render(PlanToc, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await open(target, flush);
    await flushUntil(flush, () => field()?.getAttribute("aria-activedescendant") != null);

    expect(field()?.getAttribute("role")).toBe("combobox");
    // Controls the list it narrows, and names the row inside it.
    const controls = document.getElementById(field()?.getAttribute("aria-controls") ?? "");
    expect(listbox()?.contains(controls)).toBe(true);

    const active = document.getElementById(field()?.getAttribute("aria-activedescendant") ?? "");
    expect(active?.getAttribute("role")).toBe("option");
    expect(active?.textContent?.trim()).toBe("Details");
    await close(target, flush);
  });

  // A pick hands the reviewer to the plan, so it reports the line AND leaves.
  test("reports the picked heading's source line and dismisses", async () => {
    const jump = capture<number>();
    const { target, flush } = render(PlanToc, {
      headings: HEADINGS,
      activeLine: 1,
      onJump: jump.cb,
    });
    await open(target, flush);
    options()[3]?.click();
    await flushUntil(flush, () => listbox() === null);
    expect(jump.last()).toBe(20);
    expect(listbox()).toBeNull();
  });
});
