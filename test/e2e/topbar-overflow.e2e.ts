// TopBar narrow-width consolidation (EXC-810). At/below --w-narrow the Reject +
// Request-changes buttons collapse into a "More actions" overflow menu; at/below
// --w-tight the Approve label clips so the primary shrinks to its check icon.
// These are CSS width-driven swaps plus bits-ui overlay interaction — real
// browser behavior, not happy-dom units (doc/agents/browser-testing.md). The
// fixture daemon declares no adapter variants, so Approve renders as the
// split-button (WIRE_FALLBACK set), i.e. .split-primary / .split-toggle.

import { expect, test } from "@test/e2e/support/fixtures.ts";

test("wide: secondaries are inline and the overflow menu is hidden", async ({ daemon, page }) => {
  await daemon.seed();
  // Fixture viewport is REFERENCE_WIDTH_PX + 200 = 1600, above every breakpoint.
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await expect(page.locator(".reject")).toBeVisible();
  await expect(page.locator(".request")).toBeVisible();
  await expect(page.locator(".overflow-trigger")).toBeHidden();
  // The Approve control reads inline at wide width.
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
  await expect(page.locator(".diff-plan")).toBeVisible();

  await page.setViewportSize({ width: 500, height: 800 });

  // The inline secondaries hide; the overflow trigger takes their place.
  await expect(page.locator(".reject")).toBeHidden();
  await expect(page.locator(".request")).toBeHidden();
  const trigger = page.getByRole("button", { name: "More actions" });
  await expect(trigger).toBeVisible();
  // The pending count rides the trigger so it stays visible in the collapsed row.
  await expect(trigger.locator(".count")).toHaveText("2");

  // Opening the menu surfaces both actions.
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Request changes" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Reject" })).toBeVisible();

  // Request changes routes through to its dialog.
  await page.getByRole("menuitem", { name: "Request changes" }).click();
  await expect(page.getByRole("dialog", { name: "Send the plan back for revision" })).toBeVisible();
});

test("narrow: the reject action still resolves from the overflow menu", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await page.setViewportSize({ width: 500, height: 800 });

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Reject" }).click();
  // Reject always confirms (EXC-685); confirming denies the plan and clears the
  // queue — proving the collapsed action is fully wired, not just visible.
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
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
  await expect(page.locator(".diff-plan")).toBeVisible();

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
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await page.setViewportSize({ width: 600, height: 800 }); // below --w-tight (640)

  // The inline Approve control is gone; only ⋯ + bell + settings remain right.
  await expect(page.locator(".approve-slot")).toBeHidden();

  // Approve — with its variants — is reachable in the overflow menu, and
  // approving from there resolves the review through the confirm dialog.
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Approve & accept edits" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Approve & auto mode" }).click();
  const confirm = page.getByRole("dialog", { name: "Approve this plan?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
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
  await expect(page.locator(".diff-plan")).toBeVisible();
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

test("the overflow Reject glyph is red like its label", async ({ daemon, page }) => {
  // The destructive menu row's leading X should read the same danger red as its
  // label — a real-rendering (computed color) check, so it's an e2e. caret's Icon
  // nests the svg in a span, which the shadcn base rule tints muted; the fix makes
  // the destructive variant reach that nested glyph.
  await daemon.seed();
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await page.getByRole("button", { name: "More actions" }).click();
  const reject = page.getByRole("menuitem", { name: "Reject" });
  await expect(reject).toBeVisible();
  const { labelColor, glyphColor } = await reject.evaluate((el) => ({
    labelColor: getComputedStyle(el).color,
    glyphColor: getComputedStyle(el.querySelector("svg") as SVGElement).color,
  }));
  // The glyph matches the red label, not the muted-foreground grey the base rule
  // gives other menu icons.
  expect(glyphColor).toBe(labelColor);
});
