// The plan's table-of-contents popup (EXC-1095 built the surface, EXC-1096 gives it
// this contract). The popup is a bits-ui Popover holding a Command: a filter field
// over a listbox that shows TWO views of one heading model. With no query it is every
// heading nested by level, the one being read marked. With a query it is the matches
// only, gathered under one breadcrumb header per ancestor path and rendered flush left
// (EXC-1103).
//
// Everything asserted here needs a real browser, which is why it is a spec rather
// than an extension of ui/src/components/PlanToc.test.ts (browser-testing.md). The
// keyboard walk is bits-ui's roving selection driven by real keydown; Escape,
// outside-click and focus restoration are the popover's own interaction semantics;
// "the current heading is scrolled into view" is a scroll measurement against a real
// box; the narration attributes are read back off the live DOM, where a screen reader
// would find them; and a breadcrumb header naming its group is an aria-labelledby the
// ROLE ENGINE has to resolve, which a mount can only assert points somewhere. Clearing
// the query is browser work for a subtler reason: it crosses bits-ui's
// `{#key search === ""}` boundary, which destroys and rebuilds the whole viewport.
// The pure half — which groups exist and what sits in them, the marked row, the a11y
// attributes' presence on a mounted popup — is that unit suite, and the vendored
// primitive's own viewport wiring is pinned in
// ui/src/lib/shadcn-command-popover.test.ts.
//
// EXC-1097 adds the `\` key, and its specs sit here for the same reason: a bare
// keydown has to travel the real global dispatcher past the real safe-mode grace to
// reach a popup that is really portalled, and none of that exists under a mount. The
// pure half is again the unit suite — that the reservation carries the key and that
// PlanToc hands an open action up (keymap.test.ts, PlanToc.test.ts). Compare mode is
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
// Bare keys throughout, per the issue's constraint: a command modifier means the
// reviewer is addressing the browser or the OS, not the popup. waitPastSafeModeGrace
// (inside jumpToHeading) is mandatory before the first keystroke.

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { jumpToHeading, PLAN_SURFACE, planSurface } from "@test/e2e/support/source-view.ts";

// Sections taller than the viewport, so jumping to one genuinely changes which
// heading is being read rather than leaving the whole plan in view.
const filler = (label: string) =>
  Array.from({ length: 30 }, (_, i) => `${label} detail line ${i + 1} keeps this tall.`).join("\n");

// Exactly ONE `#` on purpose, here and below: the daemon normalizes a posted plan to a
// single top-level heading and demotes every later one, so a fixture with two would be
// stored with the second at level 2 and quietly change the tree these specs assert.

// Twenty-four sections under one top-level heading — enough rows that the popup's list
// overflows its 36rem max-height, which is what makes "the current heading is scrolled
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

const TOC = ".plan-toc-panel";
/** The breadcrumbs bar's dropdown — the OTHER heading surface, addressed here only
 * to prove `\` and `b` do not reach the same one. Same selector plan-breadcrumbs
 * hoists as MENU. */
const CRUMB_MENU = "[data-slot='dropdown-menu-content']";

const trigger = (page: Page) => page.getByRole("button", { name: "Contents" });
/** The popup itself. Every locator below is scoped through it, which is what lets them
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

/** Each row's heading-level marker by registry name, in document order (EXC-1105).
 * Addressed through `data-icon` — the handle Icon.svelte stamps with the glyph's name —
 * because this is browser-testing.md § Locators' no-accessible-target case twice over: the
 * marker is deliberately aria-hidden, so it is not in the tree a role query reads, and the
 * SVG is inlined verbatim, so nothing else in the DOM tells one glyph from another. `null`
 * for a row wearing none, so a missing marker reds as a value rather than throwing. */
const markerNames = (page: Page): Promise<(string | null)[]> =>
  options(page).evaluateAll((els) =>
    els.map((el) => el.querySelector("[data-icon^='heading-']")?.getAttribute("data-icon") ?? null),
  );

/** Where each row's label starts, rounded to the pixel. Equal across rows at one indent is
 * AC8 — a marker whose width varied with the level would push its label along with it.
 * `null` for a row with no label, on the same terms as `markerNames` above. */
