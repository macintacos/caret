// Keyboard focus wears each control's hover look and draws no ring (styles/base.css). For
// a sample of every kind of control, a spec reaches it by keyboard, then puts the pointer
// on it with focus elsewhere, and asks the cascade for the same face, shadow, lift and ink
// both ways. Only a real browser resolves :focus-visible, a shadow root's sheet, and a
// list whose highlight follows both the pointer and the keys.

import type { Locator, Page } from "@playwright/test";

import {
  commentNavigator,
  commentTally,
  openSettings,
  previewToggle,
} from "@test/e2e/support/chrome.ts";
import { openWithPendingAnnotation } from "@test/e2e/support/decision.ts";
import { makeProject, openFileRefPreview } from "@test/e2e/support/file-refs.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import {
  jumpToHeading,
  planSurface,
  revealGutterPlus,
  seedAndOpen,
} from "@test/e2e/support/source-view.ts";

interface Look {
  face: string;
  shadow: string;
  lift: string;
  ink: string;
  /** Any outline the element or its ::before draws, empty when neither does. */
  ring: string;
}

/** An element's look once its transitions have run out. */
function look(target: Locator): Promise<Look> {
  return target.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
    const ringOf = (s: CSSStyleDeclaration) =>
      s.outlineStyle === "none" || Number.parseFloat(s.outlineWidth) === 0
        ? ""
        : `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`;
    const style = getComputedStyle(el);
    return {
      face: style.backgroundColor,
      shadow: style.boxShadow,
      lift: style.translate,
      ink: style.color,
      ring: [ringOf(style), ringOf(getComputedStyle(el, "::before"))].filter(Boolean).join(" | "),
    };
  });
}

/** Move focus onto `target` with Tab, so it arrives the way a keyboard user's does. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  await target.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
  expect(await target.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
}

/** Expect `target` to look the same under keyboard focus as under the pointer, with no
 * ring, and apart from how it rests. */
async function expectFocusLooksLikeHover(page: Page, target: Locator): Promise<void> {
  await page.mouse.move(0, 0);
  const rest = await look(target);
  await tabTo(page, target);
  const keyed = await look(target);
  expect(keyed.ring).toBe("");
  expect(keyed).not.toEqual(rest);

  await target.evaluate((el) => (el as HTMLElement).blur());
  await target.hover();
  expect(await look(target)).toEqual(keyed);
}

/** A list whose highlight follows both the keys and the pointer. */
interface CursorList {
  rows: Locator;
  /** The row the highlight is on. */
  cursor: Locator;
  /** Move the keyboard's cursor one row. */
  step: () => Promise<void>;
  /** The part of a row that wears its look, the row itself unless given. */
  readAt?: (row: Locator) => Locator;
}

/** Read each row's look with the keys on it, then again with the pointer on it once the
 * keys have moved on, and expect the two to match with no ring. */
async function expectKeyedRowsLookPointed({
  rows,
  cursor,
  step,
  readAt = (row) => row,
}: CursorList): Promise<void> {
  const keyed = new Map<string, Look>();
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const name = (await cursor.textContent()) ?? "";
    const seen = await look(readAt(cursor));
    expect(seen.ring, name).toBe("");
    keyed.set(name, seen);
    await step();
  }
  for (const [name, seen] of keyed) {
    const row = rows.filter({ hasText: name }).first();
    await row.hover();
    await expect(cursor).toContainText(name);
    expect(await look(readAt(row)), name).toEqual(seen);
  }
}

test("a neutral key, an accent key and a danger-on-hover key", async ({ daemon, page }) => {
  await seedAndOpen(page, daemon);
  for (const name of ["Request changes", "Reject"]) {
    await expectFocusLooksLikeHover(page, page.getByRole("button", { name, exact: true }));
  }
  await expectFocusLooksLikeHover(page, page.getByRole("button", { name: "Approve", exact: true }));
});

