// EXC-814: narrow-width cohesion regression — the integration guard for the
// EXC-770 responsive effort. The per-surface specs (topbar-overflow,
// version-compare, pinned-chrome, dialog-narrow) each own one surface in detail;
// this spec asserts the *whole* review UI stays usable at the canonical breakpoints
// — heading navigation and the TopBar's secondary actions stay reachable, comment
// cards stay inside the plan column, and no surface pushes the document past the
// viewport. Width- and layout-driven behavior only a browser can decide
// (doc/agents/browser-testing.md), so it lives here.
//
// Breakpoints are imported from ui/src/lib/layout.ts — the canonical source the
// @media px literals mirror, and the same node-free constants playwright.config.ts
// already derives its viewport from — so this spec tracks the real breakpoints
// instead of hardcoding regime literals.

import type { Page } from "@playwright/test";

import { currentCrumb } from "@test/e2e/support/chrome.ts";
import { makeProject } from "@test/e2e/support/file-refs.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { PLAN_SURFACE, planSurface } from "@test/e2e/support/source-view.ts";
import { MIN_APP_WIDTH_PX, NARROW_WIDTH_PX, TIGHT_WIDTH_PX } from "@ui/src/lib/layout.ts";

test("no surface overflows the viewport horizontally across the breakpoint sweep", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  // The layout is designed to fit down to MIN_APP_WIDTH_PX and only scroll
  // horizontally *below* that floor, so at each breakpoint the document must not
  // exceed the viewport. A long cwd used to blow the floor by ~50px (EXC-814); the
  // plan's wide code scrolls inside its own pane rather than the document, so it
  // cannot blow the floor either. expect.poll absorbs the
  // matchMedia-driven reflow after each resize; the 1px slack covers sub-pixel
  // rounding of scrollWidth, well under any real regression.
  for (const width of [NARROW_WIDTH_PX, TIGHT_WIDTH_PX, MIN_APP_WIDTH_PX]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
        message: `document overflows the ${width}px viewport horizontally`,
      })
      .toBeLessThanOrEqual(1);
  }
});

// How far a run of parts that should stand side by side inside `bounds` crowds it: the
// most any part runs into the one before it, or the run past the bounds' edges. A part
// that is not on screen, such as a dropped hint lip, is skipped. The pane and the crumb
// slot clip, so a crowded header never reaches the document's scrollWidth.
const crowding = (page: Page, bounds: string, parts: string[]) =>
  page.evaluate(
    ({ bounds, parts }) => {
      const edge = document.querySelector(bounds)?.getBoundingClientRect();
      if (edge === undefined) return Number.NaN;
      let worst = 0;
      let reached = edge.left;
      for (const part of parts) {
        const el = document.querySelector(part);
        if (el === null || !el.checkVisibility()) continue;
        const box = el.getBoundingClientRect();
        worst = Math.max(worst, reached - box.left);
        reached = box.right;
      }
      return Math.max(worst, reached - edge.right);
    },
    { bounds, parts },
  );

const HEADER = ".plan-header";
const OUTLINE_TRAY = ".plan-header > .header-tray";
const VIEW_TRAY = ".compare-picker > .header-tray";
const FIND_ROW = [
  ".plan-search :is(.search-field, .search-stamp)",
  ".plan-search .search-actions",
  ".plan-search .search-lip",
  ".plan-search .search-close-tray",
];

// The room the query itself gets: the field's text box inside its padding, or the stamp's
// query. Five characters is about 3rem; the pixel off it is rounding.
const QUERY_FLOOR_PX = 47;
const queryRoom = (page: Page) =>
  page.evaluate(() => {
    const input = document.querySelector<HTMLElement>(".plan-search .search-input");
    if (input !== null) {
      const style = getComputedStyle(input);
      return (
        input.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight)
      );
    }
    const query = document.querySelector(".plan-search .search-stamp-query");
    return query?.getBoundingClientRect().width ?? 0;
  });

const fits = (page: Page, bounds: string, parts: string[], message: string) =>
  expect.poll(() => crowding(page, bounds, parts), { message }).toBeLessThanOrEqual(1);

