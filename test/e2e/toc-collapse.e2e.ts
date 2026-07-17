// Collapsible plan ToC rail across the width breakpoints (EXC-809). The fixed
// 15rem SourceToc rail crushes the plan column at narrow widths, so below the
// foundation breakpoints (EXC-806: --w-narrow 960, --w-tight 640) the rail
// collapses and a control-row toggle brings it back. This spec drives the three
// regimes at real viewports — layout that only a browser can decide, so it lives
// here rather than in a component unit (browser-testing.md).

import { expect, test } from "./support/fixtures.ts";

const TOGGLE = "Toggle plan contents";

test("wide width keeps the rail inline with no toggle", async ({ daemon, page }) => {
  await daemon.seed();
  // The fixture viewport (REFERENCE_WIDTH_PX + 200 = 1600) is already ≥ 960.
  await page.goto("/");

  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.locator(".source-toc")).toBeVisible();
  // No collapse affordance when there is room for the rail beside the plan.
  await expect(page.getByRole("button", { name: TOGGLE })).toHaveCount(0);
});

test("tight width collapses the rail by default; the toggle reveals it", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto("/");

  await expect(page.locator(".diff-plan")).toBeVisible();
  const toc = page.locator(".source-toc");
  const toggle = page.getByRole("button", { name: TOGGLE });

  // Auto-collapsed below --w-tight: the plan column gets the full width.
  await expect(toggle).toBeVisible();
  await expect(toc).toBeHidden();

  // The toggle brings the rail back (as an overlay-free inline lane) …
  await toggle.click();
  await expect(toc).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // … and jumping to a heading returns the reader to the full-width default.
  await toc.getByRole("button", { name: "Background", exact: true }).click();
  await expect(toc).toBeHidden();
});

test("narrow width shows the rail by default; the toggle collapses it", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.setViewportSize({ width: 800, height: 800 });
  await page.goto("/");

  await expect(page.locator(".diff-plan")).toBeVisible();
  const toc = page.locator(".source-toc");
  const toggle = page.getByRole("button", { name: TOGGLE });

  // Between --w-tight and --w-narrow the rail still shows, but the toggle is
  // present so the reader can reclaim the width.
  await expect(toggle).toBeVisible();
  await expect(toc).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await toggle.click();
  await expect(toc).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});
