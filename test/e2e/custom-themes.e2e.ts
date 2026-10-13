// Custom themes end to end: theme files in the daemon's themes folder reach the
// Appearance pickers, a picked one repaints the chrome and the highlighted code, and a
// reload paints it from the first frame. A file uploaded from Appearance is saved under
// its id and offered, or replaces the theme it names in place, without a reload. This
// needs a real browser and a real daemon: the boot paint from localStorage across a
// reload, a held GET /api/themes, the portalled bits-ui picker, a native file input, and
// shiki's colours inside the diff view's shadow DOM. The pure halves — building a theme
// from a file, registering it, the cached palette — are unit-tested in
// ui/src/lib/registerTheme.test.ts and ui/src/lib/appearance.test.ts, and the stand-in
// reconcile rules in ui/src/state/appearance.test.ts; the upload's daemon half is
// unit-tested in test/core/theme/ and test/core/daemon/server.test.ts.

import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Page, Route } from "@playwright/test";

import { openSettings } from "@test/e2e/support/chrome.ts";
import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import { rowColors, seedAndOpen } from "@test/e2e/support/source-view.ts";
import { themeFileText } from "@test/support/theme.ts";

const CARET_DARK_ACCENT = "#ff8f3d";
const NIGHTLY_ACCENT = "#00c2a8";
const NIGHTLY_KEYWORD = "#12ab34";
// NIGHTLY_KEYWORD as getComputedStyle reports it.
const NIGHTLY_KEYWORD_RGB = "rgb(18, 171, 52)";
const EDITED_ACCENT = "#c20078";
const EDITED_KEYWORD = "#ab1234";
const EDITED_KEYWORD_RGB = "rgb(171, 18, 52)";

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

async function uploadTheme(page: Page, name: string, text: string): Promise<void> {
  await page.locator("[data-theme-upload] input[type=file]").setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
}

async function expectDarkOption(page: Page, name: string): Promise<void> {
  await darkTrigger(page).click();
  await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
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

  const brokenFileRow = page.locator("[data-theme-errors] li", { hasText: "broken.json" });
  await expect(brokenFileRow).toBeVisible();
  await expect(brokenFileRow.locator("p").first()).not.toBeEmpty();
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

test("an uploaded theme is saved under its id and offered without a reload", async ({
  daemon,
  page,
}) => {
  await pinDark(page);
  await seedAndOpen(page, daemon);
  await openSettings(page);

  await uploadTheme(page, "my upload.json", themeFileText("uploaded"));
  await expect(page.locator("[data-theme-upload-status]")).toBeVisible();
  await expectDarkOption(page, "uploaded");
  expect(await readdir(daemon.themesDir)).toContain("uploaded.json");
  expect(await readdir(daemon.themesDir)).not.toContain("my upload.json");
});

test("an invalid upload lists its errors and saves nothing", async ({ daemon, page }) => {
  await writeThemes(daemon);
  const before = (await readdir(daemon.themesDir)).sort();
  await pinDark(page);
  await seedAndOpen(page, daemon);
  await openSettings(page);

  await uploadTheme(page, "bad.json", "{ not json");
  const refusal = page.locator("[data-theme-upload-errors]");
  await expect(refusal).toContainText("bad.json");
  await expect(refusal.locator("li").first()).not.toBeEmpty();
  expect((await readdir(daemon.themesDir)).sort()).toEqual(before);
});

test("uploading a duplicated id leaves one file and clears the load error", async ({
  daemon,
  page,
}) => {
  await writeFile(join(daemon.themesDir, "a.json"), themeFileText("twin"));
  await writeFile(join(daemon.themesDir, "b.json"), themeFileText("twin"));
  await pinDark(page);
  await seedAndOpen(page, daemon);
  await openSettings(page);
  await expect(page.locator("[data-theme-errors]")).toContainText("twin");

  await uploadTheme(page, "twin.json", themeFileText("twin"));
  await expect(page.locator("[data-theme-upload-status]")).toBeVisible();
  await expect(page.locator("[data-theme-errors]")).toHaveCount(0);
  await expectDarkOption(page, "twin");
  const names = await readdir(daemon.themesDir);
  expect(["a.json", "b.json", "twin.json"].filter((n) => names.includes(n))).toEqual(["twin.json"]);
});

test("replacing the selected theme repaints the chrome and the code", async ({ daemon, page }) => {
  await pickNightly(page, daemon);
  await expect.poll(() => rowColors(page, "return Cache")).toContain(NIGHTLY_KEYWORD_RGB);

  const edited = themeFileText("nightly", { accent: EDITED_ACCENT, keyword: EDITED_KEYWORD });
  await uploadTheme(page, "nightly.json", edited);
  await expect.poll(() => accent(page)).toBe(EDITED_ACCENT);
  await expect.poll(() => rowColors(page, "return Cache")).toContain(EDITED_KEYWORD_RGB);
  expect(await page.evaluate(() => localStorage.getItem("caret.theme.cache.dark"))).toContain(
    EDITED_ACCENT,
  );
  expect(await readFile(join(daemon.themesDir, "nightly.json"), "utf8")).toContain(EDITED_ACCENT);
});
