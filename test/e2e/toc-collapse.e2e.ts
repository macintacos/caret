// Collapsible plan ToC rail (EXC-809). The fixed 15rem SourceToc rail crushes the
// plan column at narrow widths, so it is collapsible: a control-row toggle is
// always available (whenever the plan has a contents pane), the reviewer's
// open/collapsed choice is remembered across plans and reloads, and absent a saved
// choice the first load defaults by width (collapsed below --w-tight, open above).
// This is viewport- and storage-driven layout that only a browser can decide, so it
// lives here rather than in a component unit (browser-testing.md).
//
// The rail collapses by animating its lane width to 0 (not display:none), so the
// state is asserted on the toggle's aria-expanded plus the #plan-toc lane width.

import { expect, test } from "./support/fixtures.ts";

const TOGGLE = "Toggle plan contents";

test("the toggle is always present and collapses the rail at wide width", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  // The fixture viewport (REFERENCE_WIDTH_PX + 200 = 1600) is above every breakpoint.
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const toggle = page.getByRole("button", { name: TOGGLE });
  const rail = page.locator("#plan-toc");
  // Available even at full width, with the rail open by default there.
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(rail).not.toHaveCSS("width", "0px");

  // The toggle left-aligns with the rail's filter input directly below it
  // (EXC-809 follow-up): the control row's left padding is the rail's inner
  // padding, so the first control and the filter share one left edge.
  const filter = page.getByLabel("Filter headings");
  await expect(filter).toBeVisible();
  const toggleBox = await toggle.boundingBox();
  const filterBox = await filter.boundingBox();
  expect(toggleBox).not.toBeNull();
  expect(filterBox).not.toBeNull();
  expect(Math.abs(toggleBox!.x - filterBox!.x)).toBeLessThanOrEqual(1);

  // Collapsing zeroes the rail lane so the plan reclaims the full width.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(rail).toHaveCSS("width", "0px");

  // And reopening restores it.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(rail).not.toHaveCSS("width", "0px");
});

test("the rail auto-collapses below --w-tight on first load", async ({ daemon, page }) => {
  await daemon.seed();
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const toggle = page.getByRole("button", { name: TOGGLE });
  const rail = page.locator("#plan-toc");
  // No saved preference yet + a tight viewport → collapsed by default, toggle still there.
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(rail).toHaveCSS("width", "0px");

  // The toggle reveals it on demand.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(rail).not.toHaveCSS("width", "0px");
});

test("the collapse preference persists across a reload", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/"); // wide → open by default
  await expect(page.locator(".diff-plan")).toBeVisible();

  const toggle = page.getByRole("button", { name: TOGGLE });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // Remembered: a reload (standing in for loading another plan) restores it collapsed.
  await page.reload();
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByRole("button", { name: TOGGLE })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.locator("#plan-toc")).toHaveCSS("width", "0px");
});

test("a seeded comment card fits within the plan column at narrow width", async ({
  daemon,
  page,
}) => {
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
  await expect(page.locator(".diff-plan")).toBeVisible();

  // The inline comment card (SourceAnnotationThread) caps at min(46rem, 100%), so
  // the comment never overflows its plan column even when the column is squeezed —
  // EXC-809 criterion 2. Measured on the comment text (which the capped card
  // bounds) in viewport coordinates, so the shadow-projected card and its
  // light-DOM container are directly comparable.
  const comment = page.getByText("A comment long enough to wrap").first();
  await expect(comment).toBeVisible();
  const commentBox = await comment.boundingBox();
  const planBox = await page.locator(".diff-plan").boundingBox();
  expect(commentBox).not.toBeNull();
  expect(planBox).not.toBeNull();
  expect(commentBox!.x + commentBox!.width).toBeLessThanOrEqual(planBox!.x + planBox!.width + 1);
});
