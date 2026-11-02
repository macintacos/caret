// The plan's outline (EXC-1095 built the surface, EXC-1096 gives it this contract). It is
// a Command — a filter field over a listbox that shows TWO views of one heading model —
// standing as a column beside the plan, or, where the window has no room for the column,
// as a float dropped from the plan header's outline key. With no query the list is every
// heading nested by level, the one being read latched. With a query it is the matches
// only, gathered under one breadcrumb header per ancestor path and rendered flush left
// (EXC-1103). `\` opens the filter wherever the outline stands; Shift+`\` shows or hides
// it.
//
// Everything asserted here needs a real browser, which is why it is a spec rather
// than an extension of ui/src/components/PlanToc.test.ts (browser-testing.md). The
// keyboard walk is bits-ui's roving selection driven by real keydown; Escape,
// outside-click and focus restoration are the float's own interaction semantics, and
// whether the column has room beside a file drawer is a laid-out width;
// "the current heading is scrolled into view" is a scroll measurement against a real
// box; the narration attributes are read back off the live DOM, where a screen reader
// would find them; and a breadcrumb header naming its group is an aria-labelledby the
// ROLE ENGINE has to resolve, which a mount can only assert points somewhere. Clearing
// the query is browser work for a subtler reason: it crosses bits-ui's
// `{#key search === ""}` boundary, which destroys and rebuilds the whole viewport.
// The pure half — which groups exist and what sits in them, the marked row, the a11y
// attributes' presence on a mounted outline — is that unit suite, and the vendored
// primitive's own viewport wiring is pinned in
// ui/src/lib/shadcn-command-popover.test.ts.
//
// The `\` and Shift+`\` keys sit here for the same reason: a bare keydown has to travel
// the real global dispatcher past the real safe-mode grace, and none of that exists under
// a mount. The pure half is again the unit suite — that the reservations carry the keys
// and that PlanToc hands its filter up (keymap.test.ts, PlanToc.test.ts). Compare mode is
// a third thing still: what it needs is a review with TWO versions, which is daemon
// state no prop can stand in for, so it is e2e on the axis browser-testing.md calls
// the more interesting half.
//
// EXC-1106's indent guides are a third kind of subject again, and the one furthest
// from anything a mount can reach: they are painted by a pseudo-element, from `calc`
// over two custom properties, and happy-dom neither lays out nor resolves either. So
// the unit suite can only read back the guide COUNT a row was handed, and everything
// about where that count lands — the column grid, the band meeting its neighbours,
// the empty band while filtering — is measured here off `getComputedStyle`. The one
// spec that pins the count itself against a plan rooted at `##` is the unit suite's
// (PlanToc.test.ts); its browser half is the geometry that count produces.
//
// EXC-1107's motion pass is real-engine by necessity, and the most clear-cut case in the
// file: happy-dom runs no animations at all — it resolves no `animation` shorthand, fires
// no `animationstart`/`animationend`, and implements no Web Animations API — so every
// assertion about this surface's motion is either a value the cascade computed or an event
// the engine really fired. The only half a mount can reach is the `data-toc-view` marker
// those rules key on, and that lives in ui/src/components/PlanToc.test.ts.
//
// EXC-1122's hold-to-repeat is the sharpest layer call in the file: what it adds is a
// CURVE — one move, a pause, then a run — which exists only against a real clock and a
// real key that is HELD rather than pressed. Playwright's `keyboard.down` emits one
// keydown and no repeats of its own, so everything the walk does past the first row is
// the app's timer and nothing else. The halves a mount can reach — the repeat bail and
// the wrap `loop` buys — are in ui/src/components/PlanToc.test.ts, and the helper's own
// delay/run lifecycle runs off an injected clock in ui/src/lib/keyRepeat.test.ts.
//
// Bare keys throughout, per the issue's constraint: a command modifier means the
// reviewer is addressing the browser or the OS, not the outline. waitPastSafeModeGrace
// (inside jumpToHeading) is mandatory before the first keystroke.

import type { Locator, Page } from "@playwright/test";

import { makeProject } from "@test/e2e/support/file-refs.ts";
import { type Daemon, expect, motionToken, test } from "@test/e2e/support/fixtures.ts";
import { clickBelowPanel, holdAndSettle, isWithinBox } from "@test/e2e/support/plan-nav.ts";
import { jumpToHeading, planSurface } from "@test/e2e/support/source-view.ts";

// Sections taller than the viewport, so jumping to one genuinely changes which
// heading is being read rather than leaving the whole plan in view.
const filler = (label: string) =>
  Array.from({ length: 30 }, (_, i) => `${label} detail line ${i + 1} keeps this tall.`).join("\n");

// Exactly ONE `#` on purpose, here and below: the daemon normalizes a posted plan to a
// single top-level heading and demotes every later one, so a fixture with two would be
// stored with the second at level 2 and quietly change the tree these specs assert.

// Twenty-four sections under one top-level heading — enough rows that the popup's list
// overflows its 25rem max-height, which is what makes "the current heading is scrolled
// into view on open" a claim about scrolling rather than about a list that fits whole.
// The count tracks that height and nothing else: EXC-1102 doubled the panel from 18rem,
// and a fixture left at twelve sections then fit whole, turning the out-of-view half of
// that assertion from a guard into a false alarm. Grow this list if the height grows
// again — never relax the assertion, which is the only thing proving the list scrolls.
const SECTIONS = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
  "India",
  "Juliet",
  "Kilo",
  "Lima",
  "Mike",
  "November",
  "Oscar",
  "Papa",
  "Quebec",
  "Romeo",
  "Sierra",
  "Tango",
  "Uniform",
  "Victor",
  "Whiskey",
  "Xray",
];
const TALL_PLAN = [
  "# Plan",
  filler("Plan"),
  ...SECTIONS.flatMap((s) => [`## ${s}`, filler(s)]),
  "",
].join("\n\n");

// Two matches for "notes" sitting in different branches, so filtering produces two
// distinct ancestor paths and puts a breadcrumb header BETWEEN the two selectable rows
// — the arrangement the roving walk has to cross without landing on it, and the
// hierarchy the flat breadcrumbs filter cannot express. "Wrapup" matches nothing, so it
// is what proves the filtered view is shorter than the tree.
const BRANCHED_PLAN = [
  "# Plan",
  filler("Plan"),
  "## Setup",
  filler("Setup"),
  "### Setup notes",
  filler("Setup notes"),
  "## Rollout",
  filler("Rollout"),
  "### Rollout notes",
  filler("Rollout notes"),
  "## Wrapup",
  filler("Wrapup"),
  "",
].join("\n\n");

// A plan whose shallowest heading is `##`, with no level-1 heading anywhere — the
// shape the ToC's absolute indent renders one step in, with nothing at depth zero
// (EXC-1106). Deliberately breaks the one-`#` convention the two fixtures above keep,
// because the whole point of it is a plan that never opens a level-1 heading.
const SHALLOW_PLAN = [
  "## Setup",
  filler("Setup"),
  "### Prereqs",
  filler("Prereqs"),
  "## Rollout",
  filler("Rollout"),
  "",
].join("\n\n");

// A trail whose last segment ends in punctuation, and a trail long enough to overflow
// the header (EXC-1108). Both are rendering-only concerns, which is why they are here
// and not in a mount: the header elides from the start via `direction: rtl`, and under
// an RTL paragraph a TRAILING neutral character has no following strong character to
// resolve against, so it takes the paragraph direction and lands at the far left —
// `Why?` renders `?WHY`. `textContent` reads correctly the whole time; only the glyphs
// move. A zero-width LRM in generated content is what prevents it.
const PUNCTUATED_PLAN = [
  "# Rollout plan",
  filler("Rollout plan"),
  "## Why?",
  filler("Why"),
  "### Migration notes",
  filler("Migration notes"),
  "## Phase two considerations",
  filler("Phase two"),
  "### Deployment procedures",
  filler("Deployment"),
  "#### Rollback and recovery",
  filler("Rollback"),
  "##### Checksum notes",
  filler("Checksum notes"),
  "",
].join("\n\n");

