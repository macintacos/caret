// Review switcher (EXC-760): with more than one pending plan the TopBar shows a
// shadcn DropdownMenu whose trigger carries the active title + a count Badge and
// whose items switch the active plan. The open/list/pick interaction is bits-ui
// overlay behavior (portalled, pointer/keyboard driven), so it is proven here in
// a real browser rather than in the happy-dom unit suite (per
// doc/agents/browser-testing.md). Two distinct plans are seeded (distinct
// sessions → two pending reviews) so a switch is observable in the trigger.

import { expect, test } from "@test/e2e/support/fixtures.ts";

test("switches the active plan through the dropdown, both ways", async ({ daemon, page }) => {
  await daemon.seed({ title: "Plan Alpha", cwd: "/tmp/proj-alpha" });
  await daemon.seed({ title: "Plan Beta", cwd: "/tmp/proj-beta" });

  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // The trigger shows a count Badge for the two pending plans.
  const trigger = page.locator(".switcher-trigger");
  await expect(trigger).toBeVisible();
  await expect(trigger.locator(".count")).toHaveText("2");

  // Open the menu: both plans are listed as menu items.
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Plan Alpha" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Plan Beta" })).toBeVisible();

  // Pick Alpha → the trigger reflects it as the active plan.
  await page.getByRole("menuitem", { name: "Plan Alpha" }).click();
  await expect(trigger.locator(".title")).toHaveText("Plan Alpha");

  // Pick Beta → the active plan switches back the other way, proving the wiring
  // isn't a no-op that only ever lands on the initial selection.
  await trigger.click();
  await page.getByRole("menuitem", { name: "Plan Beta" }).click();
  await expect(trigger.locator(".title")).toHaveText("Plan Beta");
});

test("Escape closes the switcher menu, leaving the active plan unchanged", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ title: "Plan Alpha", cwd: "/tmp/proj-alpha" });
  await daemon.seed({ title: "Plan Beta", cwd: "/tmp/proj-beta" });

  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const trigger = page.locator(".switcher-trigger");
  await trigger.click();
  const alpha = page.getByRole("menuitem", { name: "Plan Alpha" });
  await expect(alpha).toBeVisible();

  const before = await trigger.locator(".title").textContent();
  // Retry Escape until the menu closes: bits-ui attaches its dismiss listener a
  // tick after the content becomes visible, so a single immediate press can race
  // it (no fixed sleep — toPass polls the web-first assertion).
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(alpha).toBeHidden({ timeout: 500 });
  }).toPass();
  // The title is untouched — Escape dismisses without selecting.
  await expect(trigger.locator(".title")).toHaveText(before ?? "");
});
