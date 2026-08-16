// Keyboard shortcuts help (EXC-787). The ? key toggles a modal listing every
// live-registered shortcut; the status bar's keyboard button opens the same
// modal; the search filters. A real ? keystroke, focus, and Escape are
// real-browser behavior (browser-testing.md), so they live here, not in a unit.
//
// waitPastSafeModeGrace is mandatory before the first keystroke: a ? landing
// inside the post-focus grace window is swallowed by Safe Mode (safe-mode.e2e.ts).

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

test("? opens and toggles the help; the bar button opens it; search filters", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const dialog = page.locator("[data-slot='dialog-content']");

  // ? opens the modal and moves focus into it.
  await page.keyboard.press("?");
  await expect(dialog).toBeVisible();
  await expect(page.locator("[data-slot='dialog-title']")).toHaveText(/Shortcuts/);
  const focusInDialog = await page.evaluate(
    () => document.activeElement?.closest("[data-slot='dialog-content']") != null,
  );
  expect(focusInDialog).toBe(true);

  // The registry currently holds the two editor chords + the ? help toggle, so the
  // Editor group and its Esc cap are listed live.
  await expect(dialog).toContainText("Cancel editing");
  await expect(dialog).toContainText("Esc");

  // ? again toggles it closed (the search input is not focused, so the dispatcher
  // still sees the bare ?).
  await page.keyboard.press("?");
  await expect(dialog).toHaveCount(0);

  // The status-bar keyboard button opens the same modal.
  await page.locator("button[aria-label='Keyboard shortcuts']").click();
  await expect(dialog).toBeVisible();

  // Escape dismisses it.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("the search narrows the listed shortcuts", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const dialog = page.locator("[data-slot='dialog-content']");
  await page.locator("button[aria-label='Keyboard shortcuts']").click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Submit comment");

  await page.getByLabel("Search shortcuts").fill("cancel");
  await expect(dialog).toContainText("Cancel editing");
  await expect(dialog).not.toContainText("Submit comment");
});

test("/ focuses the search input without typing a slash; the field shows a / hint", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const dialog = page.locator("[data-slot='dialog-content']");
  const search = page.getByLabel("Search shortcuts");

  // ? opens the modal with focus on the dialog content — the input is not
  // autofocused (:37-40), so ? and Esc keep toggling the modal.
  await page.keyboard.press("?");
  await expect(dialog).toBeVisible();

  // A / hint cap sits in the search field's trailing addon, advertising the shortcut.
  const hint = dialog.locator("[data-slot='input-group-addon']");
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText("/");

  // / moves focus into the search input and is NOT typed — the modal's local
  // handler wins over the global plan-search binding and preventDefaults, so no
  // stray "/" lands in the field.
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");

  // Once focused, typing filters the list normally.
  await page.keyboard.type("cancel");
  await expect(dialog).toContainText("Cancel editing");
  await expect(dialog).not.toContainText("Submit comment");
});
