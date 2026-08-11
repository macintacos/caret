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

import { currentCrumb } from "@test/e2e/support/chrome.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
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

test("heading navigation stays reachable at a narrow width", async ({ daemon, page }) => {
  await daemon.seed();
  await page.setViewportSize({ width: TIGHT_WIDTH_PX, height: 900 });
  await page.goto("/");
  await planSurface(page);

  // The breadcrumbs bar took over from the contents rail (EXC-949), and it is the
  // row's first control to give up space as the window tightens — so the narrow
  // regime is exactly where it could be squeezed out of reach. plan-breadcrumbs.e2e.ts
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
