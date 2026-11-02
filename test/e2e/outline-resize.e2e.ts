// The outline column's resizable edge: a drag, the arrow keys and a double-click on the
// window splitter at the column's right edge, the width remembered across a reload, and the
// column yielding to a file drawer at the width the reader chose.
//
// All of it needs a real browser: the drag is real pointer events under pointer capture,
// the steps are keys on a focused separator, the widths are laid-out rects, and the drawer
// opens from a resolved file reference. The bounds themselves stay a unit
// (ui/src/lib/outlineColumn.test.ts, and outlineRoom in ui/src/lib/fileDrawer.test.ts).

import type { Locator, Page } from "@playwright/test";

import { makeProject, settleDrawer } from "@test/e2e/support/file-refs.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

const PLAN = ["# Plan", "## Alpha", "Alpha text.", "## Bravo", "Bravo text.", ""].join("\n\n");
const FILE_PLAN = "# Refs\n\n## Cache\n\nThe cache lives in `src/cache.ts`.\n";
const CACHE_TS = "export const cache = new Map();\n";

// The opening width, 15.5rem at the browser's 16px root.
const OPENING_PX = 248;

const column = (page: Page): Locator => page.getByRole("complementary", { name: "Outline" });
const edge = (page: Page): Locator => page.getByRole("separator", { name: "Resize outline" });

function widthOf(locator: Locator): Promise<number> {
  return locator.evaluate((el) => el.getBoundingClientRect().width);
}

async function open(page: Page, viewport = { width: 1440, height: 900 }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await planSurface(page);
  await expect(column(page)).toBeVisible();
  await waitPastSafeModeGrace(page);
}

/** Drag the column's edge `dx` px across, from a point down its middle. */
async function dragEdge(page: Page, dx: number): Promise<void> {
  const box = await edge(page).boundingBox();
  if (box === null) throw new Error("the outline's edge has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

/** Open the plan's file reference, and wait out the drawer's slide. */
async function openFile(page: Page): Promise<void> {
  await page.locator("[data-file-ref]").first().click();
  await expect(page.locator("[data-file-preview]")).toBeVisible();
  await settleDrawer(page);
}

test("dragging the column's edge resizes it, and the width survives a reload", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await open(page);
  expect(await widthOf(column(page))).toBeCloseTo(OPENING_PX, 0);

  await dragEdge(page, 80);
  await expect.poll(() => widthOf(column(page))).toBeCloseTo(OPENING_PX + 80, 0);
  await expect(edge(page)).toHaveAttribute("aria-valuenow", String(OPENING_PX + 80));
  // The plan gives the column its room: its pane starts at the column's new edge.
  const paneLeft = await page
    .locator(".plan-pane")
    .evaluate((el) => el.getBoundingClientRect().left);
  expect(paneLeft).toBeCloseTo(OPENING_PX + 80, 0);

  await page.reload();
  await planSurface(page);
  await expect.poll(() => widthOf(column(page))).toBeCloseTo(OPENING_PX + 80, 0);
});

/** The names of the elements whose last pixel column, at their middle, something else
 * takes the click on. */
function stolenRightEdges(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((els) =>
    els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.right - 1, r.top + r.height / 2);
        return hit === null || !el.contains(hit);
      })
      .map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""),
  );
}

test("the edge takes the gap's clicks and none of the plan's, the rows' or the column's outline key's", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await open(page);
  for (const dx of [0, 152]) {
    await dragEdge(page, dx);
    await expect.poll(() => widthOf(column(page))).toBeCloseTo(OPENING_PX + dx, 0);

    const hits = await page.evaluate(() => {
      const pane = document.querySelector(".plan-pane")?.getBoundingClientRect();
      if (pane === undefined) return null;
      const y = pane.top + pane.height / 2;
      const at = (x: number) => document.elementFromPoint(x, y);
      return {
        gap: at(pane.left - 1)?.getAttribute("aria-label") ?? null,
        plan: at(pane.left + 1)?.closest(".plan-pane") !== null,
      };
    });
    expect(hits).toEqual({ gap: "Resize outline", plan: true });

    const rows = column(page).getByRole("option");
    await expect(rows).toHaveCount(3);
    expect(await stolenRightEdges(rows)).toEqual([]);
    expect(
      await stolenRightEdges(column(page).getByRole("button", { name: "Outline", exact: true })),
    ).toEqual([]);
    expect(await stolenRightEdges(column(page).locator(".toc-title-row .header-tray"))).toEqual([]);
  }
});

