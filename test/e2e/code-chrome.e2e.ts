// Per-block soft wrap in the always-visible code chrome (EXC-1386). A fenced block wide
// enough to be carded (EXC-729) carries a wrap toggle beside its copy button; pressing it
// reflows that one block in place, leaving every other block scrolling horizontally, and
// the choice is transient.
//
// Everything here needs a real browser, because the whole feature is decided by measured
// layout: whether a block overflows its reading width at all, whether a reflowed block's
// rows grew taller and stopped overflowing, and whether the gutter's line numbers still
// line up with the content rows the wrap made taller. happy-dom reports zero for every
// one of those metrics, so none of it can be proven anywhere else. The pure halves are
// units: the anchor and overflow-predicate geometry in
// ui/src/lib/diffview/codeChrome.test.ts, the card's reflow marking in
// ui/src/lib/diffview/codeBlockScroll.test.ts, the three CSS rules in
// ui/src/lib/diffview/coreStyles.test.ts, and the chrome component's own render branches
// in ui/src/components/CodeBlockChrome.test.ts.

import type { Page } from "@playwright/test";

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

// One block far wider than the reading width (so it cards and offers the wrap toggle) and
// one inside it (so it does not) — the pair every assertion below reads the per-block
// claim against. The wide block's line is a run of ordinary words, so it has break
// opportunities and can actually reflow; a line of one unbroken token could not.
//
// What decides which side a block lands on is the `--caret-read-max` 720px cap and nothing
// else. A code row is `white-space: pre`, so on a viewport narrower than the cap the row
// box grows to its own content and the plan column overflows the viewport instead — the
// row still reports scrollWidth === clientWidth. The second block's ~82 characters
// therefore stay inside the cap at every viewport.
const MIXED_CODE_PLAN = `# Mixed code plan

Intro prose here.

\`\`\`text
${"the reviewer asked for a paragraph of prose and the agent wrote it as one very long line ".repeat(6)}
\`\`\`

Prose between the blocks.

\`\`\`text
const value = computeThreshold(alpha, beta, gamma, delta, epsilon, zeta, eta, nu);
\`\`\`

Closing prose after the blocks.
`;

/** The wide block's opening fence is line 5, the narrow one's line 11. */
const WIDE = 5;
const NARROW = 11;

/** The content-column metrics of the block opening at `start` — its card's when carded,
 * else its first row's. `carded` is the overflow state the wrap toggle gates on. */
function blockMetrics(page: Page, start: number) {
  return page.evaluate((line) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const card = sh?.querySelector(`[data-content] > [data-code-card="${line}"]`) ?? null;
    const box = (card ??
      sh?.querySelector(`[data-content] [data-line="${line}"]`)) as HTMLElement | null;
    if (box == null) return null;
    return {
      carded: card !== null,
      reflowed: card?.hasAttribute("data-code-card-reflow") ?? false,
      scrollWidth: box.scrollWidth,
      clientWidth: box.clientWidth,
      height: box.getBoundingClientRect().height,
    };
  }, start);
}

/** Seeds the mixed plan and waits until the wide block has been measured and carded —
 * the precondition every assertion below rests on. */
