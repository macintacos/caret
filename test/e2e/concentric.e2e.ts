// Nested corners stay concentric: where a rounded shape rests near another's corner, the
// inner radius is the outer radius less the inset between them, so the gap round the
// corner matches the gap along the sides. Every pair is a computed radius against two
// laid-out rects, across portalled menus, modals and a narrow viewport, which happy-dom
// computes none of; there is no pure half to unit-test.

import type { Locator, Page } from "@playwright/test";

import { currentCrumb, openSettings } from "@test/e2e/support/chrome.ts";
import {
  openApproveGuard,
  openRejectGuard,
  openRequestChangesDialog,
} from "@test/e2e/support/decision.ts";
import { titledPlan } from "@test/e2e/support/fixture-plan.ts";
import { type Daemon, expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface, revealGutterPlus, seedAndOpen } from "@test/e2e/support/source-view.ts";

type Corner = "tl" | "tr" | "br" | "bl";

/** One corner of `inner` against the same corner of `outer`: both radii, and the inset
 * to the nearer of the two walls that meet there. */
async function nest(
  outer: Locator,
  inner: Locator,
  corner: Corner,
): Promise<{ outer: number; inset: number; inner: number }> {
  const handle = await inner.elementHandle();
  if (handle === null) throw new Error("inner shape not rendered");
  return outer.evaluate(
    (o, [i, c]) => {
      const prop = {
        tl: "borderTopLeftRadius",
        tr: "borderTopRightRadius",
        br: "borderBottomRightRadius",
        bl: "borderBottomLeftRadius",
      } as const;
      const radius = (el: Element) => Number.parseFloat(getComputedStyle(el)[prop[c]]);
      const a = o.getBoundingClientRect();
      const b = i.getBoundingClientRect();
      const dx = c.endsWith("l") ? b.left - a.left : a.right - b.right;
      const dy = c.startsWith("t") ? b.top - a.top : a.bottom - b.bottom;
      return { outer: radius(o), inset: Math.min(dx, dy), inner: radius(i) };
    },
    [handle, corner] as const,
  );
}

async function expectConcentric(outer: Locator, inner: Locator, corner: Corner): Promise<void> {
  // A popup scales in from 95%, which would shrink the inset mid-flight.
  await expect.poll(() => outer.evaluate((el) => el.getAnimations().length)).toBe(0);
  const n = await nest(outer, inner, corner);
  expect(n.inset, `inset at ${corner}`).toBeGreaterThan(0);
  expect(Math.abs(n.inner - (n.outer - n.inset)), JSON.stringify(n)).toBeLessThanOrEqual(0.5);
}

const COMMITTED = [
  { id: "ann-1", startLine: 7, endLine: 8, comment: "Should the TTL be configurable per key?" },
  { id: "ann-2", startLine: 12, endLine: 12, comment: "Name this step so the log reads well." },
];
const SCRATCHES = [{ startLine: 14, endLine: 14, text: "an unsent thought" }];

async function openSeeded(page: Page, daemon: Daemon): Promise<void> {
  const id = await daemon.seed();
  await daemon.putDraft(id, { annotations: COMMITTED, composerScratches: SCRATCHES });
  await page.goto("/");
  await planSurface(page);
}

const radius = (l: Locator) => l.evaluate((el) => getComputedStyle(el).borderTopRightRadius);

test("Request changes: a committed card nests in its tray, and the context lines in the card", async ({
  daemon,
  page,
}) => {
  await openSeeded(page, daemon);
  const dialog = await openRequestChangesDialog(page);
  const tray = dialog.getByRole("region", { name: "Inline comments" }).locator(".row-list");
  const cards = tray.locator(".inline-row");
  await expectConcentric(tray, cards.first(), "tl");
  await expectConcentric(tray, cards.last(), "br");

  const last = cards.last();
  await last.locator(".row-trigger").first().click();
  await last.getByRole("button", { name: "Context" }).click();
  const context = last.locator(".context-lines");
  await expect(context).toBeVisible();
  await expect
    .poll(() => last.evaluate((el) => el.getAnimations({ subtree: true }).length))
    .toBe(0);
  await expectConcentric(last, context, "br");
});

