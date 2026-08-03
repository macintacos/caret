import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import { capture, flushUntil, render } from "@ui/test-mount.ts";
import PlanBreadcrumbs from "@/components/PlanBreadcrumbs.svelte";
import type { TocHeading } from "$lib/toc.ts";

// A three-level plan: "Details" sits under "Approach", which shares its level with
// "Verification". Reading line 9 therefore trails Overview > Approach > Details,
// and the Approach crumb's menu offers Approach and Verification.
const HEADINGS: TocHeading[] = [
  { level: 1, text: "Overview", line: 1 },
  { level: 2, text: "Approach", line: 5 },
  { level: 3, text: "Details", line: 9 },
  { level: 2, text: "Verification", line: 20 },
];

// Four nested levels, so the trail outgrows the three crumbs the bar shows.
const DEEP: TocHeading[] = [
  { level: 1, text: "One", line: 1 },
  { level: 2, text: "Two", line: 3 },
  { level: 3, text: "Three", line: 5 },
  { level: 4, text: "Four", line: 7 },
];

function crumbs(target: HTMLElement): HTMLElement[] {
  return [...target.querySelectorAll<HTMLElement>("button.crumb")];
}

/** The portalled menu rows, in order. bits-ui teleports menu content to
 * document.body after an effect + timer flush, so callers poll with flushUntil. */
function menuRows(): HTMLElement[] {
  return [
    ...document.body.querySelectorAll<HTMLElement>(
      "[data-slot='dropdown-menu-item'], [data-slot='dropdown-menu-sub-trigger']",
    ),
  ];
}

/** Open a crumb's menu and wait for its portalled rows. The flush BEFORE the click
 * is load-bearing: render() leaves the mount's effects pending, and a click landing
 * on that unsettled graph flips the trigger's aria-expanded while bits-ui's portal
 * presence misses the transition entirely, so no later flush ever mounts the
 * content (the same order SettingSelect.test.ts uses). */
async function openCrumb(target: HTMLElement, index: number, flush: () => void): Promise<void> {
  flush();
  crumbs(target)[index]?.click();
  await flushUntil(flush, () => menuRows().length > 0);
}

describe("PlanBreadcrumbs trail", () => {
  test("renders nothing when the plan has no headings", () => {
    const { target } = render(PlanBreadcrumbs, { headings: [], activeLine: 1, onJump: () => {} });
    expect(target.querySelector("nav")).toBeNull();
  });

  test("renders nothing before a heading is in the reading zone", () => {
    const { target } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: null,
      onJump: () => {},
    });
    expect(target.querySelector("nav")).toBeNull();
  });

  // No minimum-heading gate: unlike the ToC rail, one heading is still a location.
  test("renders a single crumb for a one-heading plan", () => {
    const { target } = render(PlanBreadcrumbs, {
      headings: [{ level: 1, text: "Only", line: 1 }],
      activeLine: 1,
      onJump: () => {},
    });
    expect(crumbs(target).map((c) => c.textContent?.trim())).toEqual(["Only"]);
  });

  test("renders the ancestor chain outermost first", () => {
    const { target } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    expect(crumbs(target).map((c) => c.textContent?.trim())).toEqual([
      "Overview",
      "Approach",
      "Details",
    ]);
    expect(target.querySelectorAll("[data-slot='breadcrumb-separator']").length).toBe(2);
  });

  // The scroll observer in DiffPlanView only ever hands this component a new
  // activeLine, so a different reading position must yield a different ancestry.
  test("trails the ancestry of whichever heading is being read", () => {
    const { target } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 20,
      onJump: () => {},
    });
    expect(crumbs(target).map((c) => c.textContent?.trim())).toEqual(["Overview", "Verification"]);
  });
});

describe("PlanBreadcrumbs landmark", () => {
  test("is a named nav landmark", () => {
    const { target } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    expect(target.querySelector("nav")?.getAttribute("aria-label")).toBe("Plan location");
  });

  test("marks the innermost crumb as the reader's location", () => {
    const { target } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    const shown = crumbs(target);
    expect(shown.at(-1)?.getAttribute("aria-current")).toBe("location");
    expect(shown[0]?.getAttribute("aria-current")).toBeNull();
  });
});

describe("PlanBreadcrumbs menus", () => {
  test("a crumb's menu lists that level's siblings", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openCrumb(target, 1, flush);
    expect(menuRows().map((r) => r.textContent?.trim())).toEqual(["Approach", "Verification"]);
  });

  // The trail's own heading opens the level below rather than jumping in place, so
  // one menu walks the whole hierarchy — the nesting EXC-947's j/k will step through.
  test("the crumb's own heading nests the level below it as a submenu", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openCrumb(target, 1, flush);
    const rows = menuRows();
    expect(rows[0]?.getAttribute("data-slot")).toBe("dropdown-menu-sub-trigger");
    expect(rows[1]?.getAttribute("data-slot")).toBe("dropdown-menu-item");
  });

  test("the innermost crumb's menu nests nothing", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openCrumb(target, 2, flush);
    expect(menuRows().map((r) => r.getAttribute("data-slot"))).toEqual(["dropdown-menu-item"]);
  });

  test("picking a sibling jumps to its source line", async () => {
    const jumped = capture<number>();
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: jumped.cb,
    });
    await openCrumb(target, 1, flush);
    menuRows()[1]?.click();
    flush();
    expect(jumped.last()).toBe(20);
  });
});

describe("PlanBreadcrumbs overflow", () => {
  test("collapses the middle of a trail deeper than three levels", () => {
    const { target } = render(PlanBreadcrumbs, { headings: DEEP, activeLine: 7, onJump: () => {} });
    expect(crumbs(target).map((c) => c.textContent?.trim())).toEqual(["One", "Three", "Four"]);
    expect(target.querySelectorAll("[data-slot='breadcrumb-ellipsis']").length).toBe(1);
  });

  test("shows a three-level trail whole", () => {
    const { target } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    expect(target.querySelector("[data-slot='breadcrumb-ellipsis']")).toBeNull();
  });
});
