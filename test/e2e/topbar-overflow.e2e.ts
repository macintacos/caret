// TopBar narrow-width consolidation (EXC-810). At/below --w-narrow the Reject +
// Request-changes buttons collapse into a "More actions" overflow menu; at/below
// --w-tight the Approve label clips so the primary shrinks to its check icon.
// These are CSS width-driven swaps plus bits-ui overlay interaction — real
// browser behavior, not happy-dom units (doc/agents/browser-testing.md). The
// fixture daemon declares no adapter variants, so Approve renders as the
// split-button (WIRE_FALLBACK set), i.e. .split-primary / .split-toggle.
//
// TopBar.svelte performs every swap here with `display: none` in a @media block,
// so no control is ever unmounted. The role queries below still read as absences
// because a display:none element is out of the accessibility tree; the one class
// locator, .approve-slot, resolves to the mounted node and so asserts hidden
// (doc/agents/browser-testing.md § Absence and invisibility).

import { reviewSwitcher } from "@test/e2e/support/chrome.ts";
import { approveViaVariant, assertResolved } from "@test/e2e/support/decision.ts";
import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface, seedAndOpen } from "@test/e2e/support/source-view.ts";

/** Seed a bare review, open it at the narrow width that collapses the secondary
 * verdicts into the overflow menu, and open that menu. Returns the review id. */
async function openNarrowOverflowMenu(
  daemon: Daemon,
  page: import("@playwright/test").Page,
): Promise<string> {
  await page.setViewportSize({ width: 500, height: 800 });
  const id = await seedAndOpen(page, daemon);
  await page.getByRole("button", { name: "More actions" }).click();
  return id;
}

test("wide: secondaries are inline and the overflow menu is hidden", async ({ daemon, page }) => {
  // Fixture viewport is REFERENCE_WIDTH_PX + 200 = 1600, above every breakpoint.
  await seedAndOpen(page, daemon);

  await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request changes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);
  await expect(page.locator(".approve-slot .split-primary")).toBeVisible();
});

test("narrow: secondaries collapse into the overflow menu, count preserved", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  // Two retained scratches → pendingCount 2, surfaced on the overflow trigger
  // once Request changes moves into the menu.
  await daemon.putDraft(id, {
    composerScratches: [
      { startLine: 7, endLine: 8, text: "a half-typed thought" },
      { startLine: 10, endLine: 11, text: "another" },
    ],
  });
  await page.goto("/");
  await planSurface(page);

  await page.setViewportSize({ width: 500, height: 800 });

  await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request changes" })).toHaveCount(0);
  const trigger = page.getByRole("button", { name: "More actions" });
  await expect(trigger).toBeVisible();
  // The pending count rides the trigger so it stays visible in the collapsed row.
  await expect(trigger.locator(".count")).toHaveText("2");

  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Request changes" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Reject" })).toBeVisible();

  await page.getByRole("menuitem", { name: "Request changes" }).click();
  await expect(page.getByRole("dialog", { name: "Send the plan back for revision" })).toBeVisible();
});

test("narrow: the reject action still resolves from the overflow menu", async ({
  daemon,
  page,
}) => {
  const id = await openNarrowOverflowMenu(daemon, page);
  await page.getByRole("menuitem", { name: "Reject" }).click();
  // Reject always confirms (EXC-685); confirming denies the plan and clears the
  // queue — proving the collapsed action is fully wired, not just visible.
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Reject", exact: true }).click();
  await assertResolved(daemon, page, id);
});