test("the compiled preview's trigger takes its recess's corners, so the recess needs no clip", async ({
  daemon,
  page,
}) => {
  await openSeeded(page, daemon);
  const dialog = await openRequestChangesDialog(page);
  const recess = dialog.locator(".preview");
  const trigger = dialog.getByRole("button", { name: "Compiled feedback preview" });
  for (const corner of ["tl", "bl"] as const) {
    const n = await nest(recess, trigger, corner);
    expect(Math.abs(n.inset)).toBeLessThan(0.5);
    expect(n.inner, `shut, ${corner}`).toBe(n.outer);
  }
  await expect(recess).toHaveCSS("overflow", "visible");
});

test("Request changes, Approve and Reject round as Settings does", async ({ daemon, page }) => {
  await openSeeded(page, daemon);
  const settings = await openSettings(page);
  const corner = await radius(settings);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  for (const open of [openRequestChangesDialog, openApproveGuard, openRejectGuard]) {
    const dialog = await open(page);
    expect(await radius(dialog)).toBe(corner);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});

test("a modal's footer shelf rounds with the modal", async ({ daemon, page }) => {
  await openSeeded(page, daemon);
  const dialog = await openApproveGuard(page);
  const shelf = dialog.locator("[data-slot='dialog-footer']");
  const n = await nest(dialog, shelf, "br");
  expect(Math.abs(n.inset)).toBeLessThan(0.5);
  expect(n.inner).toBe(n.outer);
});

test("the composer's action bed nests in the composer's corner", async ({ daemon, page }) => {
  await seedAndOpen(page, daemon);
  await (await revealGutterPlus(page, 3)).click();
  const composer = page.locator("[data-slot='card'].composer");
  await expect(composer).toBeVisible();
  await expectConcentric(composer, composer.locator(".tray").last(), "br");
});

test("a thread's cards nest in its recess, and so does the composer editing its last card", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [
      { id: "ann-1", startLine: 7, endLine: 8, comment: "Should the TTL be configurable per key?" },
      { id: "ann-3", startLine: 7, endLine: 8, comment: "Also: what evicts first under pressure?" },
    ],
  });
  await page.goto("/");
  await planSurface(page);
  const thread = page.locator("[data-slot='card'].thread");
  const cards = thread.locator("[data-annotation-card]");
  await expectConcentric(thread, cards.last(), "br");

  await cards.last().getByRole("button", { name: "Edit" }).click();
  const composer = thread.locator("[data-slot='card'].composer");
  await expect(composer).toBeVisible();
  await expectConcentric(thread, composer, "br");
});

test("Settings: the search field nests in the panel's corner, and a group rounds as its beds do", async ({
  daemon,
  page,
}) => {
  await seedAndOpen(page, daemon);
  const dialog = await openSettings(page);
  await expectConcentric(
    dialog,
    dialog.locator(".settings-search [data-slot='input-group']"),
    "tl",
  );
  // The group's padding is too wide for a concentric corner to read: it would round at 25px.
  const group = dialog.locator(".fields").first();
  expect(await radius(group)).toBe(await radius(group.locator(".tray").last()));
});

test("Settings at a narrow width: the section picker's bed nests in the panel's corner", async ({
  daemon,
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await seedAndOpen(page, daemon);
  const dialog = await openSettings(page);
  await expectConcentric(dialog, dialog.locator(".section-pick .tray"), "tl");
});

test("a menu's rows nest in its shell", async ({ daemon, page }) => {
  await daemon.seed({ plan: titledPlan("Plan Alpha"), cwd: "/tmp/proj-alpha" });
  await daemon.seed({ plan: titledPlan("Plan Beta"), cwd: "/tmp/proj-beta" });
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);
  await page.getByRole("button", { name: "Approve options" }).click();
  const menu = page.locator("[data-slot='dropdown-menu-content']");
  await expect(menu).toBeVisible();
  await page.mouse.move(5, 5);
  await expectConcentric(menu, menu.locator("[data-slot='dropdown-menu-item']").last(), "bl");
  await page.keyboard.press("Escape");

  await currentCrumb(page).click();
  const crumbs = page.locator("[data-slot='dropdown-menu-content']").first();
  await expect(crumbs).toBeVisible();
  await page.mouse.move(5, 5);
  await expectConcentric(crumbs, crumbs.locator(".key-row").last(), "bl");
});