const TOC = ".plan-outline";
const FLOAT = ".outline-float";
/** The breadcrumbs bar's dropdown — the OTHER heading surface, addressed here only
 * to prove `\` and `b` do not reach the same one. Same selector plan-breadcrumbs
 * hoists as MENU. */
const CRUMB_MENU = "[data-slot='dropdown-menu-content']";

/** The header's outline key, present while the column is not shown. */
const outlineKey = (page: Page) =>
  page.locator(".plan-header").getByRole("button", { name: "Outline", exact: true });
/** The outline column. Every locator below is scoped through it, which is what lets them
 * be role queries: the breadcrumbs bar publishes a filter field with the SAME accessible
 * name, and an unscoped query would collect both (browser-testing.md § Locators). */
const panel = (page: Page) => page.locator(TOC);
const listbox = (page: Page) => panel(page).getByRole("listbox", { name: "Plan headings" });
/** Deliberately role queries rather than `[role=...]` CSS: Playwright's role engine reads
 * the ACCESSIBILITY TREE, and whether these rows are options in that tree is this spec's
 * entire subject — an attribute selector would still match a row that had been taken out
 * of it, which is exactly the regression the viewport's `role="none"` exists to prevent. */
const options = (page: Page) => panel(page).getByRole("option");
const field = (page: Page) => panel(page).getByRole("combobox", { name: "Filter headings" });
/** A breadcrumb group by the path it names (EXC-1103). A role-AND-name query, and the
 * choice is this spec's subject rather than style: whether the ancestor path reaches the
 * accessibility tree as the group's NAME is exactly what changed, and only the role
 * engine can answer it — an attribute selector would match the header element whether or
 * not anything was labelled by it. */
const group = (page: Page, name: string) => panel(page).getByRole("group", { name, exact: true });
/** Every breadcrumb header's text, in document order, for asserting the whole set at once
 * and for its ORDER, which a per-name lookup cannot see. The header publishes no role of
 * its own — it is the `aria-labelledby` target — so this is browser-testing.md's "no
 * accessible target" case and a `data-*` selector is the honest form. */
const crumbs = (page: Page) => panel(page).locator("[data-command-group-heading]");
/** The row the roving walk is on. bits-ui marks it `data-selected`; the reader is told
 * about it through the field's aria-activedescendant, asserted in its own test below. */
const walkedTo = (page: Page) => options(page).and(page.locator("[data-selected]"));

/** Each row's `--toc-depth`, in document order — the indent level its guides and
 * left padding are keyed on. */
const rowDepths = (page: Page): Promise<string[]> =>
  options(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).style.getPropertyValue("--toc-depth")),
  );

/** Wait until nothing in the outline is still animating.
 *
 * A real promise on a real animation, not a sleep: `Animation.finished` settles when the
 * engine says the animation is done, so it costs nothing on a surface that has already
 * settled and cannot race the one that has not. `subtree: true` covers the panel's
 * descendants generally rather than any one of them — the only caller opens on an empty
 * query, where no row or header declares a ramp at all.
 *
 * Two filters, both about promises that would never settle. A cancelled animation rejects
 * `finished` with an AbortError — an element removed mid-flight is the ordinary case here,
 * not a failure — so each is swallowed individually rather than letting one poison the
 * `Promise.all`. And an INFINITE animation never finishes at all: none is on this surface
 * today, but a spinner in the vendored `command-loading.svelte` or an ambient pulse on
 * some future row state would hang every `openToc()` in this file until the per-test
 * budget fired, naming the test rather than the step — the failure shape
 * browser-testing.md § Timeouts warns about. Excluded rather than waited on. */
async function settled(page: Page): Promise<void> {
  await panel(page).evaluate(async (el) => {
    await Promise.all(
      el
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished.catch(() => {})),
    );
  });
}

/** Open the column's filter with `\` and wait for its rows — and then for its motion,
 * so every geometry spec below reads settled boxes rather than ones caught mid-ramp. */
async function openToc(page: Page): Promise<void> {
  await page.keyboard.press("\\");
  await expect(field(page)).toBeFocused();
  await expect(options(page).first()).toBeVisible();
  await settled(page);
}

/** The animation an element is carrying, read off the cascade. `animationName` survives
 * the animation itself — it is a computed value, not a running-state — so this is a
 * question about what the stylesheet says rather than about what frame we caught. */
const animationOf = (locator: Locator) =>
  locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      name: style.animationName,
      duration: style.animationDuration,
    };
  });

/** Load the plan and park the reading position on `heading`. */
async function readingAt(page: Page, heading: string): Promise<void> {
  await planSurface(page);
  await jumpToHeading(page, heading);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("heading"))
    .toBe(heading.toLowerCase().replaceAll(" ", "-"));
}

/** Seed `plan`, load it, park the reading position on `heading`, and open the filter —
 * the arrange nearly every spec in this file shares. */
async function openTocAt(page: Page, daemon: Daemon, plan: string, heading: string): Promise<void> {
  await daemon.seed({ plan });
  await page.goto("/");
  await readingAt(page, heading);
  await openToc(page);
}

/** How far each guide hangs into its ancestor's key, in px — `--toc-guide-x`, `0.55rem` at
 * the default root size. Named because two specs below assert against it and a bare
 * `8.8` reads as a magic number in both. */
const GUIDE_X_PX = 8.8;

/** Each row's indent guides, measured off the ::before that paints them (EXC-1106).
 *
 * Everything here is a COMPUTED read rather than a bounding box, and that is
 * load-bearing rather than convenience. A pseudo-element has no node to locate, so
 * there is no rect to take — and more importantly the popover animates in under
 * `zoom-in-95 duration-100` (popover-content.svelte), so for the first frames after
 * open a rect is a *visual* box carrying that scale while a computed value is the
 * *layout* box that does not. Mixing the two spaces reads as a sub-pixel rounding
 * disagreement and is really a race: `toBeVisible()` resolves the moment the panel
 * paints, mid-zoom, and `evaluateAll` is not an action, so Playwright's
 * not-animating check never applies. Both sides of every assertion below therefore
 * come from `getComputedStyle`, which is why they can be exact rather than fuzzy.
 *
 * `rowHeight` is the row's computed `height` verbatim, which is already the border
 * box: Tailwind's preflight sets `box-sizing: border-box` globally, and under it the
 * resolved value of `height` includes the padding. That is exactly the box an
 * absolutely-positioned child's `inset-block: 0` spans, since its containing block is
 * the padding box and the row has no border — so the two numbers are equal rather
 * than merely close. Were the box-sizing ever to change under this, the assertion
 * would miss by the row's whole padding-block and red loudly.
 *
 * `top` and `bottom` stay rects: they are only ever compared against each other, and
 * a shared scale cancels out of an adjacency test. */
async function measureGuides(page: Page) {
  return options(page).evaluateAll((els) =>
    els.map((node) => {
      const el = node as HTMLElement;
      const box = el.getBoundingClientRect();
      const row = getComputedStyle(el);
      const guide = getComputedStyle(el, "::before");
      return {
        left: Number.parseFloat(guide.left),
        width: Number.parseFloat(guide.width),
        height: Number.parseFloat(guide.height),
        painted: guide.backgroundImage,
        padding: Number.parseFloat(row.paddingLeft),
        rowHeight: Number.parseFloat(row.height),
        top: box.top,
        bottom: box.bottom,
      };
    }),
  );
}

