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

// Two branches off one parent: "Details" under "Approach" is where the reader
// is, "Steps" under "Verification" is the branch they are not in — the headings
// the bar could not reach before EXC-957.
const BRANCHED: TocHeading[] = [
  { level: 1, text: "Overview", line: 1 },
  { level: 2, text: "Approach", line: 5 },
  { level: 3, text: "Details", line: 9 },
  { level: 2, text: "Verification", line: 20 },
  { level: 3, text: "Steps", line: 24 },
];

// Four nested levels, deeper than the bar used to show before it started
// measuring the room it has.
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

  // No minimum-heading gate: one heading is still a location.
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
    // The elision marker and its own separator ride along elided, so only the
    // chevrons actually punctuating the trail are counted.
    expect(target.querySelectorAll("[data-slot='breadcrumb-separator']:not(.elided)").length).toBe(
      2,
    );
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

  // The `current` class is what the shrink weighting keys off, on an element that
  // also takes a {...props} spread — so a regression here would be silent.
  test("flags the innermost crumb and its item for the shrink weighting", () => {
    const { target } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    expect(crumbs(target).at(-1)?.classList.contains("current")).toBe(true);
    expect(crumbs(target)[0]?.classList.contains("current")).toBe(false);
    const items = [...target.querySelectorAll(".crumb-item")];
    expect(items.at(-1)?.classList.contains("current")).toBe(true);
    expect(items[0]?.classList.contains("current")).toBe(false);
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

  // Opening "where am I" has to show which row is "here" — at every depth, including
  // the innermost menu, where the current heading is an ordinary row.
  test("marks the heading the reader is already on in every menu", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openCrumb(target, 1, flush);
    expect(menuRows().map((r) => r.getAttribute("aria-current"))).toEqual(["location", null]);
    document.body.querySelector<HTMLElement>("[data-slot='dropdown-menu-content']")?.remove();
    await openCrumb(target, 2, flush);
    expect(menuRows()[0]?.getAttribute("aria-current")).toBe("location");
  });

  // A heading that encloses others opens them rather than only jumping, so one
  // menu walks the whole hierarchy — the nesting EXC-947's j/k steps through.
  test("a heading with headings under it opens as a submenu", async () => {
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

  // EXC-957: the menus recurse the heading tree, not the reader's trail. A
  // sibling they are NOT on is the case the old `here &&` limiter excluded, and
  // the reason most of a plan was unreachable from the bar.
  test("nests a sibling's own headings even when the reader is not in that branch", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: BRANCHED,
      activeLine: 9,
      onJump: () => {},
    });
    await openCrumb(target, 1, flush);
    expect(menuRows().map((r) => r.textContent?.trim())).toEqual(["Approach", "Verification"]);
    // Verification encloses Steps, so it opens rather than only jumping.
    expect(menuRows().map((r) => r.getAttribute("data-slot"))).toEqual([
      "dropdown-menu-sub-trigger",
      "dropdown-menu-sub-trigger",
    ]);
  });

  test("marks only the headings on the reader's own trail", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: BRANCHED,
      activeLine: 9,
      onJump: () => {},
    });
    await openCrumb(target, 1, flush);
    expect(menuRows().map((r) => r.getAttribute("aria-current"))).toEqual(["location", null]);
  });

  // A row that opens a submenu is still a destination. bits-ui flattens its own
  // submenu-open keys into a synthetic click (detail 0), so only a real press
  // navigates — which is what this dispatches.
  test("clicking a heading that has children jumps to it rather than opening it", async () => {
    const jumped = capture<number>();
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: BRANCHED,
      activeLine: 9,
      onJump: jumped.cb,
    });
    await openCrumb(target, 1, flush);
    menuRows()[1]?.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true }));
    flush();
    expect(jumped.last()).toBe(20);
  });

  test("leaves the plan alone when bits-ui opens the submenu through a synthetic click", async () => {
    const jumped = capture<number>();
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: BRANCHED,
      activeLine: 9,
      onJump: jumped.cb,
    });
    await openCrumb(target, 1, flush);
    menuRows()[1]?.click(); // detail 0 — what ArrowRight and Space produce
    flush();
    expect(jumped.last()).toBeUndefined();
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