const labelLefts = (page: Page): Promise<(number | null)[]> =>
  options(page).evaluateAll((els) =>
    els.map((el) => {
      const label = el.querySelector(".toc-label");
      return label === null ? null : Math.round(label.getBoundingClientRect().x);
    }),
  );

/** Wait until nothing in the popup is still animating.
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

/** Open the popup and wait for its rows — and then for its motion.
 *
 * The settle is EXC-1107's, and it is why every geometry spec below can keep reading
 * boxes. The panel enters under tw-animate-css's `zoom-in-95`, so until that finishes a
 * `getBoundingClientRect` is a *visual* box carrying the scale while `getComputedStyle`
 * is the *layout* box that is not — the two spaces `measureGuides` documents at length,
 * and the race EXC-1106 shipped a defect through. `toBeVisible()` resolves the moment the
 * panel paints, mid-zoom, and `evaluateAll` is not an action, so Playwright's own
 * not-animating check never applies. Waiting here closes the window for every caller at
 * once rather than per assertion. */
async function openToc(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(listbox(page)).toBeVisible();
  await expect(options(page).first()).toBeVisible();
  await settled(page);
}

/** A motion token as the engine resolves it, in the same units `getComputedStyle` and
 * `AnimationEvent.elapsedTime` report. Asked of the engine rather than parsed out of the
 * stylesheet, so a spec asserting a duration is asserting against the token the component
 * actually references and not against a number retyped beside it. */
async function motionToken(page: Page, token: string): Promise<number> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.setProperty("animation-duration", `var(${name})`);
    document.body.append(probe);
    const value = getComputedStyle(probe).animationDuration;
    probe.remove();
    return Number.parseFloat(value); // seconds
  }, token);
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
      easing: style.animationTimingFunction,
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

/** The indent's origin in px — `0.5rem` at the default root size, the offset every
 * row's padding and every guide band is measured from. Named because two specs below
 * assert against it and a bare `8` reads as a magic number in both. */
const INDENT_ORIGIN_PX = 8;

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

/** Whether `row` is inside the scrolled list's visible box — the claim a unit mount
 * cannot make, since happy-dom lays nothing out.
 *
 * Throws rather than returning false when either box is unmeasurable: one caller asserts
 * this is FALSE, to prove the list really scrolls rather than showing every heading at
 * once, and a false-on-null would let "not measurable" pass as "correctly out of view".
 * `expect.poll` fails on a throw exactly as it should. */
async function isWithinList(page: Page, row: Locator): Promise<boolean> {
  const rowBox = await row.boundingBox();
  const listBox = await listbox(page).boundingBox();
  if (rowBox === null || listBox === null) throw new Error("row or list has no bounding box");
  return rowBox.y >= listBox.y - 1 && rowBox.y + rowBox.height <= listBox.y + listBox.height + 1;
}

test("opens on the heading being read, scrolled into view", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  // Whiskey, not the trailing Xray: the plan scrolls only a third of a viewport past its
  // end, which is not enough room to bring the FINAL heading up to the reading zone, so
  // a jump there clamps short and the tracked heading stays on the section above it.
  // Whiskey is still far enough down that a popup opening at the top would leave its row
  // below the list's 36rem fold.
  await readingAt(page, "Whiskey");

  await openToc(page);
  const current = options(page).and(page.locator('[aria-current="location"]'));
  await expect(current).toHaveText("Whiskey");

  // The status line is mounted even with rows on screen — it has to be idle in the DOM
  // before it announces — so it must cost no height while it has nothing to say.
  expect(await panel(page).getByRole("status").count()).toBe(1);
  expect((await panel(page).getByRole("status").boundingBox())?.height ?? -1).toBe(0);
  await expect.poll(() => isWithinList(page, current)).toBe(true);

  // And the row above it is not — proof the list really is scrolled rather than short
  // enough to show every heading at once, which would make the assertion vacuous.
  expect(await isWithinList(page, options(page).first())).toBe(false);
});

test("the down arrow starts the walk at the heading being read, not the first row", async ({
  daemon,
  page,
}) => {
  // The deviation from the command's stock behavior, which selects the first row on
  // open. Asserted as the row AFTER the current one: landing on "Echo" is only
  // reachable from a walk that began at "Delta".
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");

  await openToc(page);
  await expect(walkedTo(page)).toHaveText("Delta");

  await page.keyboard.press("ArrowDown");
  await expect(walkedTo(page)).toHaveText("Echo");

  // And back, which lands on the heading being read rather than stepping past it.
  await page.keyboard.press("ArrowUp");
  await expect(walkedTo(page)).toHaveText("Delta");
});