test("opens on the heading being read, scrolled into view", async ({ daemon, page }) => {
  // Short enough that the column's list cannot show every heading at once.
  await page.setViewportSize({ width: 1440, height: 560 });
  // Whiskey, not the trailing Xray: the plan scrolls only a third of a viewport past its
  // end, which is not enough room to bring the FINAL heading up to the reading zone, so
  // a jump there clamps short and the tracked heading stays on the section above it.
  // Whiskey is still far enough down that a popup opening at the top would leave its row
  // below the list's 25rem fold.
  await openTocAt(page, daemon, TALL_PLAN, "Whiskey");
  const current = options(page).and(page.locator('[aria-current="location"]'));
  await expect(current).toHaveText("Whiskey");

  // The status line is mounted even with rows on screen — it has to be idle in the DOM
  // before it announces — so it must cost no height while it has nothing to say.
  expect(await panel(page).getByRole("status").count()).toBe(1);
  expect((await panel(page).getByRole("status").boundingBox())?.height ?? -1).toBe(0);
  await expect.poll(() => isWithinBox(current, listbox(page))).toBe(true);

  // And the row above it is not — proof the list really is scrolled rather than short
  // enough to show every heading at once, which would make the assertion vacuous.
  expect(await isWithinBox(options(page).first(), listbox(page))).toBe(false);
});

test("the down arrow starts the walk at the heading being read, not the first row", async ({
  daemon,
  page,
}) => {
  // The deviation from the command's stock behavior, which selects the first row on
  // open. Asserted as the row AFTER the current one: landing on "Echo" is only
  // reachable from a walk that began at "Delta".
  await openTocAt(page, daemon, TALL_PLAN, "Delta");
  await expect(walkedTo(page)).toHaveText("Delta");

  await page.keyboard.press("ArrowDown");
  await expect(walkedTo(page)).toHaveText("Echo");

  // And back, which lands on the heading being read rather than stepping past it.
  await page.keyboard.press("ArrowUp");
  await expect(walkedTo(page)).toHaveText("Delta");
});

test("holding a walk key keeps traversing until it is released", async ({ daemon, page }) => {
  // EXC-1122. Before it, holding Tab here advanced exactly one row — the primitive
  // ignores Tab outright, so the OS's repeats reached a handler that had already
  // done its one job — and the list stopped dead at its ends besides. See the file
  // header for why the whole of this lives in the browser layer.
  await openTocAt(page, daemon, TALL_PLAN, "Delta");
  await expect(walkedTo(page)).toHaveText("Delta");

  // Released, the walk stops where it stopped.
  const selected = async () => (await walkedTo(page).allTextContents()).join("");
  await holdAndSettle(page, "Tab", selected, 5);

  // And focus never left the field, which is what narrates the walk.
  await expect(field(page)).toBeFocused();
});

test("the roving walk visits match rows only, never a breadcrumb header", async ({
  daemon,
  page,
}) => {
  // EXC-1103 removed the rows the walk used to have to step OVER, and the claim
  // inverts rather than disappearing: the headers are still between the matches
  // visually, and one arrow press still has to cross a header without landing on it.
  // Real-browser because it is bits-ui's roving selection under a real keydown.
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");
  await field(page).fill("notes");

  await expect(options(page)).toHaveText(["Setup notes", "Rollout notes"]);
  await expect(crumbs(page)).toHaveText(["Plan › Setup", "Plan › Rollout"]);

  await expect(walkedTo(page)).toHaveText("Setup notes");
  await page.keyboard.press("ArrowDown");
  // Lands on the next MATCH, not on the "Plan › Rollout" header sitting between them.
  await expect(walkedTo(page)).toHaveText("Rollout notes");
  await expect(walkedTo(page)).toHaveCount(1);
});

test("a breadcrumb header keeps one line, elides from the start, and holds its punctuation", async ({
  daemon,
  page,
}) => {
  // EXC-1108, and every claim here is rendering-only — `textContent` is identical
  // whether this passes or fails, which is why none of it can live in a mount.
  // Parked on a punctuation-free heading on purpose: readingAt asserts the `?heading=`
  // slug, and the daemon strips punctuation when it builds one, so "Why?" would never
  // match. Where the reader is parked is irrelevant to what this spec measures.
  await openTocAt(page, daemon, PUNCTUATED_PLAN, "Migration notes");
  await field(page).fill("notes");
  await expect(crumbs(page)).toHaveCount(2);

  const measured = await crumbs(page).evaluateAll((els) =>
    els.map((el) => {
      const node = el.firstChild;
      const text = node?.textContent ?? "";
      // The first and last CHARACTERS' painted positions. Under a correct render the
      // last character sits to the right of the first; a trailing neutral thrown to
      // the paragraph's RTL edge inverts them, which no text assertion can see.
      const at = (i: number) => {
        const r = document.createRange();
        r.setStart(node as Node, i);
        r.setEnd(node as Node, i + 1);
        return r.getBoundingClientRect().x;
      };
      const box = el.getBoundingClientRect();
      return {
        text,
        firstCharX: at(0),
        lastCharX: at(text.length - 1),
        boxLeft: box.left,
        boxRight: box.right,
        // One line: nowrap means an overflowing header grows scrollWidth, never height.
        overflows: el.scrollWidth > el.clientWidth,
        contentHeight: el.clientHeight - 8, // padding-block 0.25rem each side
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
        fontStyle: getComputedStyle(el).fontStyle,
      };
    }),
  );

  const punctuated = measured.find((m) => m.text.endsWith("?"));
  const deep = measured.find((m) => m.text.startsWith("Rollout plan › Phase"));
  expect(punctuated, "the Why? group should render").toBeDefined();
  expect(deep, "the deep group should render").toBeDefined();

  // The `?` paints AFTER the first letter, not thrown to the far left.
  expect(punctuated!.lastCharX).toBeGreaterThan(punctuated!.firstCharX);
  // Short enough to sit whole; the deep one is not, and elides.
  expect(punctuated!.overflows).toBe(false);
  expect(deep!.overflows).toBe(true);

  // …and elides from the START, which is the whole request. The direction to assert is
  // which END survives: with start-elision the LAST character is painted inside the box
  // and the FIRST is clipped away past its left edge. Ordinary end-elision inverts both,
  // so this is what reds if the rtl technique is dropped — `overflows` alone would not.
  expect(deep!.lastCharX).toBeLessThanOrEqual(deep!.boxRight);
  expect(deep!.firstCharX).toBeLessThan(deep!.boxLeft);

  for (const m of measured) {
    // One line each: content box never exceeds a single line box.
    expect(m.contentHeight).toBeLessThanOrEqual(Math.ceil(m.lineHeight) + 1);
    expect(m.fontStyle).toBe("italic");
  }
});

test("each breadcrumb header names its group in the accessibility tree", async ({
  daemon,
  page,
}) => {
  // The reason the header is a Command.Group heading rather than markup of caret's own:
  // the ancestor path has to reach a screen reader as the group's NAME. Real-browser
  // because only the role engine resolves aria-labelledby — the unit mount can assert the
  // attribute points somewhere, not that the name computes from it.
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");
  await field(page).fill("notes");

  await expect(group(page, "Plan › Setup")).toBeVisible();
  await expect(group(page, "Plan › Rollout")).toBeVisible();
  // The match sits INSIDE the group its breadcrumb names, which is what makes the
  // header wayfinding rather than a caption that happens to be nearby.
  await expect(group(page, "Plan › Setup").getByRole("option")).toHaveText(["Setup notes"]);
});

test("the grouping filter drives the list, not the command's own filter engine", async ({
  daemon,
  page,
}) => {
  // The vendored command ships a fuzzy filter that both hides non-matching rows and
  // RE-SORTS the survivors by score. Turning it off is what lets `groupedHeadingMatches`
  // own the list. Falsifiable two ways: a score sort would shuffle the document order
  // the groups and their rows keep, and the stock engine — which scores a row against
  // its VALUE, the source line — would empty the panel outright rather than re-sort it.
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");
  await field(page).fill("notes");

  await expect(crumbs(page)).toHaveText(["Plan › Setup", "Plan › Rollout"]);
  await expect(options(page)).toHaveText(["Setup notes", "Rollout notes"]);

  // Every match row is flush left now, whatever its own heading level: the breadcrumb above
  // it carries the hierarchy, so the indent no longer repeats it.
  expect(await rowDepths(page)).toEqual(["0", "0"]);
});