// Opens the find row over the crumbs, as the field and then as the committed stamp, and
// holds each to the header it sits in: nothing crowds, the query keeps five characters,
// and Close stays in reach. Closes it again.
async function findRowFits(page: Page, where: string): Promise<void> {
  await page.keyboard.press("/");
  await page.keyboard.type("revised step");
  await expect(page.getByRole("search")).toBeVisible();
  await fits(page, ".crumb-slot", FIND_ROW, `the find row crowds its slot ${where}`);
  await fits(page, HEADER, [OUTLINE_TRAY, ".crumb-slot", VIEW_TRAY], `the header crowds ${where}`);
  await expect
    .poll(() => queryRoom(page), { message: `the field squeezes its query ${where}` })
    .toBeGreaterThanOrEqual(QUERY_FLOOR_PX);
  // Committed, the query is a stamp and the lip names the stepping keys instead.
  await page.keyboard.press("Enter");
  await expect(page.locator(".plan-search .search-stamp")).toBeVisible();
  await fits(page, ".crumb-slot", FIND_ROW, `the stamped find row crowds its slot ${where}`);
  await expect
    .poll(() => queryRoom(page), { message: `the stamp squeezes its query ${where}` })
    .toBeGreaterThanOrEqual(QUERY_FLOOR_PX);
  // A query that matches nothing has the longest count.
  await page.keyboard.press("/");
  await page.keyboard.type("qqzx");
  await expect(page.getByRole("textbox", { name: "Search plan" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await fits(page, ".crumb-slot", FIND_ROW, `the unmatched find row crowds its slot ${where}`);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("search")).toHaveCount(0);
}

// The plan header holds the most at once while a search is open over the crumbs, and
// while comparing, when the pair and its controls take the crumbs' place. Each is swept
// with the outline column out where the window has room for it (960px) and folded into
// the header's key below that. Hints are on, so every key carries its cap.
test("the find row and the compare controls fit the plan header across the sweep", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.addVersion(id, "# Plan\n\n## Setup\n\nA revised step.\n");
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const width of [NARROW_WIDTH_PX, TIGHT_WIDTH_PX, MIN_APP_WIDTH_PX]) {
    await page.setViewportSize({ width, height: 900 });
    await findRowFits(page, `at ${width}px`);
    await expect
      .poll(overflow, { message: `the header overflows the ${width}px viewport` })
      .toBeLessThanOrEqual(1);

    await page.keyboard.press("d");
    await expect(page.locator(".plan-header .pair")).toBeVisible();
    await expect
      .poll(overflow, { message: `the compare controls overflow the ${width}px viewport` })
      .toBeLessThanOrEqual(1);
    await fits(
      page,
      HEADER,
      [OUTLINE_TRAY, ".compare-picker .pair", ".compare-picker .controls", VIEW_TRAY],
      `the compare header crowds at ${width}px`,
    );
    // The latched Versions key is the pointer's way back out.
    await page.getByRole("button", { name: /^Versions/ }).click();
    await expect(page.locator(".plan-header .pair")).toHaveCount(0);
  }
});

const FILE_PLAN = "# Refs\n\n## Cache\n\nA revised step keeps the cache in `src/cache.ts`.\n";

async function openFile(page: Page): Promise<void> {
  await planSurface(page);
  await waitPastSafeModeGrace(page);
  await page.locator("[data-file-ref]").first().click();
  await expect(page.locator("[data-file-preview]")).toBeVisible();
}

// A 960px window is the narrowest that docks a file beside the plan, at the drawer's
// opening share.
test("the find row keeps its query beside a file at 960px", async ({ daemon, page }) => {
  const proj = await makeProject({ "src/cache.ts": "export const cache = new Map();\n" });
  try {
    await daemon.seed({ cwd: proj.dir, plan: FILE_PLAN });
    await page.setViewportSize({ width: NARROW_WIDTH_PX, height: 900 });
    await page.goto("/");
    await openFile(page);
    await findRowFits(page, "beside a file at 960px");
  } finally {
    await proj.cleanup();
  }
});