test("the roving walk visits match rows only, never a breadcrumb header", async ({
  daemon,
  page,
}) => {
  // EXC-1103 removed the rows the walk used to have to step OVER, and the claim
  // inverts rather than disappearing: the headers are still between the matches
  // visually, and one arrow press still has to cross a header without landing on it.
  // Real-browser because it is bits-ui's roving selection under a real keydown.
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
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
  await daemon.seed({ plan: PUNCTUATED_PLAN });
  await page.goto("/");
  // Parked on a punctuation-free heading on purpose: readingAt asserts the `?heading=`
  // slug, and the daemon strips punctuation when it builds one, so "Why?" would never
  // match. Where the reader is parked is irrelevant to what this spec measures.
  await readingAt(page, "Migration notes");

  await openToc(page);
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
  // AC11, and the reason the header is a Command.Group heading rather than markup of
  // caret's own: the ancestor path has to reach a screen reader as the group's NAME.
  // Real-browser because only the role engine resolves aria-labelledby — the unit mount
  // can assert the attribute points somewhere, not that the name computes from it.
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await field(page).fill("notes");

  await expect(group(page, "Plan › Setup")).toBeVisible();
  await expect(group(page, "Plan › Rollout")).toBeVisible();
  // The match sits INSIDE the group its breadcrumb names, which is what makes the
  // header wayfinding rather than a caption that happens to be nearby.
  await expect(group(page, "Plan › Setup").getByRole("option")).toHaveText(["Setup notes"]);
  // The dimmed context rows this view used to render are gone (AC7).
  await expect(panel(page).locator(".toc-context")).toHaveCount(0);
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
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await field(page).fill("notes");

  await expect(crumbs(page)).toHaveText(["Plan › Setup", "Plan › Rollout"]);
  await expect(options(page)).toHaveText(["Setup notes", "Rollout notes"]);

  // Every match row is flush left now, whatever its own heading level: the breadcrumb
  // above it carries the hierarchy, so the indent no longer repeats it (AC5).
  const depths = await options(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).style.getPropertyValue("--toc-depth")),
  );
  expect(depths).toEqual(["0", "0"]);
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
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await field(page).fill("ote");

  // The mark is really rendered — otherwise the name below is trivially unchanged and
  // this spec would pass against a build that highlights nothing at all.
  await expect(panel(page).locator(".toc-hit")).toHaveText(["ote", "ote"]);
  await expect(options(page).first()).toHaveAccessibleName("Setup notes");
  await expect(options(page).nth(1)).toHaveAccessibleName("Rollout notes");
});

test("clearing the query puts the nested tree back", async ({ daemon, page }) => {
  // AC8: the breadcrumb form is a search affordance only. Real-browser because it
  // crosses bits-ui's `{#key search === ""}` boundary, which tears the whole viewport
  // down and rebuilds it — the one transition a mounted unit cannot exercise honestly.
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
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
  const depths = await options(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).style.getPropertyValue("--toc-depth")),
  );
  expect(depths).toEqual(["0", "1", "2", "1", "2", "1"]);
});

test("pressing Enter on a walked-to row goes there and leaves focus in the plan", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");

  await openToc(page);
  await page.keyboard.press("ArrowDown");
  await expect(walkedTo(page)).toHaveText("Echo");
  await page.keyboard.press("Enter");

  await expect(page.locator(TOC)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("echo");

  // A pick hands the reviewer to the plan, so the popup's close skips its focus
  // return — the trigger must not be left wearing a focus ring over a plan that has
  // already moved. The body is where the plan's own window-level keys live.
  await expect(trigger(page)).not.toBeFocused();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
});

test("clicking a heading goes there and dismisses", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Alpha");

  await openToc(page);
  await options(page).filter({ hasText: "Hotel" }).click();

  await expect(page.locator(TOC)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("hotel");
});

