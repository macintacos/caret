// Click-to-copy cwd path + the success alert (EXC-850). Clicking the path in the
// status bar copies the FULL absolute path to the clipboard (the bar only shows the abbreviated
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

/** The cwd control, in the status bar. */
const cwdIn = (page: Page): Locator =>
  page.locator("footer.status-bar").getByRole("button", { name: /^Copy path / });

/** Seed with the deep cwd, grant clipboard permissions, load the plan, and return
 * the cwd control. */
async function openCwdControl(page: Page, daemon: Daemon): Promise<Locator> {
  await daemon.seed({ cwd: CWD });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await planSurface(page);
  return cwdIn(page);
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

/** The cwd control's box, its status bar's, the boxes of the bar's other two segments,
 * and whether its path is cut short. */
const barBoxes = (cwd: Locator) =>
  cwd.evaluate((el) => {
    const box = (node: Element | null | undefined) => {
      const r = node?.getBoundingClientRect();
      return { left: r?.left ?? 0, right: r?.right ?? 0 };
    };
    const bar = el.closest(".status-bar");
    return {
      bar: box(bar),
      own: box(el),
      start: box(bar?.firstElementChild),
      end: box(bar?.lastElementChild),
      truncated:
        (el.firstElementChild?.scrollWidth ?? 0) > (el.firstElementChild?.clientWidth ?? 0),
    };
  });

test("the cwd path sits centred on the status bar", async ({ daemon, page }) => {
  const cwd = await openCwdControl(page, daemon);
  const { bar, own } = await barBoxes(cwd);
  // Within the pixel the bar's uneven side insets, which line up with the plan pane, leave.
  expect(Math.abs((own.left + own.right) / 2 - (bar.left + bar.right) / 2)).toBeLessThanOrEqual(1);
});

test("a path longer than its room shortens to an ellipsis between the bar's other segments", async ({
  daemon,
  page,
}) => {
  await daemon.seed({
    cwd: `/Users/dev/GitLocal/Play/${"a-project-directory-name-far-wider-than-the-room-".repeat(4)}`,
  });
  await page.goto("/");
  await planSurface(page);
  const { own, start, end, truncated } = await barBoxes(cwdIn(page));
  expect(truncated).toBe(true);
  expect(own.left).toBeGreaterThanOrEqual(start.right);
  expect(own.right).toBeLessThanOrEqual(end.left);
});
