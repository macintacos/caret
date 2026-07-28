// The plan ToC rail is chrome, not plan surface (EXC-900): its rows read in the
// UI's sans (Geist, via --font-sans) like the rest of caret's chrome, while the
// plan rendered beside it stays in the monospace face. Resolving --font-sans to a
// real family needs the token sheet and a real cascade, which happy-dom does not
// provide, so this is an e2e rather than a component unit (browser-testing.md).

import { expect, test } from "@test/e2e/support/fixtures.ts";

// Two headings is the floor for the rail to render at all (shouldShowToc).
const PLAN = [
  "# Alpha",
  "Alpha body line so the plan surface has code lines to measure.",
  "## Bravo",
  "Bravo body line.",
  "",
].join("\n\n");

test("the ToC rail reads in the UI sans while the plan surface stays mono", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const toc = page.locator(".source-toc");
  await expect(toc).toBeVisible();

  // The rows are the rail's body: chrome sans, not the plan's mono.
  const rowFont = await toc
    .locator(".toc-row")
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(rowFont).toMatch(/^Geist/);

  // The filter above them already inherits the sans; pinned so the rail reads as
  // one typographic surface rather than two.
  const filterFont = await page
    .getByLabel("Filter headings")
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(filterFont).toMatch(/^Geist/);

  // Contrast guard: the swap must not leak into the plan's monospace surface.
  const planFont = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const line = sh?.querySelector("[data-line] span") ?? sh?.querySelector("[data-line]");
    return line ? getComputedStyle(line).fontFamily : null;
  });
  expect(planFont).toContain("Berkeley Mono");
});
