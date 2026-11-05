// The outline column's resizable edge: a drag, the arrow keys and a double-click on the
// window splitter at the column's right edge, and the width remembered across a reload.
//
// All of it needs a real browser: the drag is real pointer events under pointer capture,
// the steps are keys on a focused separator, and the widths are laid-out rects. The bounds
// themselves stay a unit (ui/src/lib/outlineColumn.test.ts).

import type { Locator, Page } from "@playwright/test";

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

const PLAN = ["# Plan", "## Alpha", "Alpha text.", "## Bravo", "Bravo text.", ""].join("\n\n");

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

// The column's bed and the plan pane are two cuts in the body, side by side: the edge is
// all of the gap between them, so the grip rises in the gap and never over either.
test("the column's bed stands level with the plan pane, parted from it by the edge alone", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await open(page);
  const box = (l: Locator) =>
    l.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
  const [bed, gap, pane] = await Promise.all([
    box(column(page).locator(".plan-toc")),
    box(edge(page)),
    box(page.locator(".plan-pane")),
  ]);
  expect(bed.top).toBeCloseTo(pane.top, 0);
  expect(bed.bottom).toBeCloseTo(pane.bottom, 0);
  expect(gap.left).toBeCloseTo(bed.right, 0);
  expect(gap.right).toBeCloseTo(pane.left, 0);
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

/** The column's head: its bed, its filter field and the cap at the field's end, and the
 * outline key's face. */
function measureHead(page: Page) {
  return column(page)
    .locator(".plan-toc")
    .evaluate((bed) => {
      const box = (el: Element | null) => {
        if (el === null) throw new Error("a part of the column's head is missing");
        const { left, right, top, bottom } = el.getBoundingClientRect();
        return { left, right, top, bottom, radius: getComputedStyle(el).borderTopLeftRadius };
      };
      return {
        bed: box(bed),
        field: box(bed.querySelector("[data-slot='input-group']")),
        cap: box(bed.querySelector(".toc-field-cap")),
        key: box(bed.querySelector("button[aria-label='Outline']")),
      };
    });
}

// The head is one row however narrow the column: the field and the key side by side,
// the field at the key's height and corner, its cap inside its end, nothing past the bed.
test("the column's head holds its filter field beside its outline key, down to the narrowest", async ({
  daemon,
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("caret.shortcutHints", "on"));
  await daemon.seed({ plan: PLAN });
  await open(page);

  for (const dx of [0, -400]) {
    await dragEdge(page, dx);
    if (dx !== 0) {
      const min = Number(await edge(page).getAttribute("aria-valuemin"));
      await expect.poll(() => widthOf(column(page))).toBeCloseTo(min, 0);
    }
    const { bed, field, cap, key } = await measureHead(page);
    expect(field.bottom - field.top).toBeCloseTo(key.bottom - key.top, 0);
    expect(Math.abs(field.top + field.bottom - (key.top + key.bottom)) / 2).toBeLessThanOrEqual(1);
    expect(field.radius).toBe(key.radius);
    expect(field.left).toBeGreaterThan(bed.left);
    expect(field.right).toBeLessThan(key.left);
    expect(key.right).toBeLessThan(bed.right);
    expect(cap.left).toBeGreaterThan(field.left);
    expect(cap.right).toBeLessThan(field.right);
    expect(field.right - field.left).toBeGreaterThanOrEqual(96);
  }

  // At the narrowest, beside the × and the key's caps, a query keeps about five characters.
  const query = column(page).getByRole("combobox", { name: "Filter headings" });
  await query.fill("alpha");
  await expect(column(page).getByRole("button", { name: "Clear filter" })).toBeVisible();
  const room = await query.evaluate((el) => {
    const s = getComputedStyle(el);
    return el.clientWidth - Number.parseFloat(s.paddingLeft) - Number.parseFloat(s.paddingRight);
  });
  expect(room).toBeGreaterThanOrEqual(40);

  // Let go of, the field shows its cap beside the ×, both inside it and past the query.
  await query.blur();
  const after = await measureHead(page);
  const clear = await column(page)
    .getByRole("button", { name: "Clear filter" })
    .evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
  const textEnd = await query.evaluate(
    (el) => el.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(el).paddingRight),
  );
  expect(after.cap.left).toBeGreaterThanOrEqual(textEnd);
  expect(after.cap.right).toBeLessThanOrEqual(clear.left);
  expect(clear.right).toBeLessThanOrEqual(after.field.right);
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