// EXC-947: the bar's keyboard surface. Only the wiring a mounted component can show
// lives here — the exposed open handle, the advertised key, the hint cap. The j/k
// walk itself is real focus movement, so it stays e2e (browser-testing.md).
describe("PlanBreadcrumbs keyboard invocation", () => {
  test("hands the parent an open handle that opens the trailing crumb's menu", async () => {
    const exposed = capture<() => void>();
    const { flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
      onExposeOpen: exposed.cb,
    });
    flush();
    const open = exposed.last();
    expect(typeof open).toBe("function");

    open?.();
    await flushUntil(flush, () => menuRows().length > 0);
    // The INNERMOST crumb — the level being read — not the outermost. Details is
    // the only level-3 heading under Approach, so a one-row menu identifies it.
    expect(menuRows().map((r) => r.textContent?.trim())).toEqual(["Details"]);
  });

  test("advertises b on the crumb the key opens, and only there", () => {
    const { target } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    const shown = crumbs(target);
    expect(shown.at(-1)?.getAttribute("aria-keyshortcuts")).toBe("b");
    expect(shown[0]?.getAttribute("aria-keyshortcuts")).toBeNull();
  });

  test("teaches b with a keycap only while shortcut hints are shown", () => {
    const hint = (el: HTMLElement) => el.querySelector("[data-slot='kbd']");
    const { target: on } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
      showShortcutHints: true,
    });
    expect(hint(on)?.textContent?.trim()).toBe("b");
    const { target: off } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
      showShortcutHints: false,
    });
    expect(hint(off)).toBeNull();
  });
});

// EXC-948: `/` swaps the open menu for a flat filter over every heading in the
// plan. Only what a mounted component shows lives here — the swap, the rows and
// their parents, the narrowing, the empty state, the jump. The keyboard walk
// through the results and Escape's return to the hierarchy are real focus
// movement, so they stay e2e (browser-testing.md).
describe("PlanBreadcrumbs filter", () => {
  /** The open menu's own content element — where the bar claims `/`. */
  function menuContent(): HTMLElement | null {
    return document.body.querySelector("[data-slot='dropdown-menu-content']");
  }

  /** Press a bare key on the open menu, as a reviewer walking it would. Cancelable
   * so the handler's preventDefault is real rather than a silent no-op. */
  function pressInMenu(key: string): void {
    menuContent()?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  }

  function queryField(): HTMLInputElement | null {
    return document.body.querySelector("input[aria-label='Filter headings']");
  }

  function typeQuery(text: string, flush: () => void): void {
    const field = queryField();
    if (!field) throw new Error("no query field");
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
  }

  /** Open the trailing crumb's menu, then swap it for the filter. */
  async function openFilter(target: HTMLElement, flush: () => void): Promise<void> {
    await openCrumb(target, 2, flush);
    pressInMenu("/");
    await flushUntil(flush, () => queryField() !== null);
  }

  test("replaces the open menu's siblings with a field over every heading", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    // The innermost crumb's menu offers one row — its own level. The filter that
    // replaces it spans all four headings, across every level.
    await openCrumb(target, 2, flush);
    expect(menuRows().length).toBe(1);

    pressInMenu("/");
    await flushUntil(flush, () => queryField() !== null);
    expect(menuRows().map((r) => r.querySelector(".crumb-label")?.textContent?.trim())).toEqual([
      "Overview",
      "Approach",
      "Details",
      "Verification",
    ]);
  });

  test("claims the slash so the plan's own search never sees it", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openCrumb(target, 2, flush);
    const slash = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    menuContent()?.dispatchEvent(slash);
    // dispatcher.ts returns early on defaultPrevented, which is the whole
    // mechanism keeping actions.search shut while the bar owns the key.
    expect(slash.defaultPrevented).toBe(true);
  });

  test("names each result's enclosing heading", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    expect(menuRows().map((r) => r.querySelector(".crumb-parent")?.textContent?.trim())).toEqual([
      undefined, // "Overview" is top-level, so it has no parent to name
      "Overview",
      "Approach",
      "Overview",
    ]);
  });

  test("narrows the results as the query is typed", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    typeQuery("ver", flush);
    expect(menuRows().map((r) => r.querySelector(".crumb-label")?.textContent?.trim())).toEqual([
      "Overview",
      "Verification",
    ]);
  });

  test("shows an empty state rather than a blank panel when nothing matches", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    typeQuery("zzz", flush);
    expect(menuRows().length).toBe(0);
    expect(document.body.querySelector(".crumb-filter-empty")?.textContent?.trim()).toBe(
      "No headings match",
    );
  });

  test("jumps to a result's source line when it is picked", async () => {
    const jumped = capture<number>();
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: jumped.cb,
    });
    await openFilter(target, flush);
    typeQuery("verification", flush);
    menuRows()[0]?.click();
    flush();
    expect(jumped.last()).toBe(20);
  });

  test("marks the heading the reader is on among the results", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    expect(menuRows().map((r) => r.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "location",
      null,
    ]);
  });

  test("teaches the slash in the menu only while shortcut hints are shown", async () => {
    const hint = () => document.body.querySelector(".crumb-menu-hint");
    const on = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
      showShortcutHints: true,
    });
    await openCrumb(on.target, 2, on.flush);
    expect(hint()?.textContent).toContain("/");

    const off = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
      showShortcutHints: false,
    });
    await openCrumb(off.target, 2, off.flush);
    expect(hint()).toBeNull();
  });
});