// EXC-1104 marks the matched characters by cutting a row's label into runs, which turns
// the option's NAME into a name-from-content computation over several child nodes instead
// of over one text node. Only a role engine performs that computation — a mount can assert
// the label's textContent and nothing more — so it is pinned here, beside the
// aria-labelledby resolution above and for the same reason.
//
// The QUERY is the load-bearing part of this spec, and a word-boundary one would make it
// vacuous. Accessible names are whitespace-normalized, so a split at a space survives a
// stray separator intact: "Setup " + "notes" with a separator between is "Setup  notes",
// which normalizes straight back to the expected name and the assertion never reds. "ote"
// splits mid-word into "Setup n" + "ote" + "s", where a separator normalizes to
// "Setup n ote s" and cannot hide. Keep any future query here mid-word.
test("marking the matched characters leaves the option's accessible name alone", async ({
  daemon,
  page,
}) => {
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");
  await field(page).fill("ote");

  // The mark is really rendered — otherwise the name below is trivially unchanged and
  // this spec would pass against a build that highlights nothing at all.
  await expect(panel(page).locator(".toc-hit")).toHaveText(["ote", "ote"]);
  await expect(options(page).first()).toHaveAccessibleName("Setup notes");
  await expect(options(page).nth(1)).toHaveAccessibleName("Rollout notes");
});

test("clearing the query puts the nested tree back", async ({ daemon, page }) => {
  // The breadcrumb form is a search affordance only. Real-browser because it crosses
  // bits-ui's `{#key search === ""}` boundary, which tears the whole viewport down and
  // rebuilds it — the one transition a mounted unit cannot exercise honestly.
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");
  await field(page).fill("notes");
  await expect(crumbs(page)).toHaveCount(2);

  await field(page).fill("");
  await expect(crumbs(page)).toHaveCount(0);
  await expect(options(page)).toHaveText([
    "Plan",
    "Setup",
    "Setup notes",
    "Rollout",
    "Rollout notes",
    "Wrapup",
  ]);

  // Back to indenting by the heading's own level.
  expect(await rowDepths(page)).toEqual(["0", "1", "2", "1", "2", "1"]);
});

