// Rendered-markdown plan view (EXC-693). The single-version surface defaults to
// styled "decorated source" — markdown syntax kept but styled and colored, no
// line-number gutter — while the compare diff stays the source view. These specs
// cover the real-browser behavior the unit tests can't: the default surface, the
// Rendered/Source toggle, click- and drag-to-comment, and that compare is
// unchanged. The unit suites cover the decoration transform and the component.

import { expect, test } from "./support/fixtures.ts";

const PLAN = [
  "# Rendered Plan",
  "",
  "Prose with **bold text** and `inline code` in it.",
  "",
  "- first point",
  "- second point",
  "",
  "## Section Two",
  "",
  "A single line to comment on.",
  "",
].join("\n");

test("defaults to the rendered view: markers kept + colored, no gutter", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");

  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // The bold marker is shown verbatim (asterisks kept) inside a styled span.
  const bold = rendered.locator(".md-strong").first();
  await expect(bold).toHaveText("**bold text**");

  // Decorated text is bold AND a different color from neutral prose.
  const boldWeight = await bold.evaluate((el) => Number(getComputedStyle(el).fontWeight));
  expect(boldWeight).toBeGreaterThanOrEqual(600);
  const boldColor = await bold.evaluate((el) => getComputedStyle(el).color);
  const proseColor = await rendered.evaluate((el) => getComputedStyle(el).color);
  expect(boldColor).not.toBe(proseColor);

  // Inline code keeps its backticks and renders monospace.
  const code = rendered.locator(".md-code").first();
  await expect(code).toHaveText("`inline code`");
  const codeFont = await code.evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
  expect(codeFont).toContain("mono");

  // No source-grid gutter in the rendered view.
  await expect(page.locator(".diffview")).toHaveCount(0);
});

test("the Rendered/Source toggle switches surfaces both ways", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await expect(page.locator(".rendered-plan")).toBeVisible();

  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".diffview")).toBeVisible();
  await expect(page.locator(".rendered-plan")).toHaveCount(0);

  await page.getByRole("button", { name: "Rendered", exact: true }).click();
  await expect(page.locator(".rendered-plan")).toBeVisible();
  await expect(page.locator(".diffview")).toHaveCount(0);
});

test("clicking a rendered line opens a composer and the saved comment renders inline", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  await rendered.locator("[data-line]", { hasText: "A single line to comment on." }).click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await composer.getByRole("textbox", { name: "Comment" }).fill("Comment from the rendered view.");
  await composer.getByRole("button", { name: "Comment" }).click();

  // The saved comment renders inline within the rendered surface.
  await expect(rendered.getByText("Comment from the rendered view.")).toBeVisible();
});

test("dragging across rendered lines opens a range composer", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // List items are genuinely separate source lines (unlike a soft-wrapped
  // paragraph, which caret normalizes to a single line), so a drag across them
  // spans two rows. Move straight down the same column so the hit-test cleanly
  // crosses the row boundary.
  const start = await rendered.locator("[data-line]", { hasText: "first point" }).boundingBox();
  const end = await rendered.locator("[data-line]", { hasText: "second point" }).boundingBox();
  if (start == null || end == null) throw new Error("rendered rows not found");

  const columnX = start.x + start.width / 2;
  await page.mouse.move(columnX, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(columnX, end.y + end.height / 2, { steps: 16 });
  await page.mouse.up();

  // The composer opens for a multi-line span; its label reads "Lines X–Y".
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.locator("p.label")).toHaveText(/Lines \d+–\d+/);
});

test("compare versions stays the source diff and hides the view toggle", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seedVersions(2, [
    "# Rendered Plan\n\nfirst version body.\n",
    "# Rendered Plan\n\nsecond version body.\n",
  ]);
  await page.goto(`/?review=${id}`);
  await expect(page.locator(".rendered-plan")).toBeVisible();

  await page.getByRole("button", { name: "Compare versions" }).click();

  // Compare renders the source diff, and the Rendered/Source toggle is gone.
  await expect(page.locator(".diffview")).toBeVisible();
  await expect(page.locator(".rendered-plan")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rendered", exact: true })).toHaveCount(0);
});
