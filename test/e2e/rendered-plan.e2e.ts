// Rendered-markdown plan view (EXC-693). The single-version surface defaults to a
// styled markdown document built from blocks: prose is joined, lists/tables/
// blockquotes and shiki code blocks render properly, emphasis keeps its markers
// visible and colored from caret's palette, and there is no line-number gutter —
// while the compare diff stays the source view. Interaction is by DISPLAY line: a
// hover paints a full-width band over the whole visual row under the pointer, a
// click comments the source line(s) that row covers, and a drag comments the span.
// These specs cover the real-browser geometry the unit tests can't (happy-dom has no
// layout); the unit suites carry the per-construct and per-row-grouping coverage.

import { expect, test } from "./support/fixtures.ts";

// The daemon reflows the plan on ingest (formatPlanMarkdown: soft-wraps join and
// long lines re-wrap to a print width), so a spec must NOT assume the raw line
// numbers below survive — the long first paragraph re-wraps across two source
// lines (the link lands on the second), the two short "wraps softly" lines join
// into one, and everything after shifts. These specs therefore locate rows by
// content, never by a hard-coded data-line, so they stay correct under reflow.
const PLAN = [
  "# Rendered Plan Title",
  "",
  "Prose with **bold text**, _italic bit_, `inline code`, and a long trailing clause that pushes past the reflow width so this paragraph re-wraps, ending with a [doc link](https://ex.test/doc).",
  "",
  "This sentence wraps softly",
  "onto a second source line.",
  "",
  "## Tasks", // a second heading so the contents pane (≥2 headings) renders
  "",
  "- first bullet",
  "- second bullet",
  "- [ ] a pending task",
  "- [x] a finished task",
  "",
  "> A quoted line here.",
  "> > A nested quote.",
  "",
  "| Col A | Col B |",
  "|:------|------:|",
  "| one | two |",
  "",
  "```ts",
  "const answer = 42;",
  "```",
  "",
  "A closing paragraph to comment on.",
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

test("the reading column is capped at 900px and the contents pane matches the source view", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // The prose wraps rather than sprawling the full viewport width.
  const renderedBox = await rendered.boundingBox();
  expect(renderedBox?.width ?? 0).toBeLessThanOrEqual(900);

  // The contents pane is the same width in both modes (a fixed lane, EXC-693).
  const tocRendered = (await page.locator(".source-toc").boundingBox())?.width ?? 0;
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".diffview")).toBeVisible();
  const tocSource = (await page.locator(".source-toc").boundingBox())?.width ?? 0;
  expect(Math.round(tocRendered)).toBe(Math.round(tocSource));
  expect(tocRendered).toBeGreaterThan(0);
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
  // Each code line is its own per-source-line target (the fence line is dropped).
  await expect(rendered.locator(".md-code-panel [data-line]").first()).toContainText(
    "const answer = 42;",
  );
});

test("links render as normal links, not markdown source", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  const link = rendered.locator("a.md-link").first();
  await expect(link).toHaveText("doc link");
  await expect(link).toHaveAttribute("href", "https://ex.test/doc");
  // No [..](..) markdown syntax survives anywhere in the rendered prose.
  expect(await rendered.innerText()).not.toContain("](");
});

test("a reflow-wrapped paragraph joins into one block with a target per source line", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // The daemon re-wraps the long first paragraph across two source lines; the
  // rendered view joins them into one flowing block (both the bold marker and the
  // trailing link read as one paragraph) yet keeps a [data-line] target per line.
  const para = rendered.locator(".md-paragraph", { hasText: "Prose with" });
  await expect(para).toContainText("doc link");
  expect(await para.locator("[data-line]").count()).toBeGreaterThanOrEqual(2);
});

test("hovering a display line paints one full-width, prominent highlight band", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // Hover the first list item: exactly one hover band appears (not the whole block),
  // it spans the column width (a whole row, not a text slice), and its tint is a
  // clearly-visible amber (alpha well above a faint wash) — the two feedback points.
  const item = rendered.locator("[data-line]", { hasText: "first bullet" });
  await item.hover();
  const band = rendered.locator(".md-hl-hover .md-row-hl");
  await expect(band).toHaveCount(1);

  const colBox = await rendered.boundingBox();
  const bandBox = await band.boundingBox();
  if (colBox == null || bandBox == null) throw new Error("rendered layout missing");
  expect(bandBox.width).toBeGreaterThan(colBox.width * 0.8);

  const alpha = await band.evaluate((el) => {
    const m = getComputedStyle(el).backgroundColor.match(/rgba?\([^)]*?,\s*([\d.]+)\)/);
    return m ? Number(m[1]) : 1; // opaque rgb() (no alpha) counts as fully visible
  });
  expect(alpha).toBeGreaterThan(0.2);
});