test("the right-hand controls stay on-screen across a width sweep", async ({ daemon, page }) => {
  // Regression: the topbar (a grid item of .shell) defaulted to min-width:auto, so
  // it grew its track to fit content — the flex row never felt shrink pressure, the
  // title held its 46vw cap, and Settings/bell/⋯ overflowed off-screen. min-width:0
  // pins the topbar to the viewport so the title truncates and the controls stay.
  await daemon.seed({
    plan: `# ${"caret dev — markdown rendering stress test ".repeat(2)}\n\n## Section\n\nBody.\n`,
  });
  await page.goto("/");
  await planSurface(page);

  for (const width of [1100, 1000, 900, 800, 720, 640, 560, 500, 480]) {
    await page.setViewportSize({ width, height: 400 });
    const { settingsRight, docScrollWidth } = await page.evaluate(() => ({
      settingsRight: document.querySelector(".settings")!.getBoundingClientRect().right,
      docScrollWidth: document.documentElement.scrollWidth,
    }));
    // Settings (the rightmost, pinned control) stays fully within the viewport...
    expect(settingsRight, `settings on-screen at ${width}px`).toBeLessThanOrEqual(width);
    // ...and the header never forces a horizontal scroll.
    expect(docScrollWidth, `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);
  }
});

test("tight: Approve moves into the overflow menu", async ({ daemon, page }) => {
  const id = await seedAndOpen(page, daemon);
  await page.setViewportSize({ width: 600, height: 800 }); // below --w-tight (640)

  await expect(page.locator(".approve-slot")).toBeHidden();

  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Approve & accept edits" })).toBeVisible();
  await approveViaVariant(daemon, page, "Approve & auto mode", id);
});

test("narrow: bell and settings stay visible while a long title truncates", async ({
  daemon,
  page,
}) => {
  // A long plan title that would otherwise crowd the right-hand controls.
  await daemon.seed({
    plan: `# ${"Extremely long plan title that would overflow the narrow header ".repeat(3)}\n\n## Section\n\nBody.\n`,
  });
  await page.goto("/");
  await planSurface(page);
  await page.setViewportSize({ width: 500, height: 800 });

  // Every right-hand control stays on screen...
  await expect(page.getByRole("button", { name: "More actions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Notifications/ })).toBeVisible();
  // ...and the header does not overflow — the title truncated to make room.
  const { scrollWidth, clientWidth } = await page
    .locator(".topbar")
    .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test("the overflow Reject row carries the Shift+R cap (EXC-913)", async ({ daemon, page }) => {
  // The collapsed row gets the same cap as the inline button, so all three verdicts
  // are keyed once they consolidate here. The menu Content is portalled, so this is
  // e2e rather than a TopBar unit (browser-testing.md).
  await openNarrowOverflowMenu(daemon, page);
  const cap = page.getByRole("menuitem", { name: "Reject" }).locator("[data-slot='kbd']");
  await expect(cap).toBeVisible();
  // The shift half is the shared icon, never a ⇧ character.
  await expect(cap.locator(".icon")).toHaveAttribute("aria-label", "Shift");
  await expect(cap).toHaveText("R");
});

test("the overflow Reject glyph is red like its label", async ({ daemon, page }) => {
  // The destructive menu row's leading X should read the same danger red as its
  // label — a real-rendering (computed color) check, so it's an e2e. caret's Icon
  // nests the svg in a span, which the shadcn base rule tints muted; the fix makes
  // the destructive variant reach that nested glyph.
  await openNarrowOverflowMenu(daemon, page);
  const reject = page.getByRole("menuitem", { name: "Reject" });
  await expect(reject).toBeVisible();
  const { labelColor, glyphColor } = await reject.evaluate((el) => ({
    labelColor: getComputedStyle(el).color,
    glyphColor: getComputedStyle(el.querySelector("svg") as SVGElement).color,
  }));
  expect(glyphColor).toBe(labelColor);
});

test("a long plan title truncates instead of running under the action buttons", async ({
  daemon,
  page,
}) => {
  // Regression: the switcher trigger is a shadcn Button, which carries `shrink-0`,
  // so `.lead` shrank past it and the trigger overflowed its own box — sliding
  // under the inline Reject / Request-changes chips instead of ellipsizing. The
  // band just above --w-narrow, where all three verdict buttons are still inline,
  // is where the title has to give; the widths below it are what bound the
  // trigger's min-width floor, since a floor too tall to fit the collapsed row
  // would put the trigger straight back under the controls.
  await daemon.seed({
    title: "caret dev — markdown rendering stress test — extra long plan title",
    cwd: "/tmp/proj-alpha",
  });
  await daemon.seed({ title: "Plan Beta", cwd: "/tmp/proj-beta" });
  await page.goto("/");
  await planSurface(page);
  await expect(reviewSwitcher(page)).toBeVisible();

  for (const width of [1400, 1200, 1100, 1024, 1000, 960, 900, 800, 720, 640, 560, 500, 480]) {
    await page.setViewportSize({ width, height: 400 });
    const slack = await page.evaluate(() => {
      const trigger = document.querySelector(".switcher-trigger")!.getBoundingClientRect();
      const actions = document.querySelector(".actions")!.getBoundingClientRect();
      return actions.left - trigger.right;
    });
    expect(slack, `the plan title runs under the actions at ${width}px`).toBeGreaterThanOrEqual(0);
  }
});
