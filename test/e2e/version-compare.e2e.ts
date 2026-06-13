// Version compare on the source-view surface (EXC-576). With two or more stored
// versions, a picker lets the reviewer diff any pair, side-by-side or stacked,
// switching the layout at runtime without remounting the view or losing scroll.
// The control is hidden for single-version reviews, and the chosen layout
// persists across reloads.

import { expect, test } from "./support/fixtures.ts";

// Three versions whose bodies each carry a unique, greppable line so a diff
// between a chosen pair is verifiable by visible text.
const V1 = "# Plan\n\nalpha line one\n";
const V2 = "# Plan\n\nbeta line two\n";
const V3 = "# Plan\n\ngamma line three\n";

test("the compare control is hidden for a single-version review", async ({ daemon, page }) => {
  await daemon.seed({ plan: V1 });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.locator(".compare-picker")).toHaveCount(0);
});

test("entering compare mode diffs a chosen non-default pair", async ({ daemon, page }) => {
  await daemon.seedVersions(3, [V1, V2, V3]);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // The picker is available; compare mode is off by default (single-version
  // view), so the body shows the current version.
  await expect(page.locator(".compare-picker")).toBeVisible();
  await page.getByRole("button", { name: "Compare versions" }).click();

  // Default pair is current (v3) vs previous (v2); pick a non-default pair:
  // base = v3, target = v1, so the diff spans the alpha→gamma change.
  await page.locator(".target-select").selectOption("1");

  // Both ends of the chosen pair are visible (Playwright pierces the library's
  // shadow root for text).
  await expect(page.getByText("gamma line three")).toBeVisible();
  await expect(page.getByText("alpha line one")).toBeVisible();
});

test("toggling split↔unified switches layout in place without a remount", async ({
  daemon,
  page,
}) => {
  await daemon.seedVersions(3, [V1, V2, V3]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.getByText("gamma line three")).toBeVisible();

  // The library renders split as data-diff-type="split" and unified as "single".
  const pre = page.locator(".diffview pre").first();
  await expect(pre).toHaveAttribute("data-diff-type", "split");

  await page.getByRole("button", { name: "Unified" }).click();
  // Same element, new layout — switched via setOptions, not recreated.
  await expect(pre).toHaveAttribute("data-diff-type", "single");

  await page.getByRole("button", { name: "Split" }).click();
  await expect(pre).toHaveAttribute("data-diff-type", "split");
});

test("the chosen layout persists across a reload", async ({ daemon, page }) => {
  await daemon.seedVersions(3, [V1, V2, V3]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.getByText("gamma line three")).toBeVisible();
  await page.getByRole("button", { name: "Unified" }).click();
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "single");

  await page.reload();
  await page.getByRole("button", { name: "Compare versions" }).click();
  // The remembered layout drives the initial diff style after reload.
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "single");
});