test("Escape dismisses and hands focus back to the trigger", async ({ daemon, page }) => {
  // The other half of the focus split: a dismissal leaves the reviewer where they
  // were, so the trigger takes focus back. Only a pick suppresses that.
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");
  const parked = new URL(page.url()).searchParams.get("heading");

  await openToc(page);
  await page.keyboard.press("Escape");

  await expect(page.locator(TOC)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  // Walking and dismissing moved nothing: only a commit navigates.
  expect(new URL(page.url()).searchParams.get("heading")).toBe(parked);
});

test("clicking outside the popup dismisses it", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");

  await openToc(page);
  // A real pointerdown on the plan, placed below the panel's own box rather than on a
  // named element: the panel is anchored under its trigger at the top of the plan, so
  // the first rows sit beneath it and a click there lands on the dismiss layer instead
  // of outside it.
  const panelBox = await page.locator(TOC).boundingBox();
  const planBox = await page.locator(PLAN_SURFACE).boundingBox();
  expect(panelBox).not.toBeNull();
  expect(planBox).not.toBeNull();
  await page.mouse.click(planBox!.x + planBox!.width / 2, panelBox!.y + panelBox!.height + 40);

  await expect(page.locator(TOC)).toHaveCount(0);
});

test("the filter field is empty on every open", async ({ daemon, page }) => {
  // The popup always opens on the whole plan: a query that survived a close would show
  // a narrowed view of a plan the reviewer has since scrolled away from.
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await field(page).fill("notes");
  await expect(options(page)).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(page.locator(TOC)).toHaveCount(0);

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
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
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

test("\\ opens the popup on the heading being read (EXC-1097)", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  // readingAt parks the reading position AND waits past the safe-mode grace, which
  // the bare key below cannot be pressed before.
  await readingAt(page, "Golf");

  await page.keyboard.press("\\");

  // Opened on the trigger's terms: the walk starts on the heading being read and
  // that row is scrolled into the list's box, with focus in the field so the
  // reviewer can type straight away. The SELECTION is the load-bearing assertion —
  // aria-current is derived from the activeLine prop and would read "Golf" even on
  // a popup that opened at the top of the list.
  await expect(listbox(page)).toBeVisible();
  await expect(walkedTo(page)).toHaveText("Golf");
  await expect
    .poll(() => isWithinList(page, options(page).and(page.locator('[aria-current="location"]'))))
    .toBe(true);
  await expect(field(page)).toBeFocused();
});

test("\\ and b reach different heading surfaces (EXC-1097)", async ({ daemon, page }) => {
  // Two keys, two surfaces: the property worth pinning is that neither one reaches
  // the other's.
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Golf");

  await page.keyboard.press("b");
  await expect(page.locator(CRUMB_MENU)).toBeVisible();
  await expect(panel(page)).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator(CRUMB_MENU)).toHaveCount(0);

  await page.keyboard.press("\\");
  await expect(listbox(page)).toBeVisible();
  await expect(page.locator(CRUMB_MENU)).toHaveCount(0);
});

// EXC-1105 gives every row a vendored lucide heading-N glyph saying what level it is. Three
// of its claims are real-browser and nothing else. The marker's COLOUR reaches it through an
// unlayered `:global` rule that has to beat the vendored command item's Tailwind
// `data-selected:[&_svg]:text-accent-foreground`, and only a real cascade decides which wins.
// The labels lining up is a laid-out box, which happy-dom does not produce. And that the
// marker adds nothing to an option's NAME is a computation only a role engine performs — the
// same reason EXC-1104's marked-name spec sits here. The pure half — which glyph each row
// wears, and the clamp for a level outside 1–6 — is ui/src/components/PlanToc.test.ts.
test("every row wears its heading level, in both of the popup's views", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await expect(options(page)).toHaveCount(6);
  // Read bare rather than polled, here and below: a marker renders in the same pass as the
  // row that owns it, so once `toHaveCount` has settled there is nothing left to wait for.
  expect(await markerNames(page)).toEqual([
    "heading-1",
    "heading-2",
    "heading-3",
    "heading-2",
    "heading-3",
    "heading-2",
  ]);

  // The view this exists for. "o" is chosen to survive at three DIFFERENT levels — a
  // level-2 heading between two level-3 ones — because every filtered row is flush left, so
  // rows at one indent carrying different markers is what makes the next two assertions say
  // anything. A query matching one level would leave both of them true by accident.
  await field(page).fill("o");
  await expect(options(page)).toHaveText(["Setup notes", "Rollout", "Rollout notes"]);
  const depths = await options(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).style.getPropertyValue("--toc-depth")),
  );
  expect(depths).toEqual(["0", "0", "0"]);
  expect(await markerNames(page)).toEqual(["heading-3", "heading-2", "heading-3"]);

  // AC8. Three rows at one indent, three different glyphs, one left edge.
  const lefts = await labelLefts(page);
  expect(lefts).not.toContain(null);
  expect(new Set(lefts).size).toBe(1);

  // AC7, in the engine that actually computes a name. The query splits each label mid-word
  // as well, so this carries EXC-1104's claim forward over the added marker rather than
  // replacing it: a separator leaking in from either decoration would show up here.
  await expect(options(page).first()).toHaveAccessibleName("Setup notes");
  await expect(options(page).nth(1)).toHaveAccessibleName("Rollout");
  await expect(options(page).nth(2)).toHaveAccessibleName("Rollout notes");
});

