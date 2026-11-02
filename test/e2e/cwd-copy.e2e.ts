// Click-to-copy cwd path + the success alert (EXC-850). Clicking the path at the
// outline's foot copies the FULL absolute path to the clipboard (the row only shows the abbreviated
// form) and raises a success toast bottom-right. Clipboard access + toast render +
// stacking are real-browser behavior, so they are proven here rather than in the
// happy-dom unit suite (per doc/agents/browser-testing.md); the queue's auto-dismiss
// timing is unit-tested deterministically in ui/src/state/alerts.test.ts.

import type { Locator, Page } from "@playwright/test";

import { alerts } from "@test/e2e/support/chrome.ts";
import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

// Deep enough that shortCwd abbreviates the display (…/Play/caret) while the copy
// carries the whole absolute path — so the test proves the two genuinely differ.
const CWD = "/Users/dev/GitLocal/Play/caret";

/** Seed with the deep cwd, grant clipboard permissions, load the plan, and return
 * the cwd control. */
async function openCwdControl(page: Page, daemon: Daemon): Promise<Locator> {
  await daemon.seed({ cwd: CWD });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await planSurface(page);
  return page.locator(".plan-outline button.cwd");
}

test("clicking the cwd path copies the absolute path and shows a success alert", async ({
  daemon,
  page,
}) => {
  const cwd = await openCwdControl(page, daemon);
  await expect(cwd).toBeVisible();
  // The cwd shows the abbreviated path, not the full one.
  await expect(cwd).toHaveText("…/Play/caret");

  await cwd.click();

  const alert = alerts(page);
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("data-variant", "success");
  await expect(alert).toContainText("Copied path to clipboard");

  // The clipboard carries the FULL absolute path, not the abbreviated display.
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(CWD);
});

test("success alerts stack and a dismiss removes one", async ({ daemon, page }) => {
  const cwd = await openCwdControl(page, daemon);
  await cwd.click();
  await cwd.click();

  await expect(alerts(page)).toHaveCount(2);

  await alerts(page).first().getByRole("button", { name: "Dismiss" }).click();
  await expect(alerts(page)).toHaveCount(1);
});

/** The cwd control's box, the box of the outline foot it sits in, and whether its path is
 * cut short. */
const footBoxes = (cwd: Locator) =>
  cwd.evaluate((el) => {
    const foot = el.parentElement?.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    return {
      foot: { left: foot?.left ?? 0, right: foot?.right ?? 0 },
      own: { left: own.left, right: own.right },
      truncated:
        (el.firstElementChild?.scrollWidth ?? 0) > (el.firstElementChild?.clientWidth ?? 0),
    };
  });

test("the cwd path sits centred at the outline's foot", async ({ daemon, page }) => {
  const cwd = await openCwdControl(page, daemon);
  const { foot, own } = await footBoxes(cwd);
  const style = await cwd.evaluate((el) => getComputedStyle(el.parentElement as Element));
  const padLeft = Number.parseFloat(style.paddingLeft);
  const padRight = Number.parseFloat(style.paddingRight);
  expect(own.left - (foot.left + padLeft)).toBeCloseTo(foot.right - padRight - own.right, 0);
});

test("a path longer than the column shortens to an ellipsis inside the foot", async ({
  daemon,
  page,
}) => {
  await daemon.seed({
    cwd: "/Users/dev/GitLocal/Play/a-project-directory-name-far-wider-than-the-outline",
  });
  await page.goto("/");
  await planSurface(page);
  const cwd = page.locator(".plan-outline button.cwd");
  const { foot, own, truncated } = await footBoxes(cwd);
  expect(truncated).toBe(true);
  expect(own.left).toBeGreaterThanOrEqual(foot.left);
  expect(own.right).toBeLessThanOrEqual(foot.right);
});
