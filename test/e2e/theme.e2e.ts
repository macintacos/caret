// Theme switching (EXC-730, EXC-761 picker round): the Settings gear opens the
// theme picker — a bits-ui DropdownMenu, not a native select — where the active
// theme reads selected, arrow/j/k navigation previews each theme live while the
// menu stays open, and only Enter / outside-click dismiss it. Picking retints the
// whole chrome (and the shadow-DOM diff view) in realtime and survives a reload
// (it lives in browser localStorage, which outlives daemon runs). The wipe itself
// isn't asserted — view-transition timing is unobservable to a web-first assertion
// — only its end state. The scheme→diff-view threading is unit-covered in
// ui/src/lib/diffview/options.test.ts.

import { expect, test } from "./support/fixtures.ts";

test("the theme picker previews themes live on keyboard nav and persists the pick", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");

  const html = page.locator("html");
  // Fresh origin (no stored preference) defaults to caret dark.
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // A shiki-highlighted token inside the diff view's shadow root — read its
  // resolved color so we can prove the diff view (not just the chrome) retints.
  // The fixture plan's `ts` code block highlights `function` as a keyword.
  const tokenColor = () =>
    page.evaluate(() => {
      const root = document.querySelector(".diffview")?.shadowRoot;
      const span = [...(root?.querySelectorAll("span") ?? [])].find(
        (s) => s.textContent === "function",
      );
      return span ? getComputedStyle(span).color : null;
    });
  expect(await tokenColor()).toBe("rgb(251, 146, 60)"); // caret-dark --accent (#fb923c)

  // Open Settings from the gear, then open the theme picker (a DropdownMenu behind
  // a .float-chip trigger button — no native <select>, EXC-761).
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Theme" }).click();

  // The picker is an open menu listing every theme as a radio option; the active
  // one is checked. This coverage lives here since the option list is portalled and
  // only real in a browser.
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "caret dark" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "caret light" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "caret dark" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Keyboard navigation previews the theme IMMEDIATELY while the menu stays open:
  // ArrowDown moves off caret dark to caret light and retints the whole UI.
  await page.keyboard.press("ArrowDown");
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(menu).toBeVisible();
  const paper = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
  );
  expect(paper).toBe("#fafafa");
  // The shadow-DOM diff view retints too — the same keyword token resolves to the
  // caret-light accent. Guards the scheme→themeType thread end to end.
  await expect.poll(tokenColor).toBe("rgb(194, 65, 12)"); // caret-light --accent (#c2410c)

  // The vim key `k` mirrors ArrowUp: with two themes it wraps back to caret dark,
  // still live, still open.
  await page.keyboard.press("k");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(menu).toBeVisible();

  // Clicking an option selects it and — unlike a native select — keeps the menu
  // open for continued live switching.
  await page.getByRole("menuitemradio", { name: "caret light" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(menu).toBeVisible();

  // Enter commits and dismisses the picker (the theme is already applied); the
  // Settings dialog stays open beneath it.
  const settings = page.getByRole("dialog", { name: "Settings" });
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(settings).toBeVisible();

  // Escape then closes the Settings dialog itself (bits-ui routes the intent through
  // onOpenChange to onClose).
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // "Saved between daemon runs" is really browser-origin localStorage — the last
  // pick must survive a reload without the daemon holding any theme state.
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
});