test("the level marker paints a dimmer rung of the ink ramp than the label", async ({
  daemon,
  page,
}) => {
  // AC5, read off the element that is actually painted. The glyph strokes with
  // `currentColor` resolved on the SVG, and the vendored command item declares
  // `data-selected:[&_svg]:text-accent-foreground` — which the bridge resolves to the
  // label's own --ink — on that same SVG. So the wrapper's `color` is NOT what a reader
  // sees on the walked-to row: a rule placed on Icon.svelte's wrapper loses there while
  // the wrapper keeps reporting the dimmed value, which is a green assertion over a bright
  // glyph. The path's `stroke` cannot lie about it.
  //
  // Asserted against the ink-ramp TOKENS rather than by re-deriving a contrast ratio here.
  // "Dimmer" then reduces to a property of the ramp, which theme.test.ts already pins
  // across every palette — where a number measured in this one Playwright run, on this one
  // palette, could not see a palette shipping a compressed ramp.
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");

  await openToc(page);
  await expect(walkedTo(page)).toHaveCount(1);

  const paint = await options(page).evaluateAll((els) => {
    // Resolve a token to the same `rgb()` form getComputedStyle reports, by asking the
    // engine rather than parsing: the tokens are hex and computed colours are not.
    const resolve = (token: string): string => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    const rows = els as HTMLElement[];
    const resting = rows.find((r) => !r.hasAttribute("data-selected") && r.ariaCurrent === null);
    const walked = rows.find((r) => r.hasAttribute("data-selected"));
    if (resting === undefined || walked === undefined) throw new Error("no resting/walked row");
    const marker = (row: HTMLElement) =>
      getComputedStyle(row.querySelector("[data-icon^='heading-'] svg path")!).stroke;
    const label = (row: HTMLElement) => getComputedStyle(row.querySelector(".toc-label")!).color;
    return {
      inkSoft: resolve("--ink-soft"),
      ink: resolve("--ink"),
      restingMarker: marker(resting),
      restingLabel: label(resting),
      walkedMarker: marker(walked),
      walkedLabel: label(walked),
    };
  });

  expect(paint.restingMarker).toBe(paint.inkSoft);
  expect(paint.restingLabel).toBe(paint.ink);
  expect(paint.restingMarker).not.toBe(paint.restingLabel);

  // The row the keyboard is on, which is not a corner case: the popup seeds its selection
  // to the heading being read on every open, and the filtered view always lands on the
  // first match. The marker must not be dragged up to the label's ink with the row.
  expect(paint.walkedMarker).toBe(paint.inkSoft);
  expect(paint.walkedLabel).toBe(paint.ink);
});