test("hovering a line's horizontal whitespace still highlights the whole row", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // Hover the left padding — left of the bullet's text, over no element — and the row
  // still lights up: the whole display line is the affordance, like the source view.
  const containerBox = await rendered.boundingBox();
  const lineBox = await rendered.locator("[data-line]", { hasText: "first bullet" }).boundingBox();
  if (containerBox == null || lineBox == null) throw new Error("rendered layout missing");

  await page.mouse.move(containerBox.x + 6, lineBox.y + lineBox.height / 2);
  await expect(rendered.locator(".md-hl-hover .md-row-hl")).toHaveCount(1);
});

test("clicking a line's horizontal whitespace opens a composer on that line", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // Click in the left padding at the closing paragraph's vertical band — nowhere
  // near the text — and the composer still anchors to that source line. This is the
  // "click anywhere on the row" ergonomic the source view has.
  const containerBox = await rendered.boundingBox();
  const lineBox = await rendered
    .locator("[data-line]", { hasText: "A closing paragraph to comment on." })
    .boundingBox();
  if (containerBox == null || lineBox == null) throw new Error("rendered layout missing");

  await page.mouse.click(containerBox.x + 6, lineBox.y + lineBox.height / 2);

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.locator("p.label")).toHaveText(/Line \d+/);
});

test("headings sit below the prose with clear top spacing", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // The "## Tasks" heading gets more room above it than a plain paragraph block, so
  // sections breathe rather than crowding the prose that precedes them.
  const headingTop = await rendered
    .locator(".md-heading", { hasText: "Tasks" })
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).marginTop));
  const paraTop = await rendered
    .locator(".md-paragraph")
    .first()
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).marginTop));
  expect(headingTop).toBeGreaterThan(paraTop);
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

test("clicking a source line opens a composer on that exact line and saves inline", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // Click the closing paragraph's line; the composer anchors to that single line.
  await rendered.locator("[data-line]", { hasText: "A closing paragraph to comment on." }).click();

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.locator("p.label")).toHaveText(/Line \d+/);
  await composer.getByRole("textbox", { name: "Comment" }).fill("Comment from the rendered view.");
  await composer.getByRole("button", { name: "Comment" }).click();

  await expect(rendered.getByText("Comment from the rendered view.")).toBeVisible();
});

test("opening a composer paints a selection band over its row", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // Click a line to open the composer; its row keeps a persistent selection band
  // (distinct from the transient hover layer) so the anchored line stays marked.
  await rendered.locator("[data-line]", { hasText: "A closing paragraph to comment on." }).click();
  await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
  await expect(rendered.locator(".md-hl-select .md-row-hl").first()).toBeVisible();
});

test("hovering a joined paragraph lights the whole display line, not a source slice", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // The long first paragraph reflows across source lines yet reads as one flowing
  // block. Hover it: the highlight is a full-width display-row band (what the eye
  // calls "the line"), never a mid-paragraph text slice keyed to a source row.
  const para = rendered.locator(".md-paragraph", { hasText: "Prose with" });
  const paraBox = await para.boundingBox();
  const colBox = await rendered.boundingBox();
  if (paraBox == null || colBox == null) throw new Error("rendered layout missing");

  await page.mouse.move(paraBox.x + paraBox.width / 2, paraBox.y + 6);
  const band = rendered.locator(".md-hl-hover .md-row-hl");
  await expect(band).toHaveCount(1);
  const bandBox = await band.boundingBox();
  if (bandBox == null) throw new Error("hover band missing");
  expect(bandBox.width).toBeGreaterThan(colBox.width * 0.8);
});

test("dragging across source lines opens a range composer", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  const rendered = page.locator(".rendered-plan");
  await expect(rendered).toBeVisible();

  // Drag straight down the LEFT PADDING column (not over any text) from a list item
  // to the blockquote; the band hit-test crosses several source lines and opens a
  // range composer — proving you can drag anywhere on the rows, not only their text.
  const containerBox = await rendered.boundingBox();
  const start = await rendered.locator("[data-line]", { hasText: "first bullet" }).boundingBox();
  const end = await rendered
    .locator("[data-line]", { hasText: "A quoted line here" })
    .boundingBox();
  if (containerBox == null || start == null || end == null) {
    throw new Error("rendered lines not found");
  }

  const columnX = containerBox.x + 6;
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
