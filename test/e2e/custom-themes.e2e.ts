// Custom themes end to end: theme files in the daemon's themes folder reach the
// Appearance pickers, a picked one repaints the chrome and the highlighted code, and a
// reload paints it from the first frame. This needs a real browser and a real daemon:
// the boot paint from localStorage across a reload, a held GET /api/themes, the portalled
// bits-ui picker, and shiki's colours inside the diff view's shadow DOM. The pure halves —
// building a theme from a file, registering it, the cached palette — are unit-tested in
// ui/src/lib/registerTheme.test.ts and ui/src/lib/appearance.test.ts.

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Page, Route } from "@playwright/test";

import { openSettings } from "@test/e2e/support/chrome.ts";
import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import { seedAndOpen } from "@test/e2e/support/source-view.ts";
import { themeFileText } from "@test/support/theme.ts";

const CARET_DARK_ACCENT = "#ff8f3d";
const NIGHTLY_ACCENT = "#00c2a8";
const NIGHTLY_KEYWORD = "#12ab34";
const NIGHTLY_KEYWORD_RGB = "rgb(18, 171, 52)";
const EDITED_ACCENT = "#c20078";

declare global {
  interface Window {
    accents: string[];
  }
}

async function writeThemes(daemon: Daemon): Promise<void> {
  await writeFile(
    join(daemon.themesDir, "nightly.json"),
    themeFileText("nightly", { accent: NIGHTLY_ACCENT, keyword: NIGHTLY_KEYWORD }),
  );
  await writeFile(
    join(daemon.themesDir, "daylight.json"),
    themeFileText("daylight", { scheme: "light" }),
  );
  await writeFile(join(daemon.themesDir, "broken.json"), "{ not json");
}

/** Pin dark mode on the first load only, so a later reload reads back what the app stored. */
async function pinDark(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem("caret.theme.mode") === null) {
      localStorage.setItem("caret.theme.mode", "dark");
    }
  });
}

/** Record each distinct `--accent` the page paints on `<html>`, from the first frame. */
async function recordAccents(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.accents = [];
    // An init script runs before <html> is parsed, so observe the document instead.
    new MutationObserver(() => {
      const value = document.documentElement?.style.getPropertyValue("--accent") ?? "";
      if (value && value !== window.accents.at(-1)) window.accents.push(value);
    }).observe(document, { attributes: true, attributeFilter: ["style"], subtree: true });
  });
}

function accent(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().toLowerCase(),
  );
}

function rowColors(page: Page, text: string): Promise<string[]> {
  return page.evaluate((needle) => {
    const shadow = document.querySelector(".diffview")?.shadowRoot;
    for (const row of shadow?.querySelectorAll("[data-line]") ?? []) {
      if ((row.textContent ?? "").includes(needle)) {
        return [...row.querySelectorAll("span")].map((s) => getComputedStyle(s).color);
      }
    }
    return [];
  }, text);
}

const darkTrigger = (page: Page) => page.getByRole("button", { name: "Dark theme" });

async function pickNightly(page: Page, daemon: Daemon): Promise<void> {
  await writeThemes(daemon);
  await pinDark(page);
  await seedAndOpen(page, daemon);
  await openSettings(page);
  await darkTrigger(page).click();
  await page.getByRole("option", { name: "nightly", exact: true }).click();
  await expect(page.getByText("Dark theme updated")).toBeVisible();
  await expect.poll(() => accent(page)).toBe(NIGHTLY_ACCENT);
}

test("each custom theme is offered in its scheme's picker, and a broken file is listed", async ({
  daemon,
  page,
}) => {
  await writeThemes(daemon);
  await pinDark(page);
  await seedAndOpen(page, daemon);
  await openSettings(page);

  await darkTrigger(page).click();
  await expect(page.getByRole("option", { name: "Dracula" })).toBeVisible();
  await expect(page.getByRole("option", { name: "nightly", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "daylight", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option", { name: "Dracula" })).toHaveCount(0);

  await page.getByRole("button", { name: "Light theme" }).click();
  await expect(page.getByRole("option", { name: "daylight", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "nightly", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  const broken = page.locator("[data-theme-errors] li", { hasText: "broken.json" });
  await expect(broken).toBeVisible();
  await expect(broken.locator("p").first()).not.toBeEmpty();
});

test("a picked custom theme paints the chrome and the code, and survives a reload", async ({
  daemon,
  page,
}) => {
  await pickNightly(page, daemon);
  await expect.poll(() => rowColors(page, "return Cache")).toContain(NIGHTLY_KEYWORD_RGB);

  await page.reload();
  await openSettings(page);
  await expect(darkTrigger(page)).toContainText("nightly");
  await expect.poll(() => accent(page)).toBe(NIGHTLY_ACCENT);
});

test("a reload paints the picked custom theme before the themes arrive", async ({
  daemon,
  page,
}) => {
  await pickNightly(page, daemon);
  await recordAccents(page);
  let held!: (route: Route) => void;
  const heldRoute = new Promise<Route>((resolve) => {
    held = resolve;
  });
  await page.route("**/api/themes", (route) => held(route));

  await page.reload();
  const route = await heldRoute;
  await expect.poll(() => accent(page)).toBe(NIGHTLY_ACCENT);
  await route.continue();

  await openSettings(page);
  await expect(darkTrigger(page)).toContainText("nightly");
  const accents = await page.evaluate(() => window.accents);
  expect(accents).toContain(NIGHTLY_ACCENT);
  expect(accents).not.toContain(CARET_DARK_ACCENT);
});

test("an edited theme file repaints on reload, straight from the cached palette", async ({
  daemon,
  page,
}) => {
  await pickNightly(page, daemon);
  await writeFile(
    join(daemon.themesDir, "nightly.json"),
    themeFileText("nightly", { accent: EDITED_ACCENT, keyword: NIGHTLY_KEYWORD }),
  );
  await recordAccents(page);

  await page.reload();
  await expect.poll(() => accent(page)).toBe(EDITED_ACCENT);
  expect(await page.evaluate(() => window.accents)).toEqual([NIGHTLY_ACCENT, EDITED_ACCENT]);
});

test("a deleted theme file falls back to caret dark and keeps the selection", async ({
  daemon,
  page,
}) => {
  await pickNightly(page, daemon);
  await rm(join(daemon.themesDir, "nightly.json"));

  await page.reload();
  await expect.poll(() => accent(page)).toBe(CARET_DARK_ACCENT);
  expect(await page.evaluate(() => localStorage.getItem("caret.theme.dark"))).toBe("nightly");
  expect(await page.evaluate(() => localStorage.getItem("caret.theme.mode"))).toBe("dark");
  await openSettings(page);
  await expect(page.locator("[data-theme-summary]")).toContainText("caret dark");
});

test("a failed themes read leaves the built-in themes working", async ({ daemon, page }) => {
  await pinDark(page);
  await page.route("**/api/themes", (route) => route.fulfill({ status: 500 }));
  await seedAndOpen(page, daemon);
  await openSettings(page);

  await darkTrigger(page).click();
  await page.getByRole("option", { name: "Dracula" }).click();
  await expect(page.locator("[data-theme-summary]")).toContainText("Dracula");
  await expect(page.locator("[data-theme-errors]")).toHaveCount(0);
});