// EXC-957: the trail elides on the room the row measures, not on how deep it
// happens to be. happy-dom reports no layout, so every crumb measures zero and
// the whole trail fits — which is what a wide row does too. The arithmetic over
// real widths is unit-tested in lib/headingTrail.test.ts and the collapse itself
// is e2e; what a mounted component can show is that no depth count elides
// anything, and that the marker is a real control sitting in the trail.
describe("PlanBreadcrumbs overflow", () => {
  test("shows every level of a deep trail when the row has room for it", () => {
    const { target } = render(PlanBreadcrumbs, { headings: DEEP, activeLine: 7, onJump: () => {} });
    expect(crumbs(target).map((c) => c.textContent?.trim())).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
    ]);
  });

  // The levels the row cannot hold stay in the DOM rather than being dropped
  // from it: that is what keeps the full trail measurable while a collapsed one
  // is on screen.
  test("keeps the elision marker in the trail, elided, when nothing is hidden", () => {
    const { target } = render(PlanBreadcrumbs, { headings: DEEP, activeLine: 7, onJump: () => {} });
    const marker = target.querySelector(".crumb-ellipsis");
    expect(marker).not.toBeNull();
    expect(marker?.closest(".crumb-marker")?.classList.contains("elided")).toBe(true);
  });

  test("makes the elision marker a control rather than inert punctuation", () => {
    const { target } = render(PlanBreadcrumbs, { headings: DEEP, activeLine: 7, onJump: () => {} });
    const marker = target.querySelector(".crumb-ellipsis");
    expect(marker?.tagName).toBe("BUTTON");
    expect(marker?.getAttribute("aria-hidden")).toBeNull();
    expect(marker?.getAttribute("role")).not.toBe("presentation");
    expect(marker?.getAttribute("aria-label")).toContain("Hidden levels");
  });

  // Whatever the row can hold, the outermost crumb's menu nests every level
  // below it, so no collapse can put a heading out of reach.
  test("keeps every level below the outermost crumb reachable from its menu", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: DEEP,
      activeLine: 7,
      onJump: () => {},
    });
    await openCrumb(target, 0, flush);
    expect(menuRows().map((r) => r.getAttribute("data-slot"))).toEqual([
      "dropdown-menu-sub-trigger",
    ]);
    expect(menuRows()[0]?.textContent?.trim()).toBe("One");
  });
});