test("every segment, the chosen one too", async ({ daemon, page }) => {
  await seedAndOpen(page, daemon);
  const well = (await openSettings(page)).locator("[data-slot='toggle-group']").first();
  const segments = well.locator("[data-slot='toggle-group-item']");
  const focused = well.locator("[data-slot='toggle-group-item']:focus");
  await expect(segments.and(well.locator("[data-state='on']"))).toHaveCount(1);
  await page.mouse.move(0, 0);
  await tabTo(page, well.locator("[tabindex='0']"));

  const keyed: Look[] = [];
  for (let i = 0; i < (await segments.count()); i++) {
    const at = await focused.evaluate((el) => [...(el.parentElement?.children ?? [])].indexOf(el));
    keyed[at] = await look(focused);
    expect(keyed[at]?.ring).toBe("");
    await page.keyboard.press("ArrowRight");
  }
  await focused.evaluate((el) => (el as HTMLElement).blur());
  for (const [i, seen] of keyed.entries()) {
    await segments.nth(i).hover();
    expect(await look(segments.nth(i)), `segment ${i}`).toEqual(seen);
  }
});

test("a settings nav row and the chosen one", async ({ daemon, page }) => {
  await seedAndOpen(page, daemon);
  const dialog = await openSettings(page);
  const rows = dialog.locator("[data-slot='sidebar-menu-button']");
  await expectFocusLooksLikeHover(page, rows.and(dialog.locator("[data-active='true']")));
  await expectFocusLooksLikeHover(
    page,
    rows.and(dialog.locator(":not([data-active='true'])")).first(),
  );
});

// The case the reviewer named: walking the breadcrumbs menu with the keys.
const filler = (label: string) =>
  Array.from({ length: 30 }, (_, i) => `${label} detail line ${i + 1}.`).join("\n");
const TRAIL_PLAN = [
  "# Alpha",
  filler("Alpha"),
  "## Bravo",
  filler("Bravo"),
  "## Delta",
  filler("Delta"),
  "## Foxtrot",
  filler("Foxtrot"),
].join("\n\n");

test("a crumb, and every row of its menu, the current one too", async ({ daemon, page }) => {
  await daemon.seed({ plan: TRAIL_PLAN });
  await page.goto("/");
  await planSurface(page);
  await jumpToHeading(page, "Delta");
  const crumbs = page.getByRole("navigation", { name: "Plan location" }).locator("button.crumb");
  await expect(crumbs).toHaveText(["Alpha", "Delta"]);
  await expectFocusLooksLikeHover(page, crumbs.first());

  await waitPastSafeModeGrace(page);
  await page.keyboard.press("b");
  const menu = page.locator("[data-slot='dropdown-menu-content']");
  const rows = menu.getByRole("menuitem");
  await expect(rows).toHaveText(["Bravo", "Delta", "Foxtrot"]);
  await page.keyboard.press("ArrowDown");
  await expectKeyedRowsLookPointed({
    rows,
    cursor: menu.locator("[data-highlighted]"),
    step: () => page.keyboard.press("ArrowDown"),
  });
});

