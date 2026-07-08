// Rendered-markdown plan view (EXC-693). The single-version surface defaults to a
// styled markdown document built from blocks: prose is joined, lists/tables/
// blockquotes and shiki code blocks render properly, emphasis keeps its markers
// visible and colored from caret's palette, and there is no line-number gutter —
// while the compare diff stays the source view. These specs cover the real-browser
// behavior the unit tests can't: the rendered surface and its palette, real shiki
// paint, the Rendered/Source toggle, block-range click/drag commenting, and that
// compare is unchanged. The unit suites carry the exhaustive per-construct coverage.

import { expect, test } from "./support/fixtures.ts";

const PLAN = [
  "# Rendered Plan Title", // 1
  "", // 2
  "Prose with **bold text**, _italic bit_, `inline code`, and a [doc link](https://ex.test/doc).", // 3
  "", // 4
  "This sentence wraps softly", // 5
  "onto a second source line.", // 6
  "", // 7
  "- first bullet", // 8
  "- second bullet", // 9
  "- [ ] a pending task", // 10
  "- [x] a finished task", // 11
  "", // 12
  "> A quoted line here.", // 13
  "> > A nested quote.", // 14
  "", // 15
  "| Col A | Col B |", // 16
  "|:------|------:|", // 17
  "| one | two |", // 18
  "", // 19
  "```ts", // 20
  "const answer = 42;", // 21
  "```", // 22
  "", // 23
  "A closing paragraph to comment on.", // 24
  "",
].join("\n");

/** Parse a computed `rgb()/rgba()` string into channels. */
function rgb(value: string): { r: number; g: number; b: number } {
  const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m == null) throw new Error(`not an rgb color: ${value}`);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

test("defaults to the rendered view: warm palette, visible markers, no gutter", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");

  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // Headings take caret's amber accent, not the earlier cyan — a warm color has
  // red above blue; cyan would be the reverse. This pins the palette regression.
  const headingColor = await rendered
    .locator(".md-h")
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  const hc = rgb(headingColor);
  expect(hc.r).toBeGreaterThan(hc.b);

  // Bold keeps its asterisks, renders bold, and is tinted (warm) — distinct from prose.
  const bold = rendered.locator(".md-strong").first();
  await expect(bold).toHaveText("**bold text**");
  const boldWeight = await bold.evaluate((el) => Number(getComputedStyle(el).fontWeight));
  expect(boldWeight).toBeGreaterThanOrEqual(600);
  const bc = rgb(await bold.evaluate((el) => getComputedStyle(el).color));
  expect(bc.r).toBeGreaterThan(bc.b);
  const proseColor = await rendered.evaluate((el) => getComputedStyle(el).color);
  expect(await bold.evaluate((el) => getComputedStyle(el).color)).not.toBe(proseColor);

  // Inline code keeps its backticks and renders monospace.
  const code = rendered.locator(".md-codespan").first();
  await expect(code).toHaveText("`inline code`");
  expect((await code.evaluate((el) => getComputedStyle(el).fontFamily)).toLowerCase()).toContain(
    "mono",
  );

  // No source grid → no gutter.
  await expect(page.locator(".diffview")).toHaveCount(0);
});

test("renders lists, checkboxes, tables and nested blockquotes properly", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // Real list with real checkboxes reflecting - [ ] / - [x].
  await expect(rendered.locator("ul li")).toHaveCount(4);
  const boxes = rendered.locator('input[type="checkbox"]');
  await expect(boxes).toHaveCount(2);
  expect(await boxes.nth(0).isChecked()).toBe(false);
  expect(await boxes.nth(1).isChecked()).toBe(true);

  // Real table.
  await expect(rendered.locator("table thead th")).toHaveCount(2);
  await expect(rendered.locator("table tbody td").first()).toHaveText("one");

  // Blockquote (with a nested quote) renders as quote elements, and the > markers
  // are gone from the visible text.
  const quote = rendered.locator("blockquote").first();
  await expect(quote).toBeVisible();
  await expect(quote.locator("blockquote")).toHaveCount(1);
  expect(await quote.innerText()).not.toContain(">");
});

test("code blocks render as real shiki panels with the fences hidden", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // Shiki paints asynchronously into a <pre class="shiki"> with per-token spans —
  // the web-first assertion absorbs the async grammar load.
  const shiki = rendered.locator(".md-code-panel pre.shiki");
  await expect(shiki).toBeVisible();
  expect(await shiki.locator("span").count()).toBeGreaterThan(0);
  await expect(shiki).toContainText("const answer = 42;");
  // The ``` fences are dropped — this reads as a code block, not decorated source.
  expect(await shiki.innerText()).not.toContain("```");
});

test("links render as normal links, not markdown source", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  const link = rendered.locator("a.md-link").first();
  await expect(link).toHaveText("doc link");
  await expect(link).toHaveAttribute("href", "https://ex.test/doc");
  // No [..](..) syntax survives into the visible prose.
  const proseText = await rendered.locator('[data-line="3"]').innerText();
  expect(proseText).not.toContain("](");
  expect(proseText).toContain("doc link");
});

test("a soft-wrapped paragraph is joined into a single block", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // The two source lines "This sentence wraps softly" / "onto a second source line."
  // are a single paragraph: one anchored block carries both, rather than the old
  // one-row-per-line rendering that broke them apart.
  const para = rendered.locator("[data-line]", { hasText: "This sentence wraps softly" });
  await expect(para).toHaveCount(1);
  await expect(para).toContainText("onto a second source line.");
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

test("clicking a block opens a composer and the saved comment renders inline", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  await rendered.locator("[data-line]", { hasText: "A closing paragraph to comment on." }).click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await composer.getByRole("textbox", { name: "Comment" }).fill("Comment from the rendered view.");
  await composer.getByRole("button", { name: "Comment" }).click();

  await expect(rendered.getByText("Comment from the rendered view.")).toBeVisible();
});

test("dragging across two blocks opens a range composer", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // The list and the blockquote are two separate blocks; a drag from one to the
  // other spans them (each block is a single anchor, so a within-list drag would
  // not). Move straight down one column so the hit-test cleanly crosses the gap.
  const start = await rendered.locator("[data-line]", { hasText: "first bullet" }).boundingBox();
  const end = await rendered
    .locator("[data-line]", { hasText: "A quoted line here." })
    .boundingBox();
  if (start == null || end == null) throw new Error("rendered blocks not found");

  const columnX = start.x + start.width / 2;
  await page.mouse.move(columnX, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(columnX, end.y + end.height / 2, { steps: 16 });
  await page.mouse.up();

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

  await expect(page.locator(".diffview")).toBeVisible();
  await expect(page.locator(".rendered-plan")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rendered", exact: true })).toHaveCount(0);
});
