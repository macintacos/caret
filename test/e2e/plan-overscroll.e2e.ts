// Scroll-beyond-last-line (EXC-772): the reader can scroll past the end of the
// plan so the last visible line rests about two-thirds down the viewport rather
// than pinned to the bottom edge, leaving ~1/3 of the viewport of overscroll
// room below it. Real scroll behavior → an e2e, per browser-testing.md.

import { expect, test } from "@test/e2e/support/fixtures.ts";

// A plan several viewports tall, so there is genuine scrolling to the bottom
// and a clearly-rendered last line to measure.
const filler = (label: string) =>
  Array.from({ length: 40 }, (_, i) => `${label} line ${i + 1} keeps the plan tall.`).join("\n");
const TALL_PLAN = [
  "# Alpha",
  filler("Alpha"),
  "## Bravo",
  filler("Bravo"),
  "## Charlie",
  filler("Charlie"),
  "",
].join("\n\n");

test("the reader can scroll past the end of the plan", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");

  const view = page.locator(".diff-plan");
  await expect(view).toBeVisible();

  // Scroll to the very bottom and wait for it to settle at max scroll.
  await view.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect
    .poll(() => view.evaluate((el) => Math.round(el.scrollHeight - el.clientHeight - el.scrollTop)))
    .toBeLessThanOrEqual(1);

  // With the bottom fully reached, the last rendered line still sits well above
  // the scroll viewport's bottom edge — the overscroll room. Measure the gap
  // between the last [data-line] row and the container bottom as a fraction of
  // the viewport height (idiom borrowed from headingTopOffset in
  // diff-surface.e2e.ts).
  const gapFraction = await page.evaluate(() => {
    const container = document.querySelector(".diff-plan");
    const shadow = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const rows = Array.from(shadow?.querySelectorAll<HTMLElement>("[data-line]") ?? []);
    if (container == null || rows.length === 0) return 0;
    const lastRow = rows.reduce((a, b) =>
      Number(b.getAttribute("data-line")) > Number(a.getAttribute("data-line")) ? b : a,
    );
    const gap = container.getBoundingClientRect().bottom - lastRow.getBoundingClientRect().bottom;
    return gap / window.innerHeight;
  });

  // ~33.3% of the viewport (last line ~2/3 down), with tolerance for line
  // height, the shadow content's own breathing room, and scrollbar rounding.
  expect(gapFraction).toBeGreaterThan(0.25);
  expect(gapFraction).toBeLessThan(0.42);
});