test("the grip stays clear of the column's outline key, however high the pointer finds the edge", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await open(page);
  const edgeBox = await edge(page).boundingBox();
  const tray = await column(page).locator(".toc-title-row .header-tray").boundingBox();
  if (edgeBox === null || tray === null) throw new Error("the edge or the key's tray has no box");
  const x = edgeBox.x + edgeBox.width / 2;

  for (const y of [tray.y + tray.height / 2, edgeBox.y + 1]) {
    await page.mouse.move(x, y);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const grip = await edge(page).locator(".grip").boundingBox();
    if (grip === null) throw new Error("the grip has no box");
    const meets =
      grip.x < tray.x + tray.width &&
      tray.x < grip.x + grip.width &&
      grip.y < tray.y + tray.height &&
      tray.y < grip.y + grip.height;
    expect(meets, `pointer at y=${y}`).toBe(false);
  }
});

test("the grip stands where the pointer finds the edge, and follows it along", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await open(page);
  const box = await edge(page).boundingBox();
  if (box === null) throw new Error("the outline's edge has no box");
  const x = box.x + box.width / 2;
  const y = Math.round(box.y + box.height / 3);
  const gripY = () =>
    edge(page)
      .locator(".grip")
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      });

  for (const at of [y, y + 3, y + 6]) {
    await page.mouse.move(x, at);
    await expect.poll(async () => Math.abs((await gripY()) - at)).toBeLessThanOrEqual(1);
  }
});

test("a mouse drag leaves the edge focused for the arrow keys, its grip at rest once the pointer leaves", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await open(page);
  await dragEdge(page, 40);
  await expect(edge(page)).toHaveAttribute("aria-valuenow", String(OPENING_PX + 40));
  const pane = await page.locator(".plan-pane").boundingBox();
  if (pane === null) throw new Error("the plan pane has no box");
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);

  expect(
    await edge(page).evaluate((el) => ({
      focused: el === document.activeElement,
      focusVisible: el.matches(":focus-visible"),
    })),
  ).toEqual({ focused: true, focusVisible: false });
  await expect
    .poll(() =>
      edge(page)
        .locator(".grip")
        .evaluate((el) => getComputedStyle(el).opacity),
    )
    .toBe("0");

  await page.keyboard.press("ArrowRight");
  await expect(edge(page)).toHaveAttribute("aria-valuenow", String(OPENING_PX + 40 + 24));
});

test("only the primary button drags the edge", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await open(page);
  const box = await edge(page).boundingBox();
  if (box === null) throw new Error("the outline's edge has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  for (const button of ["right", "middle"] as const) {
    await page.mouse.move(x, y);
    await page.mouse.down({ button });
    await page.mouse.move(x + 100, y, { steps: 8 });
    await page.mouse.up({ button });
  }
  await expect(edge(page)).toHaveAttribute("aria-valuenow", String(OPENING_PX));
  expect(await widthOf(column(page))).toBeCloseTo(OPENING_PX, 0);
});

test("a drag stops at the column's bounds, which the separator reports", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await open(page);

  await dragEdge(page, -400);
  const min = Number(await edge(page).getAttribute("aria-valuemin"));
  await expect.poll(() => widthOf(column(page))).toBeCloseTo(min, 0);
  expect(min).toBeLessThan(OPENING_PX);

  await dragEdge(page, 900);
  const max = Number(await edge(page).getAttribute("aria-valuemax"));
  await expect.poll(() => widthOf(column(page))).toBeCloseTo(max, 0);
  expect(max).toBeGreaterThan(OPENING_PX);
  // The plan beside the widest column still reads at 800px.
  expect(await widthOf(page.locator(".plan-pane"))).toBeGreaterThanOrEqual(800 - 6);
});

test("the arrow keys step the focused edge", async ({ daemon, page }) => {
  await daemon.seed({ plan: PLAN });
  await open(page);

  await edge(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(edge(page)).toHaveAttribute("aria-valuenow", String(OPENING_PX + 24));
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(edge(page)).toHaveAttribute("aria-valuenow", String(OPENING_PX - 24));
  expect(await widthOf(column(page))).toBeCloseTo(OPENING_PX - 24, 0);
});

test("a double-click on the edge returns the opening width, and keeps it across a reload", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await open(page);
  await dragEdge(page, 100);
  await expect.poll(() => widthOf(column(page))).toBeCloseTo(OPENING_PX + 100, 0);

  await edge(page).dblclick();
  await expect.poll(() => widthOf(column(page))).toBeCloseTo(OPENING_PX, 0);

  await page.reload();
  await planSurface(page);
  await expect.poll(() => widthOf(column(page))).toBeCloseTo(OPENING_PX, 0);
});