test("a listbox option and the chosen option", async ({ daemon, page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await seedAndOpen(page, daemon);
  await openSettings(page);
  await waitPastSafeModeGrace(page);
  const trigger = page.getByRole("combobox", { name: "Light theme" });
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  const menu = page.locator(".setting-menu");
  await expect(menu.locator("[data-active='true']")).toHaveAttribute("data-highlighted", "");
  await expectKeyedRowsLookPointed({
    rows: menu.getByRole("option"),
    cursor: menu.locator("[data-highlighted]"),
    step: () => page.keyboard.press("ArrowDown"),
  });
});

test("an outline row and the one being read", async ({ daemon, page }) => {
  await daemon.seed({ plan: TRAIL_PLAN });
  await page.goto("/");
  await planSurface(page);
  await jumpToHeading(page, "Bravo");
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("bravo");
  await page.keyboard.press("\\");
  const panel = page.locator(".plan-outline");
  const rows = panel.getByRole("option");
  await expect(rows.first()).toBeVisible();
  await expect(rows.and(panel.locator("[aria-current='location']"))).toHaveAttribute(
    "data-selected",
    "",
  );
  await expectKeyedRowsLookPointed({
    rows,
    cursor: rows.and(panel.locator("[data-selected]")),
    step: () => page.keyboard.press("ArrowDown"),
    readAt: (row) => row.locator(".toc-key"),
  });
});

test("a comment navigator row", async ({ daemon, page }) => {
  await openWithPendingAnnotation(daemon, page, "tighten the retry budget");
  await waitPastSafeModeGrace(page);
  await commentTally(page).click();
  const row = commentNavigator(page).locator("button[data-nav-row]");
  await expect(row).toHaveCount(1);
  await expectFocusLooksLikeHover(page, row);
});

test("the folder tree's chosen row and a row beside it", async ({ daemon, page }) => {
  const proj = await makeProject({
    "src/cache.ts": "export const cache = new Map();\n",
    "src/lib/util.ts": "export {};\n",
  });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nThe tree under `src` matters.\n" });
    await page.goto("/");
    await planSurface(page);
    await page.locator('[data-file-ref="directory"]').click();
    const card = "[data-folder-tree]";
    const chosen = page.locator(`${card} [data-item-path="lib/"]`);
    const beside = page.locator(`${card} [data-item-path="cache.ts"]`);
    await chosen.click();
    await expect(chosen).toHaveAttribute("data-item-selected", "true");
    await waitPastSafeModeGrace(page);
    await page.mouse.move(0, 0);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(beside).toHaveAttribute("data-item-focused", "true");
    const keyedBeside = await look(beside);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(chosen).toHaveAttribute("data-item-focused", "true");
    const keyedChosen = await look(chosen);
    for (const seen of [keyedBeside, keyedChosen]) expect(seen.ring).toBe("");

    await beside.hover();
    expect(await look(beside)).toEqual(keyedBeside);
    await page.keyboard.press("ArrowDown");
    await chosen.hover();
    expect(await look(chosen)).toEqual(keyedChosen);
  } finally {
    await proj.cleanup();
  }
});

test("a link in the preview", async ({ daemon, page }) => {
  await daemon.seed({ plan: "# Plan\n\nSee [the docs](https://example.com/docs) first.\n" });
  await page.goto("/");
  await planSurface(page);
  await previewToggle(page).click();
  await expectFocusLooksLikeHover(page, page.locator(".plan-preview a"));
});

test("the file preview's close key", async ({ daemon, page }) => {
  const proj = await makeProject({ "src/cache.ts": "export const cache = new Map();\n" });
  try {
    const preview = await openFileRefPreview(
      page,
      daemon,
      proj.dir,
      "# Refs\n\nSee `src/cache.ts`.\n",
    );
    await expectFocusLooksLikeHover(page, preview.getByRole("button", { name: "Close preview" }));
  } finally {
    await proj.cleanup();
  }
});

// The pointer reveals the gutter "+" and its leaving hides it, but a "+" that holds keyboard
// focus is where the keys are, so it stays until the focus moves on.
test("the gutter + stays while it holds keyboard focus", async ({ daemon, page }) => {
  await seedAndOpen(page, daemon);
  await waitPastSafeModeGrace(page);
  const plus = await revealGutterPlus(page, 3);
  await tabTo(page, plus);
  // The library hides the "+" inside the leave's dispatch, which the move awaits.
  await page.mouse.move(0, 0);
  await expect(plus).toBeVisible();
  await expect(plus).toBeFocused();
});

test("the gutter + goes once keyboard focus leaves it with the pointer away", async ({
  daemon,
  page,
}) => {
  await seedAndOpen(page, daemon);
  await waitPastSafeModeGrace(page);
  const plus = await revealGutterPlus(page, 3);
  await tabTo(page, plus);
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await expect(plus).toBeHidden();
});

test("a saved comment's chip lifts its card under keys as under the pointer, and wears no band", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "Configurable TTL?" }],
  });
  await page.goto("/");
  await planSurface(page);
  const card = page.locator("[data-annotation-card='ann-1']");
  const chip = card.locator("button.chip");

  await page.mouse.move(0, 0);
  const restCard = await look(card);
  const restChip = await look(chip);
  await tabTo(page, chip);
  const keyed = { card: await look(card), chip: await look(chip) };
  expect(keyed.card).not.toEqual(restCard);
  expect(keyed.chip.face).toBe(restChip.face);

  await chip.evaluate((el) => (el as HTMLElement).blur());
  await chip.hover();
  expect({ card: await look(card), chip: await look(chip) }).toEqual(keyed);
});
