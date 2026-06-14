// Reader affordances on the source-view surface (EXC-606). The control bar above
// the plan view lets the reviewer wrap long lines (instead of scrolling them) and
// hide the line-number gutter. Both apply to the single-version source view and
// the version-compare diff alike, and both choices persist across reloads.
//
// The library renders the affordances as attributes on its <pre data-file>: line
// overflow as data-overflow="scroll"|"wrap" and a hidden gutter as a presence
// attribute data-disable-line-numbers. The wrapper applies an option change in
// place (no remount), so a toggle does not recreate the view.

import { expect, test } from "./support/fixtures.ts";

// A long single line forces horizontal overflow, so wrap vs. scroll is a real,
// visible difference rather than a no-op on short text.
const LONG_LINE = `# Plan\n\n${"word ".repeat(80)}done\n`;

const V1 = "# Plan\n\nalpha line one\n";
const V2 = "# Plan\n\nbeta line two\n";

test("wrapping long lines toggles the overflow attribute and persists", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: LONG_LINE });
  await page.goto("/");
  const pre = page.locator(".diffview pre").first();

  // The view starts in the library's default scroll overflow.
  await expect(pre).toHaveAttribute("data-overflow", "scroll");

  await page.getByRole("button", { name: "Wrap lines" }).click();
  // The same instance updates in place — the attribute flips without a remount.
  await expect(pre).toHaveAttribute("data-overflow", "wrap");

  // The choice is remembered: a reload comes back wrapped.
  await page.reload();
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-overflow", "wrap");
});

test("hiding the line-number gutter toggles the attribute and persists", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: V1 });
  await page.goto("/");
  const pre = page.locator(".diffview pre").first();

  // Numbers are shown by default — no disable attribute on the <pre>.
  await expect(page.locator(".diffview pre[data-disable-line-numbers]")).toHaveCount(0);

  await page.getByRole("button", { name: "Line numbers" }).click();
  await expect(pre).toHaveAttribute("data-disable-line-numbers", /.*/);

  // The choice is remembered: a reload comes back with the gutter hidden.
  await page.reload();
  await expect(page.locator(".diffview pre[data-disable-line-numbers]").first()).toBeAttached();
});

test("the reader affordances apply to the compare diff too", async ({ daemon, page }) => {
  await daemon.seedVersions(2, [V1, V2]);
  await page.goto("/");

  // Wrap + hide numbers on the single-version view first.
  await page.getByRole("button", { name: "Wrap lines" }).click();
  await page.getByRole("button", { name: "Line numbers" }).click();

  // Enter compare mode; the diff <pre> picks up the same reader options.
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.getByText("beta line two")).toBeVisible();

  const diffPre = page.locator(".diffview pre").first();
  await expect(diffPre).toHaveAttribute("data-overflow", "wrap");
  await expect(diffPre).toHaveAttribute("data-disable-line-numbers", /.*/);
});