test("the column folds and stands again at the width the reader chose", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await open(page);
  await dragEdge(page, 72);
  await expect.poll(() => widthOf(column(page))).toBeCloseTo(OPENING_PX + 72, 0);
  await page.evaluate(() => {
    const w = window as unknown as { __columnFrom: string[] };
    w.__columnFrom = [];
    window.addEventListener(
      "transitionrun",
      (e) => {
        const el = e.target as HTMLElement;
        if (e.propertyName === "transform" && el.matches(".plan-outline:not(.leaving)")) {
          w.__columnFrom.push(el.style.getPropertyValue("--slide-x"));
        }
      },
      { capture: true },
    );
  });

  await page.keyboard.press("Shift+Backslash");
  await expect(column(page)).toHaveCount(0);
  await page.keyboard.press("Shift+Backslash");
  await expect(column(page)).toBeVisible();
  await expect.poll(() => widthOf(column(page))).toBeCloseTo(OPENING_PX + 72, 0);
  // It slides in from a whole column's width off the window's edge.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __columnFrom: string[] }).__columnFrom))
    .toEqual([`-${OPENING_PX + 72}px`]);
});

test.describe("beside a file drawer", () => {
  test("a narrowed column keeps its place beside a file the opening width yields to, and resets to the widest that keeps it there", async ({
    daemon,
    page,
  }) => {
    const proj = await makeProject({ "src/cache.ts": CACHE_TS });
    try {
      await daemon.seed({ cwd: proj.dir, plan: FILE_PLAN });
      // The plan beside an opening-width column and the default drawer reads under 800px.
      await open(page, { width: 1680, height: 900 });
      await dragEdge(page, -56);
      await expect.poll(() => widthOf(column(page))).toBeCloseTo(OPENING_PX - 56, 0);

      await openFile(page);
      await expect(column(page)).toBeVisible();

      await edge(page).dblclick();
      const max = Number(await edge(page).getAttribute("aria-valuemax"));
      expect(max).toBeLessThan(OPENING_PX);
      expect(max).toBeGreaterThan(OPENING_PX - 56);
      await expect.poll(() => widthOf(column(page))).toBeCloseTo(max, 0);
      await expect(column(page)).toBeVisible();
    } finally {
      await proj.cleanup();
    }
  });

  test("a widened column yields to a file the opening width stands beside", async ({
    daemon,
    page,
  }) => {
    const proj = await makeProject({ "src/cache.ts": CACHE_TS });
    try {
      await daemon.seed({ cwd: proj.dir, plan: FILE_PLAN });
      await open(page, { width: 1800, height: 900 });
      await dragEdge(page, 152);
      await expect.poll(() => widthOf(column(page))).toBeCloseTo(OPENING_PX + 152, 0);

      await openFile(page);
      await expect(column(page)).toHaveCount(0);
      await expect(
        page.locator(".plan-header").getByRole("button", { name: "Outline", exact: true }),
      ).toBeVisible();
    } finally {
      await proj.cleanup();
    }
  });

  test("a drag stops where the column would yield, so it never drops to a float mid-gesture", async ({
    daemon,
    page,
  }) => {
    const proj = await makeProject({ "src/cache.ts": CACHE_TS });
    try {
      await daemon.seed({ cwd: proj.dir, plan: FILE_PLAN });
      await open(page, { width: 1920, height: 900 });
      await openFile(page);
      await expect(column(page)).toBeVisible();

      await dragEdge(page, 400);
      const max = Number(await edge(page).getAttribute("aria-valuemax"));
      await expect.poll(() => widthOf(column(page))).toBeCloseTo(max, 0);
      expect(max).toBeGreaterThan(OPENING_PX + 100);
      await expect(column(page)).toBeVisible();

      // A step past the bound holds too.
      await edge(page).focus();
      await page.keyboard.press("ArrowRight");
      await expect(edge(page)).toHaveAttribute("aria-valuenow", String(max));
      await expect(column(page)).toBeVisible();
    } finally {
      await proj.cleanup();
    }
  });
});
