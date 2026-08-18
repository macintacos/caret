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

  // EXC-1122: a held key is walked by the app's own repeat timer alone. The OS keeps
  // emitting keydowns while the key is down and preventDefault does not stop them, so
  // a handler acting on every one would drive the list twice over, at two rates. The
  // bail has to read the REAL press — the arrow the walk re-dispatches never carries
  // `repeat`, so by then the tell is gone.
  test("an OS repeat of a walk key re-dispatches no second arrow", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openCrumb(target, 1, flush);

    // The walk's own arrow, counted where it lands: it is dispatched at whatever
    // holds focus and bubbles, so the document sees every one.
    const keys: string[] = [];
    const spy = (e: Event) => keys.push((e as KeyboardEvent).key);
    document.addEventListener("keydown", spy);
    const pressJ = (repeat: boolean) =>
      document.body
        .querySelector("[data-slot='dropdown-menu-content']")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "j", repeat, bubbles: true, cancelable: true }),
        );

    pressJ(false);
    flush();
    pressJ(true);
    flush();
    document.removeEventListener("keydown", spy);

    // Two presses of j in; one ArrowDown out.
    expect(keys.filter((k) => k === "j")).toHaveLength(2);
    expect(keys.filter((k) => k === "ArrowDown")).toEqual(["ArrowDown"]);
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

