// Scroll-beyond-last-line (EXC-772): the reader can scroll past the end of the
// plan so the last visible line rests about two-thirds down the viewport rather
// than pinned to the bottom edge, leaving ~1/3 of the viewport of overscroll
// room below it. Real scroll behavior → an e2e, per browser-testing.md.

import { TALL_PLAN } from "@test/e2e/support/fixture-plan.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

// TALL_PLAN is several viewports tall, so there is genuine scrolling to the
// bottom and a clearly-rendered last line to measure.

test("the reader can scroll past the end of the plan", async ({ daemon, page }) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");

  const view = await planSurface(page);

  // The rows have to be rendered first: the overscroll room is .diff-plan's own
  // ::after, so an unpopulated container is ~33vh tall, never overflows the viewport,
  // and satisfies the max-scroll poll vacuously. planSurface waits only for the
  // container, which renders unguarded, so it cannot stand in for this.
  await expect(page.locator(".diffview [data-line]").first()).toBeVisible();

  await view.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect
    .poll(() => view.evaluate((el) => Math.round(el.scrollHeight - el.clientHeight - el.scrollTop)))
    .toBeLessThanOrEqual(1);

  // The overscroll room: the gap between the last [data-line] row and the container
  // bottom, as a fraction of the viewport height. `null` rather than 0 when the DOM is
  // not ready, and polled rather than read once (the idiom lineCenterY documents in
  // source-view.ts) — a numeric sentinel reads as a measured gap, so an unrendered plan
  // fails as "Received: 0" instead of naming the missing rows.
  const read = () =>
    page.evaluate(() => {
      const container = document.querySelector(".diff-plan");
      const shadow = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const rows = Array.from(shadow?.querySelectorAll<HTMLElement>("[data-line]") ?? []);
      if (container == null || rows.length === 0) return null;
      const lastRow = rows.reduce((a, b) =>
        Number(b.getAttribute("data-line")) > Number(a.getAttribute("data-line")) ? b : a,
      );
      const gap = container.getBoundingClientRect().bottom - lastRow.getBoundingClientRect().bottom;
      return gap / window.innerHeight;
    });
  // Held on an object rather than in a local: control-flow analysis cannot see
  // through expect.poll's callback, so a local would still read as `null` below.
  const last: { gap: number | null } = { gap: null };
  await expect
    .poll(
      async () => {
        last.gap = await read();
        return last.gap;
      },
      { message: "the plan's rows never rendered, so no overscroll gap could be measured" },
    )
    .not.toBeNull();
  const gapFraction = last.gap as number;

  // ~33.3% of the viewport (last line ~2/3 down), with tolerance for line
  // height, the shadow content's own breathing room, and scrollbar rounding.
  expect(gapFraction).toBeGreaterThan(0.25);
  expect(gapFraction).toBeLessThan(0.42);
});
