// Interactive controls show the pointer (hand) cursor. Tailwind v4's Preflight no
// longer sets cursor:pointer on <button>, and the shadcn Button recipe adds none,
// so buttons and menu actions showed the default arrow. This asserts the hand
// affordance is universal across caret's light-DOM buttons and the dropdown menu
// items. Computed cursor is real rendering, so this is an e2e, not a unit
// (doc/agents/browser-testing.md). querySelectorAll doesn't pierce shadow roots,
// so the diff library's own buttons are naturally out of scope.

import { expect, test } from "./support/fixtures.ts";

test("every enabled button and menu action shows the pointer cursor", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // Every button the user can actually click: visible and enabled. A disabled
  // control ([disabled] or aria-disabled) correctly keeps the default arrow, so it
  // is excluded rather than expected to show the pointer.
  const buttons = await page.$$eval("button", (els) =>
    els
      .filter((el) => {
        const e = el as HTMLButtonElement;
        const s = getComputedStyle(e);
        return (
          !e.disabled &&
          e.getAttribute("aria-disabled") !== "true" &&
          s.pointerEvents !== "none" &&
          e.offsetParent !== null
        );
      })
      .map((el) => ({
        label: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40),
        cursor: getComputedStyle(el).cursor,
      })),
  );
  // Sanity: the seeded review renders a topbar full of buttons — guard against a
  // selector that silently matched nothing and passed vacuously.
  expect(buttons.length).toBeGreaterThan(5);
  expect(buttons.filter((b) => b.cursor !== "pointer")).toEqual([]);

  // The ⋯ overflow menu (the reported case): its items must show the pointer too.
  await page.setViewportSize({ width: 500, height: 800 });
  await page.getByRole("button", { name: /More actions/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  const items = await page.$$eval(
    "[role=menuitem], [role=menuitemradio], [role=menuitemcheckbox]",
    (els) =>
      els
        .filter((el) => {
          const e = el as HTMLElement;
          return e.getAttribute("aria-disabled") !== "true" && e.offsetParent !== null;
        })
        .map((el) => ({
          label: (el.textContent || "").trim().slice(0, 40),
          cursor: getComputedStyle(el).cursor,
        })),
  );
  expect(items.length).toBeGreaterThan(0);
  expect(items.filter((i) => i.cursor !== "pointer")).toEqual([]);
});
