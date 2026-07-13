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
  const darkKeyword = await tokenColor();
  expect(darkKeyword).toBe("rgb(251, 146, 60)"); // caret-dark --accent (#fb923c)

  // Open Settings from the gear, then pick caret light from the shadcn Select
  // (a bits-ui listbox behind a button trigger — no native <select> anymore,
  // EXC-761; the Select trigger renders as a button, not a combobox).
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Theme" }).click();
  // The picker lists every theme — this coverage moved off the unit test, since
  // the option list is portalled and only real in a browser.
  await expect(page.getByRole("option", { name: "caret dark" })).toBeVisible();
  await expect(page.getByRole("option", { name: "caret light" })).toBeVisible();
  await page.getByRole("option", { name: "caret light" }).click();

  // The whole chrome retints: the root scheme attribute flips and the paper token
  // becomes the light value.
  await expect(html).toHaveAttribute("data-theme", "light");
  const paper = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
  );
  expect(paper).toBe("#fafafa");

  // The shadow-DOM diff view retints too: the same keyword token now resolves to
  // the caret-light accent. This guards the scheme→themeType thread end to end
  // (App → DiffPlanView reactive options → the library) — a plain-const
  // readerOptions would leave the diff on the dark theme and fail here.
  await expect.poll(tokenColor).toBe("rgb(194, 65, 12)"); // caret-light --accent (#c2410c)

  // Escape closes the Settings dialog — the bits-ui Escape intent routes through
  // onOpenChange to the onClose prop (EXC-761's one-line dismiss wiring).
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // "Saved between daemon runs" is really browser-origin localStorage — it must
  // survive a reload without the daemon holding any theme state.
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
});
