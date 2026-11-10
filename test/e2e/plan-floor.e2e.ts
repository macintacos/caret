// The plan pane's floor. The diff library paints its rows on --diffs-bg, so wherever it
// draws the plan (the source view and the version compare) the pane beyond the rows —
// the scroll-past-end room, the unanchored comment list — lies on that same floor and
// the screen reads as one even surface. The preview draws its own blocks on the paper.
import type { Page } from "@playwright/test";

import { sourceToggle } from "@test/e2e/support/chrome.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

/** The resolved backgrounds of the rows' host, the scroller and the pane's floor, plus the
 * resolved --paper, all in one rgb() form. */
function floors(page: Page) {
  return page.evaluate(() => {
    const bg = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).backgroundColor : null;
    };
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--paper)";
    document.body.appendChild(probe);
    const paper = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { rows: bg(".diffview"), scroller: bg(".diff-plan"), pane: bg(".pane-floor"), paper };
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the source view's pane lies on its rows' floor in ${colorScheme}`, async ({
    daemon,
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await daemon.seed();
    await page.goto("/");
    await planSurface(page);
    await expect(page.locator(".diffview")).toBeVisible();

    const f = await floors(page);
    expect(f.rows).not.toBe("rgba(0, 0, 0, 0)");
    expect(f.scroller).toBe(f.rows);
    expect(f.pane).toBe(f.rows);
  });
}

test("the version compare's pane lies on its rows' floor", async ({ daemon, page }) => {
  await daemon.seedVersions(2, ["# Plan\n\nalpha line one\n", "# Plan\n\nbeta line two\n"]);
  await page.goto("/");
  await planSurface(page);
  await page.getByRole("button", { name: "Versions" }).click();
  await expect(page.getByText("beta line two")).toBeVisible();

  const f = await floors(page);
  expect(f.scroller).toBe(f.rows);
  expect(f.pane).toBe(f.rows);
});

test("the preview's pane lies on the paper", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await sourceToggle(page).click();
  await expect(page.locator(".plan-preview")).toBeVisible();

  const f = await floors(page);
  expect(f.scroller).toBe(f.paper);
  expect(f.pane).toBe(f.paper);
});