test("the heading filter's field and rows nest in its panel", async ({ daemon, page }) => {
  await seedAndOpen(page, daemon);
  await waitPastSafeModeGrace(page);
  await currentCrumb(page).click();
  await expect(page.locator("[data-slot='dropdown-menu-content']").first()).toBeVisible();
  await page.keyboard.press("/");
  const filter = page.locator(".plan-crumb-filter");
  await expect(filter).toBeVisible();
  await page.mouse.move(5, 5);
  await expectConcentric(filter, filter.locator("[data-slot='input-group']"), "tl");
  await expectConcentric(filter, filter.locator(".key-row").last(), "bl");
});

test("a Select's options nest in its listbox", async ({ daemon, page }) => {
  await seedAndOpen(page, daemon);
  const dialog = await openSettings(page);
  await dialog.locator("[data-field] .setting-trigger").first().click();
  const listbox = page.locator(".setting-menu");
  await expect(listbox).toBeVisible();
  await page.mouse.move(5, 5);
  await expectConcentric(listbox, listbox.locator("[data-slot='select-item']").last(), "bl");
});

test("the outline's float: the filter nests in its corner, and so does a top-level row's key as it scrolls past", async ({
  daemon,
  page,
}) => {
  // Under --w-narrow the outline drops from the header's key as a float.
  await page.setViewportSize({ width: 880, height: 900 });
  await seedAndOpen(page, daemon);
  await waitPastSafeModeGrace(page);
  await page.locator(".plan-header").getByRole("button", { name: "Outline", exact: true }).click();
  const panel = page.locator(".outline-float");
  await expect(panel).toBeVisible();
  await expectConcentric(panel, panel.locator("[data-slot='input-group']"), "tl");
  // The nearer wall is the side the key runs along; deeper rows step in from it.
  await expectConcentric(panel, panel.locator("[data-level='1'] .toc-key").first(), "bl");
});

test("the plan header's bed nests in the pane's top corners, and its end keys in the bed's", async ({
  daemon,
  page,
}) => {
  // Under --w-narrow the header holds the outline key, with no column folding to wait on.
  await page.setViewportSize({ width: 880, height: 900 });
  await seedAndOpen(page, daemon);
  const pane = page.locator(".plan-pane");
  const bed = pane.locator(".plan-header > .header-bed");
  await expect(bed).toBeVisible();
  await expectConcentric(pane, bed, "tl");
  await expectConcentric(pane, bed, "tr");
  await expectConcentric(bed, pane.getByRole("button", { name: "Outline", exact: true }), "tl");
  await expectConcentric(bed, pane.locator(".preview-toggle"), "tr");
});

test("the outline column's bed: its filter field and a top-level row's key nest in its corner", async ({
  daemon,
  page,
}) => {
  await seedAndOpen(page, daemon);
  const bed = page.locator(".plan-outline .plan-toc");
  await expectConcentric(bed, bed.locator("[data-slot='input-group']"), "tl");
  await expectConcentric(bed, bed.locator("[data-level='1'] .toc-key").first(), "tl");
});

test("a saved comment's header controls nest in its corners", async ({ daemon, page }) => {
  await openSeeded(page, daemon);
  const card = page.locator("[data-annotation-card='ann-1']");
  await expect(card).toBeVisible();
  const chip = card.locator("button.chip");
  await expectConcentric(card, chip, "tl");
  await expectConcentric(card, chip, "bl");
  await expectConcentric(card, card.getByRole("button", { name: "Discard comment" }), "tr");
});

test("the discard bubble's action bed nests in its corner", async ({ daemon, page }) => {
  await openSeeded(page, daemon);
  await waitPastSafeModeGrace(page);
  await page
    .locator("[data-annotation-card='ann-1']")
    .getByRole("button", { name: "Discard comment" })
    .click();
  const bubble = page.locator(".confirm-popover");
  await expect(bubble).toBeVisible();
  await expectConcentric(bubble, bubble.locator(".tray"), "br");
});