test("compare mode drops both of the popup's entry points (EXC-1097)", async ({ daemon, page }) => {
  // Compare mode tracks no heading, so a contents popup there would open on a stale
  // plan. The trigger is dropped with the surface; the key has to be gated too, or
  // it would summon a component that is no longer mounted.
  await daemon.seedVersions(2, [`# Plan\n\n${filler("Plan")}\n`, TALL_PLAN]);
  await page.goto("/");
  await readingAt(page, "Golf");
  await expect(trigger(page)).toBeVisible();

  await page.getByRole("button", { name: /^Compare versions/ }).click();
  await expect(trigger(page)).toHaveCount(0);

  await page.keyboard.press("\\");
  await expect(panel(page)).toHaveCount(0);
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
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");
  await openToc(page);

  const bands = await measureGuides(page);
  expect(bands).toHaveLength(6);

  for (const [index, band] of bands.entries()) {
    // AC3: the band ends exactly where the text begins, so its rightmost hairline sits
    // one indent step left of the first glyph and every column lines up with the level
    // that opens it. This is what would catch a guide drawn on a grid of its own.
    expect(band.left + band.width).toBeCloseTo(band.padding, 2);
    // This plan opens at `#`, so every band starts at the indent's origin and a row's
    // guide count is exactly its depth. The `##`-rooted spec below is what makes the
    // --toc-depth term in that offset falsifiable; here it contributes nothing.
    expect(band.left).toBeCloseTo(INDENT_ORIGIN_PX, 2);
    // AC8: full row height, and rows that meet — so two same-depth neighbours join
    // instead of striping at the padding-block each row carries.
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
  await daemon.seed({ plan: SHALLOW_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");
  await openToc(page);

  // The plan reaches the UI still rooted at `##` — the daemon's formatter normalizes
  // several things about an incoming plan and this is not one of them, which is what
  // makes the shape reachable rather than hypothetical.
  const depths = await options(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).style.getPropertyValue("--toc-depth")),
  );
  expect(depths).toEqual(["1", "2", "1"]);

  const bands = await measureGuides(page);
  // Every band starts ONE step in from the indent's origin — the column `## Setup`
  // occupies — rather than at the origin itself.
  expect(bands.map((b) => Math.round(b.left))).toEqual([20, 20, 20]);
  // And the plan's own top level still draws nothing: it is a root, not a nested row.
  expect(bands.map((b) => Math.round(b.width))).toEqual([0, 12, 0]);
  for (const band of bands) expect(band.left + band.width).toBeCloseTo(band.padding, 2);
});

test("filtering drops the guides, headers and all", async ({ daemon, page }) => {
  // AC4 and AC6. A filtered row is flush left under a breadcrumb header that carries the
  // hierarchy, so a column beside it would mark a nesting this view does not show — and
  // the header is not a row, so nothing should reach it either.
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");
  await openToc(page);
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
type MotionLog = { type: string; name: string; elapsed: number; easing: string }[];

async function recordDismissal(page: Page, dismiss: () => Promise<void>): Promise<MotionLog> {
  await panel(page).evaluate((el) => {
    const w = window as Window & { __tocMotion?: MotionLog };
    w.__tocMotion = [];
    const log = (event: Event): void => {
      if (event.target !== el) return;
      const animation = event as AnimationEvent;
      w.__tocMotion?.push({
        type: event.type,
        name: animation.animationName,
        elapsed: animation.elapsedTime,
        // Sampled as the exit BEGINS, which is the only moment the closed cascade is
        // live on a real dismissal. Reading it any other way means writing `data-state`
        // by hand — poking an attribute the primitive owns, and starting then cancelling
        // an exit to observe one.
        easing: getComputedStyle(el).animationTimingFunction,
      });
    };
    el.addEventListener("animationstart", log);
    el.addEventListener("animationend", log);
  });
  await dismiss();
  await expect(panel(page)).toHaveCount(0);
  return page.evaluate(() => (window as Window & { __tocMotion?: MotionLog }).__tocMotion ?? []);
}

test("the panel arrives on the enter token and leaves on the exit one", async ({
  daemon,
  page,
}) => {
  // AC1 and AC7 together. The vendored Popover.Content already animates through
  // tw-animate-css, and that machinery is not decoration: bits-ui's portal presence waits
  // on the `animationend` its `enter`/`exit` keyframes fire. So the refinement retimes
  // those keyframes rather than declaring a competing one, and what this spec pins is
  // exactly that — the animation is still tw-animate-css's, and only its timing is now
  // caret's, asymmetric in the direction the vocabulary pairs its two easings for.
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");

  const enterSeconds = await motionToken(page, "--dur-enter");
  const exitSeconds = await motionToken(page, "--dur-exit");
  // The pairing is the claim; two tokens that had drifted to the same number would make
  // every assertion below true while saying nothing.
  expect(enterSeconds).not.toBe(exitSeconds);

  await openToc(page);
  const entering = await animationOf(panel(page));
  // Still the vendored keyframes — a caret-named animation here would mean the exit
  // bits-ui waits on had been replaced.
  expect(entering.name).toBe("enter");
  expect(Number.parseFloat(entering.duration)).toBeCloseTo(enterSeconds, 3);
  const enterEasing = entering.easing;

  const log = await recordDismissal(page, () => page.keyboard.press("Escape"));
  const started = log.find((e) => e.type === "animationstart");
  const ended = log.find((e) => e.type === "animationend");
  expect(started?.name).toBe("exit");
  expect(ended?.name).toBe("exit");
  // `elapsedTime` at animationend is the animation's own active duration, so this is the
  // exit really having run for the exit token's worth of time — not a frame we happened
  // to catch, and not a computed value that would read the same on a cancelled animation.
  expect(ended?.elapsed).toBeCloseTo(exitSeconds, 3);
  // And the curve turns around with it: leaving accelerates out where arriving decelerated
  // in. Sampled off the real exit as it began, so both easings are the same kind of value
  // read on the animation that actually ran.
  expect(started?.easing).not.toBe(enterEasing);
});

test("every way out of the popup is animated, not cut", async ({ daemon, page }) => {
  // AC1 names four paths, and they are not four spellings of one: Escape, an outside
  // click and the trigger are all the primitive's own dismissals — bits-ui runs
  // onOpenChange from its own box setter for exactly those three — while a pick is
  // caret's own `open = false` inside jump(). All four have to reach the same
  // `data-state` flip, or one of them would drop the panel out of the DOM instantly.
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");

  const outsideClick = async (): Promise<void> => {
    // Below the panel's own box, on the plan: the panel hangs off the control row, so a
    // click on the first rows would land on the dismiss layer instead of outside it.
    const panelBox = await panel(page).boundingBox();
    const planBox = await page.locator(PLAN_SURFACE).boundingBox();
    expect(panelBox).not.toBeNull();
    expect(planBox).not.toBeNull();
    await page.mouse.click(planBox!.x + planBox!.width / 2, panelBox!.y + panelBox!.height + 40);
  };

  const paths: [string, () => Promise<void>][] = [
    ["Escape", () => page.keyboard.press("Escape")],
    ["an outside click", outsideClick],
    ["picking a heading", () => options(page).first().click()],
    ["the trigger", () => trigger(page).click()],
  ];

  for (const [name, dismiss] of paths) {
    await openToc(page);
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
  // AC2 and AC3. The header being "in step with its rows" is not two constants that
  // happen to agree — it is one declaration covering both, so the strongest form of the
  // claim is a single equality between what the cascade handed each of them. A header
  // given a duration of its own is exactly the drift that would pop it in above rows that
  // were still fading, and it is what this reds on.
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");
  await openToc(page);

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
  // AC6, and the decision the whole design rests on. The outline is the WHOLE plan — the
  // low hundreds of rows this popup is bounded at — and it mounts all at once, so a row
  // animation scoped to it would start several hundred simultaneous ramps on open and on
  // every clear. The list re-forming carries that direction instead, on one element.
  // TALL_PLAN is the fixture that makes this say something: 25 headings, more than fit.
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");
  await openToc(page);

  const viewport = panel(page).locator("[data-slot='command-viewport']");
  const list = await animationOf(viewport);
  expect(list.name).toMatch(/toc-list-in$/);
  expect(Number.parseFloat(list.duration)).toBeCloseTo(await motionToken(page, "--dur-micro"), 3);

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

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

/** The row ramps the panel is carrying, and how many distinct elements they sit on.
 *
 * `ramps` counts them regardless of play state, which is what makes it a claim about the
 * cascade rather than about the frame this read happened to catch: a finished CSSAnimation
 * stays in `getAnimations()` until its `animation-name` is removed or its element is, so
 * "the rule fired" survives the round-trip even under the gate's contention. `running` is
 * kept separate for the one question that really is about play state — whether it drains.
 *
 * `targets` is the backlog test proper. One ramp per element is the design; two live on
 * the same row would be generations stacking, which is the failure AC4 names. Comparing
 * the two counts says exactly that, where comparing `running` against the element count
 * could not — a single `animation-name` can host at most one CSS animation, so that bound
 * holds by construction and would pass over any implementation at all.
 *
 * Filtered by keyframe name, so the vendored components' Tailwind `transition-all` — a
 * dozen colour and shadow transitions on the trigger and the field, none of them this
 * change's — and the panel's own zoom stay out of both numbers. */
async function motionLoad(
  page: Page,
): Promise<{ ramps: number; targets: number; running: number }> {
  return panel(page).evaluate((el) => {
    const ramps = el
      .getAnimations({ subtree: true })
      .filter((a): a is CSSAnimation => a instanceof CSSAnimation)
      .filter((a) => a.animationName.endsWith("toc-row-in"));
    // `target` lives on KeyframeEffect, not on the AnimationEffect base — a CSSAnimation
    // always carries the former, but the cast has to be explicit for the type checker.
    const targetOf = (a: CSSAnimation): Element | null =>
      a.effect instanceof KeyframeEffect ? a.effect.target : null;
    return {
      ramps: ramps.length,
      targets: new Set(ramps.map(targetOf)).size,
      running: ramps.filter((a) => a.playState === "running").length,
    };
  });
}

test("typing fast queues no animation behind the reviewer", async ({ daemon, page }) => {
  // AC4, asserted as a ratio rather than as a ceiling, because the ceiling turned out to
  // be the wrong intuition. The filtered view is not reliably small: a one-character query
  // matches most of a plan, and the widest crossing measured on the dev plan mounts 59
  // rows and headers at once. That is fine — profiled across it, frame times were
  // indistinguishable from the same burst with this animation disabled (median 8.3ms, p95
  // 9.7ms, no frame over 32ms either way), because mounting the rows is the expense and
  // ramping their opacity is not. What would NOT be fine is generations stacking, so that
  // is what this measures: at most one live ramp per element that could carry one.
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");
  await readingAt(page, "Delta");
  await openToc(page);

  // A broad query first — a bare "a" takes half of TALL_PLAN's sections plus its root, so
  // this is the crossing at its widest, with most of the list arriving in one frame.
  // Derived from the fixture rather than typed, so growing SECTIONS cannot quietly turn
  // this into a narrow query while the assertion stays green.
  const broad = SECTIONS.filter((s) => s.toLowerCase().includes("a")).length + 1;
  await field(page).pressSequentially("a", { delay: 15 });
  await expect(options(page)).toHaveCount(broad);
  const wide = await motionLoad(page);
  // The rule fired at all — this is the arm that reds if the row ramp is ever dropped.
  expect(wide.ramps).toBeGreaterThan(0);
  // And exactly one ramp per element it fired on. Two on one row is a stacked generation.
  expect(wide.ramps).toBe(wide.targets);

  // Then narrowing, fast enough that a per-keystroke retrigger would have several
  // generations overlapping by the last character.
  await field(page).pressSequentially("lpha", { delay: 15 });
  await expect(options(page)).toHaveCount(1);
  const narrow = await motionLoad(page);
  expect(narrow.ramps).toBe(narrow.targets);

  // And it drains: nothing is left running once the reviewer stops.
  await expect.poll(async () => (await motionLoad(page)).running).toBe(0);

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

test("reduced motion collapses the surface and leaves it fully usable", async ({
  daemon,
  page,
}) => {
  // AC5, emulated HERE rather than in playwright.config.ts, and that is a decision rather
  // than a convenience. Turning `reduce` on suite-wide would delete a whole race class
  // from every geometry assertion in this file — but it would also stop the suite ever
  // exercising the animated path in a real engine, which is the entire subject of this
  // change. So the preference is emulated in the one spec that is about it.
  //
  // The guard is global (app.css) and reaches this panel through its `[data-slot]` anchor;
  // there is deliberately no reduced-motion block in the component. It collapses the
  // duration rather than removing the animation, and that distinction is load-bearing:
  // bits-ui's portal presence waits on `animationend`, so an `animation: none` here would
  // strand the panel in the DOM on every dismissal under the preference.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await daemon.seed({ plan: BRANCHED_PLAN });
  await page.goto("/");
  await readingAt(page, "Setup");
  await openToc(page);

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
  await expect(panel(page)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("rollout-notes");
});