// A drawer dragged as wide as it goes leaves the plan pane no narrower than the narrowest
// window does, so the header holds all it holds there.
for (const hints of ["on", "off"]) {
  test(`a wide file drawer leaves the plan header its room, hints ${hints}`, async ({
    daemon,
    page,
  }) => {
    const proj = await makeProject({ "src/cache.ts": "export const cache = new Map();\n" });
    try {
      await page.addInitScript((value) => {
        localStorage.setItem("caret.shortcutHints", value);
        localStorage.setItem("caret.fileDrawer.width", "1400");
      }, hints);
      await daemon.seed({ cwd: proj.dir, plan: FILE_PLAN });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await openFile(page);
      await fits(page, HEADER, [OUTLINE_TRAY, ".crumb-slot", VIEW_TRAY], "the header crowds");
      await expect(page.locator(".plan-header .plan-breadcrumbs")).toBeVisible();
      await findRowFits(page, "beside a wide file");
    } finally {
      await proj.cleanup();
    }
  });
}

test("heading navigation stays reachable at a narrow width", async ({ daemon, page }) => {
  await daemon.seed();
  await page.setViewportSize({ width: TIGHT_WIDTH_PX, height: 900 });
  await page.goto("/");
  await planSurface(page);

  // The breadcrumbs are the plan header's first control to give up space as the window
  // tightens — so the narrow regime is exactly where they could be squeezed out of
  // reach. plan-breadcrumbs.e2e.ts
  // owns the bar's own behaviour; here we only guard that it survives the squeeze
  // with its menu still openable.
  const crumb = currentCrumb(page);
  await expect(crumb).toBeVisible();
  await crumb.click();
  await expect(page.locator("[data-slot='dropdown-menu-content']")).toBeVisible();
});

test("a seeded comment card fits within the plan column at a narrow width", async ({
  daemon,
  page,
}) => {
  // The inline comment card (SourceAnnotationThread) caps at min(46rem, 100%), so a
  // comment never overflows its plan column even when the column is squeezed. The
  // sweep above cannot catch this: the card overflows a column that scrolls
  // internally, so document.scrollWidth never moves. Originally EXC-809 criterion 2
  // in toc-collapse.e2e.ts; it outlived the rail EXC-949 deleted, so it moved here.
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [
      {
        id: "ann-1",
        startLine: 7,
        endLine: 8,
        comment:
          "A comment long enough to wrap across a couple of lines once the plan column is squeezed to a narrow width.",
      },
    ],
  });
  await page.setViewportSize({ width: 500, height: 900 });
  await page.goto("/");
  await planSurface(page);

  // Measured on the comment text (which the capped card bounds) in viewport
  // coordinates, so the shadow-projected card and its light-DOM container are
  // directly comparable.
  const comment = page.getByText("A comment long enough to wrap").first();
  await expect(comment).toBeVisible();
  const commentBox = await comment.boundingBox();
  const planBox = await page.locator(PLAN_SURFACE).boundingBox();
  expect(commentBox).not.toBeNull();
  expect(planBox).not.toBeNull();
  expect(commentBox!.x + commentBox!.width).toBeLessThanOrEqual(planBox!.x + planBox!.width + 1);
});

test("TopBar secondary actions stay reachable via the overflow menu at a narrow width", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.setViewportSize({ width: TIGHT_WIDTH_PX, height: 900 });
  await page.goto("/");
  await planSurface(page);

  // Below --w-narrow the inline Reject / Request-changes buttons collapse into the
  // "More actions" overflow menu (EXC-810); the integration guarantee is that they
  // remain reachable there rather than disappearing. topbar-overflow.e2e.ts owns the
  // per-variant detail. TopBar hides them with `display: none`, so these read as
  // absences only because a role query cannot see outside the accessibility tree.
  await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request changes" })).toHaveCount(0);
  const overflow = page.getByRole("button", { name: "More actions" });
  await expect(overflow).toBeVisible();
  await overflow.click();
  await expect(page.getByRole("menuitem", { name: "Request changes" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Reject" })).toBeVisible();
});
