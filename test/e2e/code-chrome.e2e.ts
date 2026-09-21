// Per-block soft wrap in the always-visible code chrome (EXC-1386). A fenced block wide
// enough to be carded (EXC-729) carries a wrap toggle beside its copy button; pressing it
// reflows that one block in place, leaving every other block scrolling horizontally, and
// the choice is transient.
//
// Everything here needs a real browser, because the whole feature is decided by measured
// layout: whether a block overflows its reading width at all, whether a reflowed block's
// rows grew taller and stopped overflowing, and whether the gutter's line numbers still
// line up with the content rows the wrap made taller. happy-dom reports zero for every
// one of those metrics, so none of it can be proven anywhere else. Three specs rest on
// something else a unit cannot stage instead: the shadow-root hit-test behind the resting
// dim → brighten effect and its re-fire on scroll, the document tab order the toggle has
// to sit in, and the daemon pushing a new version onto an open page. The pure halves are
// units: the anchor and overflow-predicate geometry in
// ui/src/lib/diffview/codeChrome.test.ts, the card's reflow marking in
// ui/src/lib/diffview/codeBlockScroll.test.ts, the three CSS rules in
// ui/src/lib/diffview/coreStyles.test.ts, and the chrome component's own render branches
// in ui/src/components/CodeBlockChrome.test.ts.

import type { Page } from "@playwright/test";

import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface, settledMutations } from "@test/e2e/support/source-view.ts";

// One block far wider than the reading width (so it cards and offers the wrap toggle) and
// one inside it (so it does not) — the pair every assertion below reads the per-block
// claim against. The wide block's line is a run of ordinary words, so it has break
// opportunities and can actually reflow; a line of one unbroken token could not.
//
// Which side a block lands on is the `--caret-read-max` 720px cap, and no viewport moves a
// block across it — measured below in both directions. The two box kinds do differ, which
// is why a resize re-runs the card pass at all: a loose `[data-line]` row is
// `white-space: pre` with no overflow, so it grows the plan column to its own content
// (capped at 720) and reports scrollWidth === clientWidth at every viewport, while a
// `[data-code-card]` contributes nothing and takes whatever the column gives, so it is
// narrower on a narrow viewport. Neither difference reaches the threshold: a card exists
// only because its content already passed 720, which no width the column can offer it
// beats. Both halves of that are conditional on the cap being a CONSTANT — make
// `--caret-read-max` relative (a vw, a percentage, a clamp) and either crossing becomes
// reachable again. The second block's ~82 characters stay inside the cap throughout.
//
// The trailing filler is scroll room — the brightening spec wheels one block under a
// stationary pointer, which needs the surface to scroll past a viewport.
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

${Array.from({ length: 30 }, (_, i) => `Filler line ${i + 1} giving the surface room to scroll.`).join("\n\n")}
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

/** The viewport centre of the block opening at `start` — its card's box when carded, else
 * its opening row's. Where a pointer sits "on" the block, in the coordinates the
 * shadow-root hit-test reads. */
async function blockPoint(page: Page, start: number): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((line) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const card = sh?.querySelector(`[data-content] > [data-code-card="${line}"]`) ?? null;
    const box = card ?? sh?.querySelector(`[data-content] [data-line="${line}"]`);
    const r = box?.getBoundingClientRect();
    return r == null ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, start);
  expect(point).not.toBeNull();
  return point as { x: number; y: number };
}

/** How many cards on the page carry the reflow mark. */
function reflowMarkCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (document.querySelector(".diffview") as HTMLElement)?.shadowRoot?.querySelectorAll(
        "[data-code-card-reflow]",
      ).length ?? -1,
  );
}

/** Seeds the mixed plan and waits until the wide block has been measured and carded —
 * the precondition every assertion below rests on. Returns the seeded review's id. */
async function openMixedPlan(page: Page, daemon: Daemon): Promise<string> {
  const id = await daemon.seed({ plan: MIXED_CODE_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("Intro prose here.")).toBeVisible();
  await expect.poll(async () => (await blockMetrics(page, WIDE))?.carded).toBe(true);
  return id;
}

const wrapToggle = (page: Page) => page.getByRole("button", { name: "Wrap long lines" });

/** The chrome box belonging to the block opening at `start`, picked out by the copy
 * button's per-block accessible name rather than by render order. */
const chromeFor = (page: Page, start: number) =>
  page
    .locator(".code-chrome")
    .filter({ has: page.getByRole("button", { name: `Copy code from line ${start}` }) });

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
  expect(await reflowMarkCount(page)).toBe(0);
});

