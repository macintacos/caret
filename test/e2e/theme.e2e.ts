// Theme switching (EXC-730): the Settings gear opens the theme dropdown, picking
// a theme retints the whole chrome in realtime, and the choice survives a reload
// (it lives in browser localStorage, which outlives daemon runs). The wipe itself
// isn't asserted — view-transition timing is unobservable to a web-first
// assertion — only its end state. The scheme→diff-view threading is unit-covered
// in ui/src/lib/diffview/options.test.ts.

import { expect, test } from "./support/fixtures.ts";

test("the Settings gear switches theme, retinting the UI and persisting across reload", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");

  const html = page.locator("html");
  // Fresh origin (no stored preference) defaults to caret dark.
  await expect(html).toHaveAttribute("data-theme", "dark");

  // Open Settings from the gear and pick caret light.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator(".theme-select").selectOption("caret-light");

  // The whole chrome retints: the root scheme attribute flips and the paper token
  // becomes the light value.
  await expect(html).toHaveAttribute("data-theme", "light");
  const paper = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
  );
  expect(paper).toBe("#fafafa");

  // "Saved between daemon runs" is really browser-origin localStorage — it must
  // survive a reload without the daemon holding any theme state.
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
});