// The bar's flat `/` filter (EXC-948, EXC-1098): a `command` inside a `popover`,
// so the field is a real combobox over a listbox of options. Only what a mounted
// component shows lives here — the swap, the rows and their parents, the
// narrowing, the empty state, the jump, and the narration attributes. The arrow
// walk and Escape's return to the hierarchy are real focus movement, so they stay
// e2e (browser-testing.md).
//
// The Tab walk is the one thing split across both layers, deliberately, and the same
// split PlanToc.test.ts already draws. Where the walk LANDS is a roving selection —
// DOM state a mount can read — so it is pinned here. What only a browser can show is
// in test/e2e/plan-breadcrumbs.e2e.ts: a real keypress reaching the primitive, and
// the newly selected row being scrolled into the list's box.
//
// This file emits `svelte derived_inert` warnings — a few hundred on a scoped run,
// two in the full unit suite. They are the harness, not the component: bits-ui's
// portal presence waits on an `animationend` happy-dom never fires, so a panel left
// open at unmount keeps its document listeners alive, and this panel's own dismiss
// layer is what then reads those dead effects. Dismissing here (below) is measurably
// better than not, and no amount of per-file settling closes the gap — the fix is
// portal-effect teardown in ui/test-mount.ts, shared by every suite that mounts an
// overlay, rather than a third per-file workaround.
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

  /** The filter's own portalled panel, matched on the bar's class rather than on
   * `popover-content` — which would also collect any other popover a future test
   * in this file opens. */
  function panel(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(".plan-crumb-filter");
  }

  function listbox(): HTMLElement | null {
    return panel()?.querySelector<HTMLElement>("[data-slot='command-list']") ?? null;
  }

  /** The result rows: real options now, not menu items. */
  function options(): HTMLElement[] {
    return [...(listbox()?.querySelectorAll<HTMLElement>("[role='option']") ?? [])];
  }

  function labels(): (string | undefined)[] {
    return options().map((r) => r.querySelector(".crumb-label")?.textContent?.trim());
  }

  function queryField(): HTMLInputElement | null {
    return panel()?.querySelector<HTMLInputElement>("[data-slot='command-input']") ?? null;
  }

  /** The status line, a sibling of the listbox rather than a row in it. */
  function emptyLine(): HTMLElement | null {
    return panel()?.querySelector<HTMLElement>(".crumb-filter-empty") ?? null;
  }

  /** The rows the roving selection is on. `aria-selected` rather than `data-selected`
   * because it is the half a screen reader reads; the two move together. */
  function selectedLabels(): (string | undefined)[] {
    return options()
      .filter((r) => r.getAttribute("aria-selected") === "true")
      .map((r) => r.querySelector(".crumb-label")?.textContent?.trim());
  }

  /** Press Tab on the query field and settle. Returns the event so a caller can read
   * `defaultPrevented` — dispatchEvent leaves the same object it was handed. Dispatched
   * at the FIELD, which is where focus sits, so it reaches the command root the way a
   * real keypress does: by bubbling. */
  function pressTab(flush: () => void, { shift = false, repeat = false } = {}): KeyboardEvent {
    const field = queryField();
    if (field === null) throw new Error("no query field");
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: shift,
      repeat,
      bubbles: true,
      cancelable: true,
    });
    field.dispatchEvent(event);
    flush();
    return event;
  }

  /** Type into the field the way a reviewer would, so the bound query — and with it
   * the match set — updates. `done` says what settling looks like for this query: a
   * query matching nothing never grows the option set, so polling on that alone
   * would burn every try and return silently green. */
  async function typeQuery(
    text: string,
    flush: () => void,
    done: () => boolean = () => options().length > 0,
  ): Promise<void> {
    const field = queryField();
    if (field === null) throw new Error("no query field");
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushUntil(flush, done);
  }

  /** Open the trailing crumb's menu, then swap it for the filter. Settles on BOTH
   * halves of the swap — the panel's rows arriving and the menu's content leaving —
   * so no test starts against a bar still showing two panels, and none leaves the
   * menu's effects behind for the next one (see `closeMenu`). */
  async function openFilter(target: HTMLElement, flush: () => void): Promise<void> {
    await openCrumb(target, 2, flush);
    pressInMenu("/");
    await flushUntil(flush, () => options().length > 0 && menuContent() === null);
  }

  /** Dismiss the filter before the test ends, the same guard PlanToc.test.ts carries:
   * bits-ui's portal presence waits for an `animationend` that never fires under
   * happy-dom, so content left open at unmount keeps its effects alive into whatever
   * runs next. Picking a row is the deterministic dismissal here — it runs the
   * component's own close path rather than bits-ui's dismiss layer, which wants a real
   * pointer. Guarded, so it is a no-op in the test whose pick already closed it.
   *
   * It does NOT silence this file's `derived_inert` output on a scoped run: the
   * describes above leave their menus open, and this panel's document-level dismiss
   * listeners are what start reading those dead effects. Measured, dismissing here is
   * still better than not — see the header note on where the real fix lives. */
  async function closeFilter(flush: () => void): Promise<void> {
    if (panel() === null) return;
    if (options().length === 0) await typeQuery("", flush);
    options()[0]?.click();
    await flushUntil(flush, () => panel() === null);
  }

  /** Shut an open hierarchy menu, for the same reason. Its trigger is a toggle. */
  async function closeMenu(target: HTMLElement, flush: () => void): Promise<void> {
    if (menuContent() === null) return;
    target.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.click();
    await flushUntil(flush, () => menuContent() === null);
  }

  test("replaces the open menu's siblings with a field over every heading", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    // The innermost crumb's menu offers one row — its own level. The filter that
    // replaces it spans all four headings, across every level, and the menu it
    // replaced is gone rather than left standing behind the panel.
    await openCrumb(target, 2, flush);
    expect(menuRows().length).toBe(1);

    pressInMenu("/");
    await flushUntil(flush, () => options().length > 0);
    expect(labels()).toEqual(["Overview", "Approach", "Details", "Verification"]);
    // And the hierarchy it replaced is gone rather than left standing behind the
    // panel. Polled: the swap shuts the menu through its own trigger, and bits-ui
    // takes a beat to tear the portalled content down.
    await flushUntil(flush, () => menuContent() === null);
    expect(menuContent()).toBeNull();
    await closeFilter(flush);
  });

  // The structural fix the header comment used to record as a deviation: a textbox
  // is not a role `menu` admits, so the filter now publishes combobox + listbox.
  test("publishes the field as a combobox over a labelled listbox", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    expect(queryField()?.getAttribute("role")).toBe("combobox");
    expect(queryField()?.getAttribute("aria-label")).toBe("Filter headings");
    expect(listbox()?.getAttribute("role")).toBe("listbox");
    // Named apart from the ToC popup's "Plan headings", so a role query cannot
    // collect both surfaces at once.
    expect(listbox()?.getAttribute("aria-label")).toBe("Matching headings");
    await closeFilter(flush);
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
    await flushUntil(flush, () => options().length > 0);
    await closeFilter(flush);
  });

  test("names each result's enclosing heading", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    expect(options().map((r) => r.querySelector(".crumb-parent")?.textContent?.trim())).toEqual([
      undefined, // "Overview" is top-level, so it has no parent to name
      "Overview",
      "Approach",
      "Overview",
    ]);
    await closeFilter(flush);
  });

  test("narrows the results as the query is typed", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    await typeQuery("ver", flush, () => options().length === 2);
    expect(labels()).toEqual(["Overview", "Verification"]);
    await closeFilter(flush);
  });

  // The filter stays FLAT — its divergence from the ToC popup's grouped filter is
  // deliberate. A match brings its enclosing heading's name along on the row
  // rather than sitting under a shared breadcrumb header, and the rows keep
  // document order, which the command's own score-sorting engine would shuffle.
  test("flattens rather than grouping, and leaves the rows in document order", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    await typeQuery("e", flush, () => options().length === 3);
    // Document order, which the command's own score sort would shuffle.
    expect(labels()).toEqual(["Overview", "Details", "Verification"]);

    // Flat: a match arrives alone, with its enclosing heading riding ON its row.
    // The ToC popup's grouped filter answers this query with a breadcrumb header
    // above the match instead.
    await typeQuery("details", flush, () => options().length === 1);
    expect(labels()).toEqual(["Details"]);
    expect(options()[0]?.querySelector(".crumb-parent")?.textContent?.trim()).toBe("Approach");
    await closeFilter(flush);
  });

  test("shows an empty state rather than a blank panel when nothing matches", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    await typeQuery("zzz", flush, () => options().length === 0);
    expect(options().length).toBe(0);
    expect(emptyLine()?.textContent?.trim()).toBe("No headings match");
    // Narrowing to nothing is the one change aria-activedescendant cannot carry —
    // no active row is left to name — so a live region says it out loud.
    expect(emptyLine()?.getAttribute("role")).toBe("status");
    await closeFilter(flush);
  });

  // A live region has to be idle in the DOM before the change it announces; one
  // inserted with its content already in it is skipped by some AT outright.
  test("keeps the status line mounted while there are rows to show", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    expect(options().length).toBeGreaterThan(0);
    expect(emptyLine()).not.toBeNull();
    expect(emptyLine()?.textContent).toBe("");
    // A status ABOUT the list, not a row in it.
    expect(listbox()?.contains(emptyLine())).toBe(false);
    await closeFilter(flush);
  });

  // The narration EXC-1062 vendored `command` for, and the gap the bar's old
  // dropdown filter could not close. The field names the row the selection is on,
  // so the reviewer hears the list narrow without focus ever leaving the field.
  // Polled rather than sampled: bits-ui rebuilds the viewport both attributes are
  // derived from whenever a query crosses the empty/non-empty boundary.
  test("the filter field narrates the row the selection is on", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    await flushUntil(flush, () => queryField()?.getAttribute("aria-activedescendant") != null);

    const controls = document.getElementById(queryField()?.getAttribute("aria-controls") ?? "");
    expect(listbox()?.contains(controls)).toBe(true);

    const active = document.getElementById(
      queryField()?.getAttribute("aria-activedescendant") ?? "",
    );
    expect(active?.getAttribute("role")).toBe("option");
    // The command selects its first row, which is what Enter from the field takes.
    expect(active?.querySelector(".crumb-label")?.textContent?.trim()).toBe("Overview");
    await closeFilter(flush);
  });

  test("jumps to a result's source line when it is picked", async () => {
    const jumped = capture<number>();
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: jumped.cb,
    });
    await openFilter(target, flush);
    await typeQuery("verification", flush, () => options().length === 1);
    options()[0]?.click();
    await flushUntil(flush, () => panel() === null);
    expect(jumped.last()).toBe(20);
    // A pick hands the reviewer to the plan, so the panel leaves with them.
    expect(panel()).toBeNull();
  });

  test("marks the heading the reader is on among the results", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    expect(options().map((r) => r.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "location",
      null,
    ]);
    await closeFilter(flush);
  });

  // Tab walks the results too (EXC-1121), the way it walks the hierarchy menus and
  // the way it already walks the ToC popup's list. The primitive ignores Tab
  // outright — its own keydown maps only the arrows and the vim chords — so before
  // this the key closed the panel and handed focus back to the crumb. These pin the
  // walk itself; that the newly selected row is SCROLLED into view is real-browser
  // and lives in the e2e.
  test("Tab walks the selection to the next row", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    await flushUntil(flush, () => selectedLabels().length > 0);
    expect(selectedLabels()).toEqual(["Overview"]);

    pressTab(flush);
    await flushUntil(flush, () => selectedLabels()[0] === "Approach");
    expect(selectedLabels()).toEqual(["Approach"]);
    await closeFilter(flush);
  });

  test("Shift+Tab walks the selection to the previous row", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    await flushUntil(flush, () => selectedLabels().length > 0);
    pressTab(flush);
    await flushUntil(flush, () => selectedLabels()[0] === "Approach");

    pressTab(flush, { shift: true });
    await flushUntil(flush, () => selectedLabels()[0] === "Overview");
    expect(selectedLabels()).toEqual(["Overview"]);
    await closeFilter(flush);
  });

  // The command defaults `loop` OFF, where menu content defaults it on — so the two
  // views of one surface would stop at opposite ends without the prop being set.
  test("the Tab walk wraps at both ends of the list", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    await flushUntil(flush, () => selectedLabels().length > 0);
    expect(selectedLabels()).toEqual(["Overview"]);

    // Backwards off the first row lands on the last.
    pressTab(flush, { shift: true });
    await flushUntil(flush, () => selectedLabels()[0] === "Verification");
    expect(selectedLabels()).toEqual(["Verification"]);

    // And forwards off the last comes back to the first.
    pressTab(flush);
    await flushUntil(flush, () => selectedLabels()[0] === "Overview");
    expect(selectedLabels()).toEqual(["Overview"]);
    await closeFilter(flush);
  });

  // The whole point of walking from the field rather than moving focus row to row:
  // `aria-activedescendant` on the field is what narrates the walk, and it only does
  // that while the field is the focused element.
  test("the Tab walk leaves focus in the query field", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    await flushUntil(flush, () => selectedLabels().length > 0);

    pressTab(flush);
    await flushUntil(flush, () => selectedLabels()[0] === "Approach");
    // Asserted, not merely polled for: flushUntil gives up SILENTLY after its tries
    // elapse, so a walk that never happened would leave the focus check below
    // passing on its own — focus does not move when nothing moves it.
    expect(selectedLabels()).toEqual(["Approach"]);
    expect(document.activeElement).toBe(queryField());
    await closeFilter(flush);
  });

  // A Tab that reached the browser's default would take focus out of the panel, which
  // traps none, and off the end of the document — the panel is portalled to the body
  // and nothing is tabbable after it.
  test("the Tab walk suppresses the browser's own tab move", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    await flushUntil(flush, () => selectedLabels().length > 0);

    const event = pressTab(flush);
    expect(event.defaultPrevented).toBe(true);
    // And the panel is still standing: Tab no longer dismisses it.
    expect(panel()).not.toBeNull();
    await closeFilter(flush);
  });

  // EXC-1122: while a key is held the OS keeps emitting keydowns, and
  // preventDefault does not stop it — so a held Tab would be walked by the native
  // repeat AND by the hold-to-repeat timer, at two different rates, and every hold
  // would double-step. The repeat is dropped here; the timer owns the cadence.
  test("an OS repeat of a held Tab walks no further", async () => {
    const { target, flush } = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
    });
    await openFilter(target, flush);
    await flushUntil(flush, () => selectedLabels().length > 0);
    expect(selectedLabels()).toEqual(["Overview"]);

    const event = pressTab(flush, { repeat: true });
    // Spun rather than settled: this asserts an ABSENCE, so the walk is given the
    // same room a real one gets before the row is read back.
    await flushUntil(flush, () => false, 5);
    expect(selectedLabels()).toEqual(["Overview"]);
    // Still claimed while held, so the browser's own tab move stays suppressed for
    // as long as the key is down rather than only on its first press.
    expect(event.defaultPrevented).toBe(true);
    await closeFilter(flush);
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
    await closeMenu(on.target, on.flush);

    const off = render(PlanBreadcrumbs, {
      headings: HEADINGS,
      activeLine: 9,
      onJump: () => {},
      showShortcutHints: false,
    });
    await openCrumb(off.target, 2, off.flush);
    expect(hint()).toBeNull();
    await closeMenu(off.target, off.flush);
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