test("the chrome brightens on the block under the pointer, and follows a scroll (EXC-836)", async ({
  daemon,
  page,
}) => {
  // The resting-dim half of discoverability: the box is always mounted, and `data-lit`
  // marks the block the pointer has actually reached. It has to survive a scroll under a
  // still pointer too — CSS :hover never re-fires there, so the chrome would stay lit on
  // the block that scrolled away, which is the EXC-836 failure one affordance over.
  await openMixedPlan(page, daemon);
  const wide = chromeFor(page, WIDE);
  const narrow = chromeFor(page, NARROW);

  const cursor = await blockPoint(page, WIDE);
  await page.mouse.move(cursor.x, cursor.y);
  await expect(wide).toHaveAttribute("data-lit", "");
  await expect(narrow).not.toHaveAttribute("data-lit", "");

  // Wheel the narrow block up to the unmoved pointer — a real wheel, so this proves the
  // gesture routes to the plan and that the re-fired move re-keys the hover.
  const target = await blockPoint(page, NARROW);
  await page.mouse.wheel(0, target.y - cursor.y);

  await expect(narrow).toHaveAttribute("data-lit", "");
  await expect(wide).not.toHaveAttribute("data-lit", "");
});

test("no viewport moves a block across the fit/overflow line", async ({ daemon, page }) => {
  // AC 4's threshold, measured rather than assumed. A card takes whatever the content
  // column gives and so narrows with the viewport; a fitting row grows the column to its
  // own content and never clips. Neither crosses the 720px cap, in either direction — so
  // the wrap button neither appears nor disappears on a resize.
  await openMixedPlan(page, daemon);
  const reference = await blockMetrics(page, WIDE);

  await page.setViewportSize({ width: 420, height: 900 });
  await expect
    .poll(async () => (await blockMetrics(page, WIDE))?.clientWidth)
    .toBeLessThan(reference?.clientWidth as number);
  const narrowed = await blockMetrics(page, WIDE);
  expect(narrowed?.carded).toBe(true);
  expect(narrowed?.scrollWidth).toBeGreaterThan(narrowed?.clientWidth as number);
  const fitting = await blockMetrics(page, NARROW);
  expect(fitting?.carded).toBe(false);
  expect(fitting?.scrollWidth).toBe(fitting?.clientWidth);
  await expect(wrapToggle(page)).toHaveCount(1);

  await page.setViewportSize({ width: 1600, height: 900 });
  await expect
    .poll(async () => (await blockMetrics(page, WIDE))?.clientWidth)
    .toBe(reference?.clientWidth);
  expect((await blockMetrics(page, NARROW))?.carded).toBe(false);
  await expect(wrapToggle(page)).toHaveCount(1);
});

test("a wrapped block stays wrapped across a viewport resize", async ({ daemon, page }) => {
  // AC 5. The card pass re-runs on resize and retires a card that stops overflowing — a
  // wrapped block always stops overflowing, so the reflow mark is what has to hold the
  // card open across the re-run rather than fall out of it.
  await openMixedPlan(page, daemon);
  await wrapToggle(page).click();
  await expect.poll(async () => (await blockMetrics(page, WIDE))?.reflowed).toBe(true);

  // Settle before reading, rather than polling for a true. Without the reflow mark holding
  // the card open, the resize retires it, the loose rows overflow again, the next pass
  // re-cards and re-marks them, and the block flips forever — and a poll is satisfied by
  // any one of those frames. Settling is the claim: the block is wrapped and at rest.
  await page.setViewportSize({ width: 420, height: 900 });
  await settledMutations(page);
  expect((await blockMetrics(page, WIDE))?.reflowed).toBe(true);
  await page.setViewportSize({ width: 1600, height: 900 });
  await settledMutations(page);
  expect((await blockMetrics(page, WIDE))?.reflowed).toBe(true);
  await expect(wrapToggle(page)).toHaveAttribute("aria-pressed", "true");
});

test("a new plan version returns every block to scrolling", async ({ daemon, page }) => {
  // AC 6: the wrap is per-rendering, never a preference. A version arriving on the open
  // page is the case a reload cannot stand in for — the component stays mounted, so only
  // the contentKey reset clears the state.
  const id = await openMixedPlan(page, daemon);
  await wrapToggle(page).click();
  await expect.poll(async () => (await blockMetrics(page, WIDE))?.reflowed).toBe(true);

  await daemon.addVersion(id, MIXED_CODE_PLAN.replace("Intro prose here.", "Second version."));

  await expect(page.getByText("Second version.")).toBeVisible();
  // aria-pressed reads the reflow set directly, so waiting on it waits on the reset. The
  // mark count is then read once rather than polled: the library rebuilds the cards on the
  // version swap, and a poll would be satisfied by that empty frame whether the set
  // cleared or not.
  await expect(wrapToggle(page)).toHaveAttribute("aria-pressed", "false");
  expect(await reflowMarkCount(page)).toBe(0);
});

test("the wrap toggle is reachable and operable from the keyboard", async ({ daemon, page }) => {
  // AC 9. The chrome is a real <button> in the .diff-plan light DOM, so it should be an
  // ordinary tab stop — reached without a pointer, and activated by Enter rather than by
  // a click handler alone.
  await openMixedPlan(page, daemon);
  const toggle = wrapToggle(page);

  for (let i = 0; i < 60; i++) {
    if (await toggle.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(toggle).toBeFocused();

  await page.keyboard.press("Enter");
  await expect.poll(async () => (await blockMetrics(page, WIDE))?.reflowed).toBe(true);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});
