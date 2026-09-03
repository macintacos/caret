// Click-to-copy cwd path + the success alert (EXC-850). Clicking the compare-row
// path copies the FULL absolute path to the clipboard (the row only shows the
// abbreviated form) and raises a success toast bottom-right — with no hover
// popup. Clipboard access + toast render + stacking are real-browser behavior,
// so they are proven here rather than in the happy-dom unit suite (per
// doc/agents/browser-testing.md); the queue's auto-dismiss timing is unit-tested
// deterministically in ui/src/state/alerts.test.ts.

import { alerts } from "@test/e2e/support/chrome.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

// Deep enough that shortCwd abbreviates the display (…/Play/caret) while the copy
// carries the whole absolute path — so the test proves the two genuinely differ.
const CWD = "/Users/dev/GitLocal/Play/caret";

test("clicking the cwd path copies the absolute path and shows a success alert", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ cwd: CWD });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/");
  await planSurface(page);

  const cwd = page.locator(".control-row button.cwd");
  await expect(cwd).toBeVisible();
  // The cwd shows the abbreviated path, not the full one.
  await expect(cwd).toHaveText("…/Play/caret");

  // No hover popup — that is the whole point of EXC-850. Hovering surfaces no
  // portalled tooltip.
  await cwd.hover();
  await expect(page.locator("[data-slot='tooltip-content']")).toHaveCount(0);

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
  await daemon.seed({ cwd: CWD });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/");
  await planSurface(page);

  const cwd = page.locator(".control-row button.cwd");
  await cwd.click();
  await cwd.click();

  // Two copies in quick succession stack (oldest on top, newer underneath).
  await expect(alerts(page)).toHaveCount(2);

  await alerts(page).first().getByRole("button", { name: "Dismiss" }).click();
  await expect(alerts(page)).toHaveCount(1);
});