async function openMixedPlan(
  page: Page,
  daemon: { seed: (o: { plan: string }) => Promise<unknown> },
) {
  await daemon.seed({ plan: MIXED_CODE_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("Intro prose here.")).toBeVisible();
  await expect.poll(async () => (await blockMetrics(page, WIDE))?.carded).toBe(true);
}

const wrapToggle = (page: Page) => page.getByRole("button", { name: "Wrap long lines" });

test("both controls are offered without a pointer, and only where wrapping means something", async ({
  daemon,
  page,
}) => {
  // The chrome is always mounted, so a reviewer finds it without hunting — and the wrap
  // toggle appears only on the block that actually overflows, since wrapping one that
  // already fits would do nothing.
  await openMixedPlan(page, daemon);

  await expect(page.getByRole("button", { name: "Copy code" })).toHaveCount(2);
  await expect(wrapToggle(page)).toHaveCount(1);
  expect((await blockMetrics(page, NARROW))?.carded).toBe(false);
});

test("wrapping a block reflows it in place and unwrapping restores its scrolling", async ({
  daemon,
  page,
}) => {
  // The whole point of the feature: the long paragraph becomes readable without leaving
  // the plan. Measured rather than asserted off the attribute — a mark that changed
  // nothing about the layout would be no feature at all.
  await openMixedPlan(page, daemon);
  const before = await blockMetrics(page, WIDE);
  expect(before?.scrollWidth).toBeGreaterThan(before?.clientWidth as number);

  await wrapToggle(page).click();
  await expect.poll(async () => (await blockMetrics(page, WIDE))?.reflowed).toBe(true);
  const wrapped = await blockMetrics(page, WIDE);
  expect(wrapped?.height as number).toBeGreaterThan(before?.height as number);
  expect(wrapped?.scrollWidth).toBe(wrapped?.clientWidth as number);

  await wrapToggle(page).click();
  await expect.poll(async () => (await blockMetrics(page, WIDE))?.reflowed).toBe(false);
  const restored = await blockMetrics(page, WIDE);
  expect(restored?.scrollWidth).toBeGreaterThan(restored?.clientWidth as number);
  expect(restored?.height).toBeCloseTo(before?.height as number, 0);
});

test("the other block on the page is untouched in both directions", async ({ daemon, page }) => {
  // Per-block is the request: a reviewer reflowing one paragraph must not restyle the
  // code they were reading beside it.
  await openMixedPlan(page, daemon);
  const before = await blockMetrics(page, NARROW);

  await wrapToggle(page).click();
  await expect.poll(async () => (await blockMetrics(page, WIDE))?.reflowed).toBe(true);
  expect(await blockMetrics(page, NARROW)).toEqual(before);

  await wrapToggle(page).click();
  await expect.poll(async () => (await blockMetrics(page, WIDE))?.reflowed).toBe(false);
  expect(await blockMetrics(page, NARROW)).toEqual(before);
});

test("a wrapped block keeps its gutter numbers aligned and its columns balanced", async ({
  daemon,
  page,
}) => {
  // A reflowed row grows its parent row track and the gutter cell mapped to it grows with
  // it, so each number has to sit at the top of its taller track rather than floating
  // beside the middle of the paragraph. The child counts matter too: the library's
  // selection walk throws when the two columns disagree.
  await openMixedPlan(page, daemon);
  await wrapToggle(page).click();
  await expect.poll(async () => (await blockMetrics(page, WIDE))?.reflowed).toBe(true);

  const alignment = await page.evaluate((line) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const card = sh?.querySelector(`[data-content] > [data-code-card="${line}"]`) ?? null;
    const mirror = sh?.querySelector(`[data-gutter] > [data-code-card-gutter="${line}"]`) ?? null;
    if (card == null || mirror == null) return null;
    const drift = [...card.querySelectorAll("[data-line]")].map((row) => {
      const n = row.getAttribute("data-line");
      const cell = mirror.querySelector(`[data-column-number="${n}"]`);
      if (cell == null) return Number.NaN;
      return Math.abs(row.getBoundingClientRect().top - cell.getBoundingClientRect().top);
    });
    const gutter = sh?.querySelector("[data-gutter]");
    const content = sh?.querySelector("[data-content]");
    return {
      drift,
      balanced: (gutter?.children.length ?? -1) === (content?.children.length ?? -2),
    };
  }, WIDE);

  expect(alignment?.balanced).toBe(true);
  expect(alignment?.drift.length).toBeGreaterThan(0);
  for (const d of alignment?.drift ?? []) expect(d).toBeLessThan(2);
});

test("copied text is byte-identical wrapped and unwrapped", async ({ daemon, page }) => {
  // The wrap is a view state, not an edit: what the reviewer pastes must be the source the
  // agent wrote, whichever way they were reading it.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openMixedPlan(page, daemon);
  // Scoped to the wide block's own chrome box: a copy button renames itself to "Copied"
  // for a moment, so a page-wide name query would walk to the other block's button.
  const box = page.locator(".code-chrome").first();
  const idle = box.getByRole("button", { name: "Copy code" });
  const done = box.getByRole("button", { name: "Copied" });

  await idle.click();
  await expect(done).toBeVisible();
  const unwrapped = await page.evaluate(() => navigator.clipboard.readText());

  await wrapToggle(page).click();
  await expect.poll(async () => (await blockMetrics(page, WIDE))?.reflowed).toBe(true);
  await expect(idle).toBeVisible(); // the checkmark has reverted, so the next click copies afresh
  await idle.click();
  await expect(done).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(unwrapped);
});

test("an untouched plan renders exactly as it did before the toggle existed", async ({
  daemon,
  page,
}) => {
  // Nothing about the feature may change the default reading experience: with no
  // interaction the wide block still scrolls horizontally and no card is marked.
  await openMixedPlan(page, daemon);
  const wide = await blockMetrics(page, WIDE);
  expect(wide?.reflowed).toBe(false);
  expect(wide?.scrollWidth).toBeGreaterThan(wide?.clientWidth as number);
  expect(
    await page.evaluate(
      () =>
        (document.querySelector(".diffview") as HTMLElement)?.shadowRoot?.querySelectorAll(
          "[data-code-card-reflow]",
        ).length ?? -1,
    ),
  ).toBe(0);
});