test("pressing Enter on a walked-to row goes there and leaves focus in the plan", async ({
  daemon,
  page,
}) => {
  await openTocAt(page, daemon, TALL_PLAN, "Delta");
  await page.keyboard.press("ArrowDown");
  await expect(walkedTo(page)).toHaveText("Echo");
  await page.keyboard.press("Enter");

  await expect(field(page)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("echo");

  // A pick hands the reviewer to the plan, so the filter closes with focus out of the
  // outline. The body is where the plan's own window-level keys live.
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
});

test("clicking a heading in the column goes there, the filter closed", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Alpha");
  await options(page).filter({ hasText: "Hotel" }).click();

  await expect(field(page)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("hotel");
});

test("Escape steps out of the filter: the query, then the filter itself", async ({
  daemon,
  page,
}) => {
  // One step out at a time: the query clears, then the filter closes and focus leaves
  // the outline, which stays on screen with nothing in it focused.
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");
  const parked = new URL(page.url()).searchParams.get("heading");
  await field(page).fill("notes");
  await expect(options(page)).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(field(page)).toHaveValue("");
  await expect(options(page)).toHaveCount(6);

  await page.keyboard.press("Escape");
  await expect(field(page)).toHaveCount(0);
  await expect(listbox(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
  // Walking and leaving moved nothing: only a commit navigates.
  expect(new URL(page.url()).searchParams.get("heading")).toBe(parked);
});

test("the filter field is empty on every open", async ({ daemon, page }) => {
  // The filter always opens on the whole plan: a query that survived a close would show
  // a narrowed view of a plan the reviewer has since scrolled away from.
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");
  await field(page).fill("notes");
  await expect(options(page)).toHaveCount(2);

  await field(page).blur();
  await expect(field(page)).not.toBeFocused();

  await openToc(page);
  await expect(field(page)).toHaveValue("");
  // And the whole tree is back, not the narrowed one.
  await expect(options(page)).toHaveCount(6);
});

test("the field narrates the row the walk is on, and says so when nothing matches", async ({
  daemon,
  page,
}) => {
  // The accessibility payoff that justified vendoring `command` at all: the field is a
  // real combobox whose aria-activedescendant names the active row, so the list can be
  // walked and narrowed without focus ever leaving it. Read off the live DOM, which is
  // where a screen reader would read it.
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");
  await expect(field(page)).toHaveAttribute("aria-controls", /.+/);

  // aria-controls resolves to the viewport the rows live in, inside the listbox.
  const controls = (await field(page).getAttribute("aria-controls")) ?? "";
  await expect(listbox(page).locator(`[id="${controls}"]`)).toHaveCount(1);

  // The named row is the heading being read, and it moves as the list narrows.
  // Trimmed rather than read raw: a row also holds the command's check-indicator
  // span, so its textContent carries the whitespace toHaveText would normalize away.
  const narrated = async () => {
    const id = await field(page).getAttribute("aria-activedescendant");
    return ((await panel(page).locator(`[id="${id}"]`).textContent()) ?? "").trim();
  };

  await expect(walkedTo(page)).toHaveText("Setup");
  await expect.poll(narrated).toBe("Setup");

  await field(page).fill("rollout notes");
  await expect(walkedTo(page)).toHaveText("Rollout notes");
  await expect.poll(narrated).toBe("Rollout notes");

  // Narrowing to nothing leaves no row to name, so the message says it out loud
  // instead — the one narrowing aria-activedescendant cannot carry.
  await field(page).fill("nothing matches this");
  await expect(options(page)).toHaveCount(0);
  await expect(panel(page).getByRole("status")).toHaveText("No headings match");
});

test("\\ opens the outline's filter on the heading being read", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  // readingAt parks the reading position AND waits past the safe-mode grace, which
  // the bare key below cannot be pressed before.
  await readingAt(page, "Golf");

  await page.keyboard.press("\\");

  // The walk starts on the heading being read and that row is scrolled into the list's
  // box, with focus in the field so the reviewer can type straight away. The SELECTION
  // is the load-bearing assertion — aria-current is derived from the activeLine prop and
  // would read "Golf" even on a filter that opened on the first row.
  await expect(listbox(page)).toBeVisible();
  await expect(walkedTo(page)).toHaveText("Golf");
  await expect
    .poll(() =>
      isWithinBox(options(page).and(page.locator('[aria-current="location"]')), listbox(page)),
    )
    .toBe(true);
  await expect(field(page)).toBeFocused();
});

test("\\ and b reach different heading surfaces", async ({ daemon, page }) => {
  // Two keys, two surfaces: the property worth pinning is that neither one reaches
  // the other's.
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Golf");

  await page.keyboard.press("b");
  await expect(page.locator(CRUMB_MENU)).toBeVisible();
  await expect(field(page)).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator(CRUMB_MENU)).toHaveCount(0);

  await page.keyboard.press("\\");
  await expect(field(page)).toBeFocused();
  await expect(page.locator(CRUMB_MENU)).toHaveCount(0);
});

// A pick is a deliberate jump: the column latches the picked heading at once and holds it
// while the plan travels there, rather than stepping the latch through every heading the
// travel passes.
test("a pick latches its heading at once, not each heading the plan passes on the way", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Alpha");
  await page.evaluate(() => {
    const w = window as Window & { __latched?: string[] };
    w.__latched = [];
    const column = document.querySelector(".plan-outline");
    if (column === null) return;
    new MutationObserver(() => {
      const label = column
        .querySelector('[aria-current="location"] .toc-label')
        ?.textContent?.trim();
      if (label !== undefined && label !== w.__latched?.at(-1)) w.__latched?.push(label);
    }).observe(column, { subtree: true, attributes: true, attributeFilter: ["aria-current"] });
  });

  await options(page).filter({ hasText: "Mike" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("mike");
  const latched = await page.evaluate(
    () => (window as Window & { __latched?: string[] }).__latched,
  );
  expect(latched).toEqual(["Mike"]);
});

// Comparing folds the column away, for the split diff needs the width and no reading
// position is tracked there; the header's key drops the base version's changed sections
// instead. Daemon state — two versions — so it is here.
test("comparing folds the column into the header's key, whose float lists the changed sections", async ({
  daemon,
  page,
}) => {
  // Paragraphs of their own, so the daemon's reflow leaves the rest of each section
  // alone. Bravo's run is what puts Whiskey's hunk below the fold: the diff folds every
  // unchanged band, so with Whiskey's change alone there would be nothing to scroll.
  const bravoRun = Array.from({ length: 40 }, (_, i) => `Bravo gained line ${i + 1}.`).join("\n\n");
  const revised = TALL_PLAN.replace("## Charlie", `${bravoRun}\n\n## Charlie`).replace(
    "## Xray",
    "Whiskey gained a paragraph.\n\n## Xray",
  );
  await daemon.seedVersions(2, [TALL_PLAN, revised]);
  await page.goto("/");
  await readingAt(page, "Alpha");
  const choice = () => page.evaluate(() => localStorage.getItem("caret.planOutline"));
  const before = await choice();

  const versions = page.getByRole("button", { name: /^Versions/ });
  await versions.click();
  await expect(panel(page)).toHaveCount(0);
  await openFloat(page);
  const rows = page.locator(FLOAT).getByRole("option");
  await expect(rows).toHaveText([/^Bravo/, /^Whiskey/]);
  const whiskey = rows.filter({ hasText: "Whiskey" });
  await expect(whiskey.locator(".toc-delta")).toHaveText(/^\+\d+$/);
  await expect(whiskey).toHaveAccessibleDescription(/^\d+ lines? added$/);

  const scroller = page.locator(".diff-plan");
  const top = await scroller.evaluate((el) => el.scrollTop);
  await whiskey.click();
  await expect(page.locator(FLOAT)).toHaveCount(0);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(top);

  // Shift+\ and \ drop the float too, and neither writes the reader's choice.
  await page.keyboard.press("Shift+Backslash");
  await expect(
    page.locator(FLOAT).getByRole("combobox", { name: "Filter headings" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(outlineKey(page)).toBeFocused();
  await page.keyboard.press("Backslash");
  await expect(
    page.locator(FLOAT).getByRole("combobox", { name: "Filter headings" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");

  // Leaving compare stands the column again, as the reader left it.
  await versions.click();
  await expect(listbox(page)).toBeVisible();
  expect(await choice()).toBe(before);
});

test("with nothing changed, the compare float is one quiet line that holds focus until Escape", async ({
  daemon,
  page,
}) => {
  await daemon.seedVersions(2, [TALL_PLAN, TALL_PLAN]);
  await page.goto("/");
  await readingAt(page, "Alpha");
  await page.getByRole("button", { name: /^Versions/ }).click();
  await expect(panel(page)).toHaveCount(0);

  await page.keyboard.press("Shift+Backslash");
  const float = page.locator(FLOAT);
  await expect(float).toContainText("No sections changed");
  await expect(float.getByRole("combobox")).toHaveCount(0);
  await expect.poll(() => float.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(float).toHaveCount(0);
  await expect(outlineKey(page)).toBeFocused();
});

test("the indent guides sit on the indent's own grid and join across rows", async ({
  daemon,
  page,
}) => {
  // EXC-1106, and the half a mount cannot reach at all: happy-dom lays nothing out and
  // resolves no `calc`, so the unit suite can only read back the COUNT each row was
  // handed. Whether that count becomes hairlines in the right columns is arithmetic the
  // engine does — over a custom property, inside a pseudo-element that has no node to
  // locate — and it is the whole of the affordance. Read off ::before for that reason;
  // a bounding box cannot see it.
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");

  const bands = await measureGuides(page);
  expect(bands).toHaveLength(6);

  for (const [index, band] of bands.entries()) {
    // The band ends one guide offset past where the row's key begins, so its rightmost
    // hairline hangs into the parent's key one indent step to the left and every column
    // lines up with the level that opens it. This is what would catch a guide drawn on a
    // grid of its own.
    expect(band.left + band.width).toBeCloseTo(band.padding + GUIDE_X_PX, 1);
    // This plan opens at `#`, so every band starts at the first guide's offset and a row's
    // guide count is exactly its depth. The `##`-rooted spec below is what makes the
    // --toc-depth term in that offset falsifiable; here it contributes nothing.
    expect(band.left).toBeCloseTo(GUIDE_X_PX, 1);
    // Full row height, and rows that meet — so two same-depth neighbours join instead of
    // striping at the padding-block each row carries.
    expect(band.height).toBeCloseTo(band.rowHeight, 2);
    if (index > 0) expect(band.top).toBeCloseTo(bands[index - 1]?.bottom ?? -1, 1);
  }

  // Something is really painted in the band. Width alone would pass on an empty box.
  expect(bands[0]?.width).toBe(0);
  expect(bands[2]?.painted).toContain("repeating-linear-gradient");
});

test("a plan that opens at `##` draws no guide for the root it does not have", async ({
  daemon,
  page,
}) => {
  // The shape the guide count exists for, and the ONLY one that can catch it. The
  // indent is measured from level 1, so every row of this plan sits one step in with
  // nothing at zero; a band measured from the indent's origin would run a hairline
  // down a column no heading opens, beside every row, the length of the panel. With a
  // `#`-rooted plan the term that prevents it is identically zero, so the spec above
  // passes either way — this is where it becomes falsifiable.
  await openTocAt(page, daemon, SHALLOW_PLAN, "Setup");

  // The plan reaches the UI still rooted at `##` — the daemon's formatter normalizes
  // several things about an incoming plan and this is not one of them, which is what
  // makes the shape reachable rather than hypothetical.
  expect(await rowDepths(page)).toEqual(["1", "2", "1"]);

  const bands = await measureGuides(page);
  // Every band starts ONE step in from the first guide's offset — the column `## Setup`
  // occupies — rather than at the offset itself.
  expect(bands.map((b) => Math.round(b.left))).toEqual([25, 25, 25]);
  // And the plan's own top level still draws nothing: it is a root, not a nested row.
  expect(bands.map((b) => Math.round(b.width))).toEqual([0, 16, 0]);
  for (const band of bands) {
    expect(band.left + band.width).toBeCloseTo(band.padding + GUIDE_X_PX, 1);
  }
});

test("filtering drops the guides, headers and all", async ({ daemon, page }) => {
  // A filtered row is flush left under a breadcrumb header that carries the hierarchy, so a
  // column beside it would mark a nesting this view does not show — and the header is not a
  // row, so nothing should reach it either.
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");
  await field(page).fill("notes");
  await expect(crumbs(page)).toHaveCount(2);

  const widths = await options(page).evaluateAll((els) =>
    els.map((el) => getComputedStyle(el, "::before").width),
  );
  expect(widths).toEqual(["0px", "0px"]);

  const headers = await crumbs(page).evaluateAll((els) =>
    els.map((el) => getComputedStyle(el, "::before").backgroundImage),
  );
  expect(headers).toEqual(["none", "none"]);
});

// EXC-1107's motion pass, and every spec below needs a real engine for the same reason:
// happy-dom runs no animations at all. It resolves no `animation` shorthand, fires no
// `animationstart`/`animationend`, and implements no Web Animations API — so the unit
// suite can reach exactly one thing about this change, the `data-toc-view` marker the
// rules key on, and that is where it lives (PlanToc.test.ts). Everything here is either a
// value the cascade computed or an event the engine really fired.

/** What the panel's exit really did, captured from the engine rather than inferred.
 *
 * A dismissal removes the panel, so the assertion cannot be a computed read afterwards —
 * there is nothing left to read. Arming a recorder first and running the dismissal into
 * it is what makes "dismissal is animated too" falsifiable: strip the exit and the array
 * comes back empty rather than merely different.
 *
 * Filtered to the panel's own events. `animationstart`/`animationend` bubble, so a row or
 * a header animating inside would otherwise land in the same log. */
type MotionLog = { type: string; name: string; elapsed: number }[];

async function recordDismissal(page: Page, dismiss: () => Promise<void>): Promise<MotionLog> {
  await page.locator(FLOAT).evaluate((el) => {
    const w = window as Window & { __tocMotion?: MotionLog };
    w.__tocMotion = [];
    const log = (event: Event): void => {
      if (event.target !== el) return;
      const animation = event as AnimationEvent;
      w.__tocMotion?.push({
        type: event.type,
        name: animation.animationName,
        elapsed: animation.elapsedTime,
      });
    };
    el.addEventListener("animationstart", log);
    el.addEventListener("animationend", log);
  });
  await dismiss();
  await expect(page.locator(FLOAT)).toHaveCount(0);
  return page.evaluate(() => (window as Window & { __tocMotion?: MotionLog }).__tocMotion ?? []);
}

/** Under --w-narrow, open the outline's float from the header's key and settle it. */
async function openFloat(page: Page): Promise<void> {
  await outlineKey(page).click();
  await expect(
    page.locator(FLOAT).getByRole("combobox", { name: "Filter headings" }),
  ).toBeFocused();
  await page.locator(FLOAT).evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
  });
}

test("the float arrives and leaves on the state duration", async ({ daemon, page }) => {
  // The vendored Popover.Content already animates through tw-animate-css, and that
  // machinery is not decoration: bits-ui's portal presence waits on the `animationend` its
  // `enter`/`exit` keyframes fire. So the refinement retimes those keyframes rather than
  // declaring a competing one, and what this spec pins is exactly that — the animation is
  // still tw-animate-css's, and only its timing is now caret's.
  await page.setViewportSize({ width: 880, height: 900 });
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");

  const stateSeconds = await motionToken(page, "--dur-state");

  await outlineKey(page).click();
  const entering = await animationOf(page.locator(FLOAT));
  // Still the vendored keyframes — a caret-named animation here would mean the exit
  // bits-ui waits on had been replaced.
  expect(entering.name).toBe("enter");
  expect(Number.parseFloat(entering.duration)).toBeCloseTo(stateSeconds, 3);
  // The computed `enter` is readable before the engine starts it, so let it run out, or
  // its animationstart would land in the dismissal's log.
  await page.locator(FLOAT).evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
  });

  const log = await recordDismissal(page, () => page.keyboard.press("Escape"));
  const started = log.find((e) => e.type === "animationstart");
  const ended = log.find((e) => e.type === "animationend");
  expect(started?.name).toBe("exit");
  expect(ended?.name).toBe("exit");
  // `elapsedTime` at animationend is the animation's own active duration, so this is the
  // exit really having run for the token's worth of time — not a frame we happened to
  // catch, and not a computed value that would read the same on a cancelled animation.
  expect(ended?.elapsed).toBeCloseTo(stateSeconds, 3);
});

test("every way out of the float is animated, not cut", async ({ daemon, page }) => {
  // Four ways out, and they are not four spellings of one: Escape and an outside click are
  // the primitive's own dismissals, while a pick and the key are caret's own
  // `floatOpen = false`. All four have to reach the same `data-state` flip, or one of
  // them would drop the float out of the DOM instantly.
  await page.setViewportSize({ width: 880, height: 900 });
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");

  // Below the float's own box, on the plan: a click on the first rows would land on the
  // dismiss layer instead of outside it.
  const outsideClick = () => clickBelowPanel(page, page.locator(FLOAT));

  const paths: [string, () => Promise<void>][] = [
    ["Escape", () => page.keyboard.press("Escape")],
    ["an outside click", outsideClick],
    ["picking a heading", () => page.locator(FLOAT).getByRole("option").first().click()],
    ["the key", () => outlineKey(page).click()],
  ];

  for (const [name, dismiss] of paths) {
    await openFloat(page);
    const log = await recordDismissal(page, dismiss);
    // The path is the assertion's message rather than part of its value, so a failure
    // names it without the diff showing a matching half beside the mismatched one.
    expect(
      log.map((e) => `${e.type}:${e.name}`),
      `dismissed by ${name}`,
    ).toEqual(["animationstart:exit", "animationend:exit"]);
  }
});

test("a match and its breadcrumb header arrive on one animation", async ({ daemon, page }) => {
  // The header being "in step with its rows" is not two constants that happen to agree — it
  // is one declaration covering both, so the strongest form of the claim is a single
  // equality between what the cascade handed each of them. A header given a duration of its
  // own is exactly the drift that would pop it in above rows that were still fading, and it
  // is what this reds on.
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");

  await field(page).fill("notes");
  await expect(options(page)).toHaveCount(2);
  await expect(crumbs(page)).toHaveCount(2);

  const row = await animationOf(options(page).first());
  const header = await animationOf(crumbs(page).first());
  // Svelte scopes a component's keyframes with a build hash, so the name is asserted by
  // suffix — pinning the hash would red on any unrelated edit to the stylesheet.
  expect(row.name).toMatch(/toc-row-in$/);
  expect(header).toEqual(row);

  // The viewport stays still in this view: the rows are carrying the change, and running
  // both would multiply two opacity ramps on nested elements for nothing.
  const viewport = panel(page).locator("[data-slot='command-viewport']");
  expect((await animationOf(viewport)).name).toBe("none");
});

test("the outline carries its motion on the list, never on its rows", async ({ daemon, page }) => {
  // The decision the whole design rests on. The outline is the WHOLE plan — the low
  // hundreds of rows this popup is bounded at — and it mounts all at once, so a row
  // animation scoped to it would start several hundred simultaneous ramps on open and on
  // every clear. The list re-forming carries that direction instead, on one element.
  // TALL_PLAN is the fixture that makes this say something: 25 headings, more than fit.
  await openTocAt(page, daemon, TALL_PLAN, "Delta");

  const viewport = panel(page).locator("[data-slot='command-viewport']");
  const list = await animationOf(viewport);
  expect(list.name).toMatch(/toc-list-in$/);
  expect(Number.parseFloat(list.duration)).toBeCloseTo(await motionToken(page, "--dur-state"), 3);

  const animated = await options(page).evaluateAll(
    (els) => els.filter((el) => getComputedStyle(el).animationName !== "none").length,
  );
  expect(await options(page).count()).toBe(25);
  expect(animated).toBe(0);

  // And the same holds coming back: clearing the query crosses bits-ui's
  // `{#key search === ""}` boundary, which rebuilds the viewport and restarts its
  // animation — while the outline rows it rebuilds still animate nothing.
  await field(page).fill("alpha");
  await expect(options(page)).toHaveCount(1);
  await field(page).fill("");
  await expect(options(page)).toHaveCount(25);
  expect((await animationOf(viewport)).name).toMatch(/toc-list-in$/);
  expect(
    await options(page).evaluateAll(
      (els) => els.filter((el) => getComputedStyle(el).animationName !== "none").length,
    ),
  ).toBe(0);
});

/** The row ramps that really STARTED since the last arming, and which element each sat on.
 *
 * Armed rather than sampled, because `toc-row-in` carries no fill-mode: a finished
 * animation is no longer in effect, so `getAnimations()` drops it the moment its
 * `--dur-state` is up. That leaves a one-shot read valid only inside a 160ms WALL-CLOCK
 * window, and the gate's contention routinely lands it outside — the ramps have gone by
 * the time the read arrives and the count comes back 0 (EXC-1193, reproduced 4/4 at a 6x
 * CPU throttle). An `animationstart` listener records the fact instead of having to catch
 * the moment, which is the shape `armBarMotion` (plan-breadcrumbs.e2e.ts) already uses.
 *
 * The per-element identity is the backlog test proper: one start per element is the
 * design, and two on the same row inside one crossing would be generations stacking,
 * which is the failure this reds on. A LIVE sample could never make that claim — an element
 * hosts at most one animation per `animation-name`, so `getAnimations()` could only ever
 * agree with itself — where a log records two starts on one element across a crossing.
 * Elements are identified by their seat in an arming-scoped array rather than by a marker
 * attribute, so nothing is written back into the DOM under test.
 *
 * The listener pushes into a CAPTURED array rather than through `window`, which is what
 * makes re-arming safe: the stale listener a re-arm leaves attached goes on writing into
 * its own log, where a `w.__tocRowMotion?.push(…)` in its place would double-count every
 * event into the new one.
 *
 * `animationstart` bubbles, so one listener on the panel covers every row inside it, and
 * the log is filtered by keyframe name on the way out — so the vendored components'
 * Tailwind `transition-all` and the panel's own zoom stay out of it. */
type TocMotion = { name: string; target: number }[];

async function armTocMotion(page: Page): Promise<void> {
  await panel(page).evaluate((el) => {
    const w = window as Window & { __tocRowMotion?: TocMotion };
    const log: TocMotion = [];
    const seen: Element[] = [];
    w.__tocRowMotion = log;
    el.addEventListener("animationstart", (event) => {
      const target = event.target as Element;
      const seat = seen.indexOf(target);
      log.push({
        name: (event as AnimationEvent).animationName,
        target: seat === -1 ? seen.push(target) - 1 : seat,
      });
    });
  });
}

/** The `toc-row-in` starts recorded since the last arming.
 *
 * Matched by SUFFIX, never by equality: Svelte hashes a component's `@keyframes` names,
 * so what the engine reports is `svelte-<hash>-toc-row-in` and the hash moves whenever
 * the component's CSS is edited. */
async function tocMotion(page: Page): Promise<TocMotion> {
  const log = await page.evaluate(
    () => (window as Window & { __tocRowMotion?: TocMotion }).__tocRowMotion ?? [],
  );
  return log.filter((event) => event.name.endsWith("toc-row-in"));
}

/** The row ramps still PLAYING — the one question that really is about play state, and
 * the one `getAnimations()` is the right tool for. A liveness claim is polled. */
const runningRamps = (page: Page): Promise<number> =>
  panel(page).evaluate(
    (el) =>
      el
        .getAnimations({ subtree: true })
        .filter((a): a is CSSAnimation => a instanceof CSSAnimation)
        .filter((a) => a.animationName.endsWith("toc-row-in"))
        .filter((a) => a.playState === "running").length,
  );

/** How many distinct elements a crossing's starts landed on. */
const targetsIn = (log: TocMotion): number => new Set(log.map((event) => event.target)).size;

test("typing fast queues no animation behind the reviewer", async ({ daemon, page }) => {
  // Asserted as a ratio rather than as a ceiling, because the ceiling turned out to be the
  // wrong intuition. The filtered view is not reliably small: a one-character query matches
  // most of a plan, and the widest crossing measured on the dev plan mounts 59 rows and
  // headers at once. That is fine — profiled across it, frame times were indistinguishable
  // from the same burst with this animation disabled (median 8.3ms, p95 9.7ms, no frame
  // over 32ms either way), because mounting the rows is the expense and ramping their
  // opacity is not. What would NOT be fine is generations stacking, so that is what this
  // measures: at most one live ramp per element that could carry one.
  await openTocAt(page, daemon, TALL_PLAN, "Delta");

  // A broad query first — a bare "a" takes half of TALL_PLAN's sections plus its root, so
  // this is the crossing at its widest, with most of the list arriving in one frame.
  // Derived from the fixture rather than typed, so growing SECTIONS cannot quietly turn
  // this into a narrow query while the assertion stays green.
  const broad = SECTIONS.filter((s) => s.toLowerCase().includes("a")).length + 1;
  await armTocMotion(page);
  await field(page).pressSequentially("a", { delay: 15 });
  await expect(options(page)).toHaveCount(broad);
  // The rule fired at all — this is the arm that reds if the row ramp is ever dropped.
  // Polled rather than read once: the log is a recorded fact, so waiting for the first
  // start can only ever confirm what the crossing really did.
  await expect.poll(async () => (await tocMotion(page)).length).toBeGreaterThan(0);
  // And exactly one start per element it fired on. Two on one row is a stacked generation.
  const wide = await tocMotion(page);
  expect(targetsIn(wide)).toBe(wide.length);

  // Then narrowing, fast enough that a per-keystroke retrigger would have several
  // generations overlapping by the last character. Re-armed, so the log below is this
  // crossing's rather than both.
  await armTocMotion(page);
  await field(page).pressSequentially("lpha", { delay: 15 });
  await expect(options(page)).toHaveCount(1);

  // It drains: nothing is left running once the reviewer stops.
  await expect.poll(() => runningRamps(page)).toBe(0);

  // And narrowing fired NOTHING. `a` → `alpha` only ever removes rows — bits-ui unmounts
  // the filtered-out items and the survivors keep their boxes — so no row is mounted for
  // the rule to fire on, and an empty log is the whole claim rather than a weaker version
  // of the one above. A per-keystroke retrigger is the one thing that could put a start in
  // here, which is exactly what this rules out. Measured empty 4/4 unthrottled and
  // 4/4 at 20x.
  expect(await tocMotion(page)).toEqual([]);
});

test("reduced motion collapses the surface and leaves it fully usable", async ({
  daemon,
  page,
}) => {
  // Reduced motion is emulated HERE rather than in playwright.config.ts, and that is a
  // decision rather than a convenience. Turning `reduce` on suite-wide would delete a whole
  // race class from every geometry assertion in this file — but it would also stop the
  // suite ever exercising the animated path in a real engine, which is the entire subject
  // of this change. So the preference is emulated in the one spec that is about it.
  //
  // The guard is global (app.css) and reaches this panel through its `[data-slot]` anchor;
  // there is deliberately no reduced-motion block in the component. It collapses the
  // duration rather than removing the animation, and that distinction is load-bearing:
  // bits-ui's portal presence waits on `animationend`, so an `animation: none` here would
  // strand the panel in the DOM on every dismissal under the preference.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");

  // Read in TWO passes, because no single view has all four animations live and a read
  // taken where one is not declared measures the initial `0s` — which is under the
  // threshold with the guard, without it, and with the guard's `[data-slot]` anchor
  // deleted. An arm sampled in the wrong view is an arm that cannot fail.
  const outline = await panel(page).evaluate((el) => ({
    panel: getComputedStyle(el).animationDuration,
    viewport: getComputedStyle(el.querySelector("[data-slot='command-viewport']")!)
      .animationDuration,
  }));

  await field(page).fill("notes");
  await expect(options(page)).toHaveText(["Setup notes", "Rollout notes"]);
  // Only the matches view declares the row ramp — and the heading is the one animated
  // element the guard reaches through its `[data-slot] *` arm rather than `[data-slot]`,
  // so it is the arm worth sampling rather than assuming.
  const matches = await panel(page).evaluate((el) => ({
    row: getComputedStyle(el.querySelector("[data-slot='command-item']")!).animationDuration,
    heading: getComputedStyle(el.querySelector("[data-command-group-heading]")!).animationDuration,
  }));

  for (const [where, duration] of Object.entries({ ...outline, ...matches })) {
    // Named in the assertion so a failure says which element kept its motion. Near-zero,
    // not zero and not removed: still a real animation, still firing its end.
    expect([where, Number.parseFloat(duration) < 0.001]).toEqual([where, true]);
  }

  // Usable, which is the half a duration cannot show. Walk and commit.
  await page.keyboard.press("ArrowDown");
  await expect(walkedTo(page)).toHaveText("Rollout notes");
  await page.keyboard.press("Enter");
  await expect(field(page)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("rollout-notes");
});

// Hover moving the selection is bits-ui's pointer selection answering a real
// pointermove, the selected row's look is a computed style that only a real cascade
// resolves, and an option's description is something only the role engine computes.

/** The selected row's key, the part of the row that rises, once its transitions finish:
 * its face, shadow, lift and any outline. */
const walkedKeyLook = (page: Page) =>
  walkedTo(page)
    .locator(".toc-key")
    .evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
      const s = getComputedStyle(el);
      return {
        face: s.backgroundColor,
        shadow: s.boxShadow,
        lift: s.translate,
        outline: s.outlineStyle,
      };
    });

test("the row the keys select looks exactly as the row the pointer selects", async ({
  daemon,
  page,
}) => {
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");
  await options(page).filter({ hasText: "Rollout notes" }).hover();
  await expect(walkedTo(page)).toHaveText("Rollout notes");
  const pointed = await walkedKeyLook(page);
  expect(pointed.outline).toBe("none");

  await page.mouse.move(0, 0);
  await page.keyboard.press("ArrowUp");
  await expect(walkedTo(page)).not.toHaveText("Rollout notes");
  await page.keyboard.press("ArrowDown");
  await expect(walkedTo(page)).toHaveText("Rollout notes");
  expect(await walkedKeyLook(page)).toEqual(pointed);
});

test("the filter field shows focus without a ring", async ({ daemon, page }) => {
  await openTocAt(page, daemon, BRANCHED_PLAN, "Setup");
  await expect(field(page)).toBeFocused();
  // A ring is a shadow layer drawn OUTSIDE the field: not inset, with a positive spread.
  // The field's own edges are all inset, and its lip is a 1px offset with no spread.
  const rings = await panel(page)
    .locator("[data-slot='input-group']")
    .evaluate((el) =>
      getComputedStyle(el)
        .boxShadow.split(/,(?![^(]*\))/)
        .filter((layer) => !layer.includes("inset") && /\s[1-9]\d*(\.\d+)?px$/.test(layer.trim())),
    );
  expect(rings).toEqual([]);
});

test("an option is named by its heading and described by its comments and change", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seedVersions(2, [
    BRANCHED_PLAN.replace("Setup detail", "Setup note"),
    BRANCHED_PLAN,
  ]);
  const plan = (await daemon.getReview(id)).body?.currentPlan ?? "";
  const line = plan.split("\n").findIndex((l) => l.startsWith("Setup detail line 1")) + 1;
  await daemon.putDraft(id, {
    version: 2,
    annotations: [{ id: "a1", startLine: line, endLine: line, comment: "Which hosts?" }],
  });
  await page.goto("/");
  await readingAt(page, "Setup");
  await openToc(page);

  const setup = panel(page).getByRole("option", { name: "Setup", exact: true });
  await expect(setup).toHaveAccessibleDescription("1 comment, edited since v1");
});

// Where the outline stands is a laid-out width: the column wants 15.5rem beside a plan that
// still reads at 800px, and under --w-narrow there is no column at all.
test("Shift+\\ hides the column and brings it back, focus riding the key that replaces it", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");
  await expect(listbox(page)).toBeVisible();

  await page.keyboard.press("Shift+Backslash");
  await expect(panel(page)).toHaveCount(0);
  await expect(outlineKey(page)).toBeVisible();

  // The column's own key hands focus to the header's as it leaves.
  await outlineKey(page).click();
  await expect(listbox(page)).toBeVisible();
  const hide = panel(page).getByRole("button", { name: "Outline", exact: true });
  await hide.focus();
  await hide.press("Enter");
  await expect(outlineKey(page)).toBeFocused();

  // And a hidden outline stays hidden across a reload.
  await page.reload();
  await planSurface(page);
  await expect(outlineKey(page)).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});

test("under 960px the outline drops from the header's key, filter focused, and closes back onto it", async ({
  daemon,
  page,
}) => {
  await page.setViewportSize({ width: 880, height: 900 });
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Golf");
  await expect(panel(page)).toHaveCount(0);

  const float = page.locator(FLOAT);
  await outlineKey(page).click();
  await expect(outlineKey(page)).toHaveAttribute("aria-pressed", "true");
  await expect(float.getByRole("combobox", { name: "Filter headings" })).toBeFocused();
  await expect(float.getByRole("option").and(page.locator("[data-selected]"))).toHaveText("Golf");

  await page.keyboard.press("Escape");
  await expect(float).toHaveCount(0);
  await expect(outlineKey(page)).toBeFocused();
  await expect(outlineKey(page)).toHaveAttribute("aria-pressed", "false");

  // `\` opens the float too, and a pick closes it into the plan.
  await outlineKey(page).blur();
  await page.keyboard.press("\\");
  await expect(float.getByRole("combobox", { name: "Filter headings" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(float).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("hotel");
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
});

test("the column yields to a file drawer that would leave the plan under 800px", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject({ "src/cache.ts": "export const cache = new Map();\n" });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nThe cache lives in `src/cache.ts`.\n" });
    // Wide enough for the column, the plan and a default 45% drawer side by side.
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto("/");
    await planSurface(page);
    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator("[data-file-preview]")).toBeVisible();
    await expect(listbox(page)).toBeVisible();

    // Narrower, the same drawer would squeeze the plan, so the column yields to the key.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(panel(page)).toHaveCount(0);
    await expect(outlineKey(page)).toHaveAttribute("aria-pressed", "false");
    await openFloat(page);
    await expect(page.locator(FLOAT).getByRole("option")).toHaveText(["Refs"]);
  } finally {
    await proj.cleanup();
  }
});

// The float stands over the file drawer, so Escape closes it first, as the folder card
// above the lane does.
test("Escape closes the outline float before the file drawer it stands over", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject({ "src/cache.ts": "export const cache = new Map();\n" });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nThe cache lives in `src/cache.ts`.\n" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await planSurface(page);
    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator("[data-file-preview]")).toBeVisible();
    await expect(panel(page)).toHaveCount(0);

    await openFloat(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(FLOAT)).toHaveCount(0);
    await expect(page.locator("[data-file-preview]")).toBeVisible();
    await expect(outlineKey(page)).toBeFocused();
  } finally {
    await proj.cleanup();
  }
});

test("widening past 960px with the float open hands focus to the column's outline key", async ({
  daemon,
  page,
}) => {
  await page.setViewportSize({ width: 880, height: 900 });
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await planSurface(page);
  await openFloat(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(listbox(page)).toBeVisible();
  await expect(page.locator(FLOAT)).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Outline", exact: true })).toBeFocused();
});

// The column's outline key and the header's replace each other in place, so they stand one
// size, with the shortcut hints on and off.
for (const hints of ["on", "off"]) {
  test(`the outline's column and header keys stand one size, hints ${hints}`, async ({
    daemon,
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem("caret.shortcutHints", value), hints);
    await daemon.seed({ plan: TALL_PLAN });
    await page.goto("/");
    await planSurface(page);

    const hide = panel(page).getByRole("button", { name: "Outline", exact: true });
    const hideBox = await hide.boundingBox();
    await hide.click();
    const showBox = await outlineKey(page).boundingBox();
    expect(hideBox).not.toBeNull();
    expect(showBox).not.toBeNull();
    expect({ width: showBox!.width, height: showBox!.height }).toEqual({
      width: hideBox!.width,
      height: hideBox!.height,
    });
  });
}
