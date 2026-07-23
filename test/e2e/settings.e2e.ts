// The two-pane Settings shell (EXC-843): a category sidebar + a registry-rendered
// pane whose edits apply IMMEDIATELY — no staged draft, no Save/Discard. Picking a
// value writes it, retints/reflows the app live, and confirms with a bottom-right
// toast. Navigation, live apply, persistence across reload, and Esc-dismiss are all
// real-browser behavior (focus, portalled menus, keyboard, localStorage across
// reload), so this lives here, not in a unit (per doc/agents/browser-testing.md). The
// theme pick uses a mouse CLICK on the portalled option, sidestepping the
// keyboard-focus race that quarantined the old live-preview picker (EXC-796).

import { expect, test, waitPastSafeModeGrace } from "./support/fixtures.ts";

const topbarHints = ".topbar [data-slot='kbd']";
const keyboardButton = "button[aria-label='Keyboard shortcuts']";

async function openSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

// Headless Chromium hard-codes Notification.permission to "denied" regardless of the
// context's grant (see notifications.e2e.ts), so the Notifications pane needs an
// injected permission. This granted stub also captures its constructions, so the
// test affordance's live fire is observable.
type NotesWindow = { __notes: { title: string }[] };
function initGrantedNotification() {
  const notes: { title: string }[] = [];
  (window as unknown as NotesWindow).__notes = notes;
  class StubNotification {
    title: string;
    constructor(title: string) {
      this.title = title;
      notes.push(this);
    }
    close() {}
    static get permission() {
      return "granted";
    }
    static requestPermission() {
      return Promise.resolve("granted");
    }
  }
  (window as { Notification: unknown }).Notification = StubNotification;
}

test("opens the Appearance pane with theme, hints, and the folded-in Diff view section", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);

  // Appearance is the (only) pane; Diff view is now a section within it, not its own
  // nav row.
  await expect(page.locator("[data-category='Appearance']")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator("[data-category='Diff view']")).toHaveCount(0);

  // Its controls all live in the one pane: theme, shortcut hints, and the diff prefs.
  await expect(page.getByRole("button", { name: "Theme" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Shortcut hints" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Layout" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change markers" })).toBeVisible();

  // No staged-edit chrome — edits apply immediately.
  await expect(page.locator(".save-chip")).toHaveCount(0);
});

test("picking a theme applies it immediately, confirms with a toast, and persists", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  // Fresh origin defaults to caret dark.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await openSettings(page);

  // Pick caret light: the whole UI retints AT ONCE, with no Save step, and the modal
  // stays open. A success toast confirms it.
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "caret light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Theme updated")).toBeVisible();

  // The choice persists across a reload (browser localStorage, no daemon state).
  await page.reload();
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("hovering a theme option previews its palette beside the menu, without applying it (EXC-753)", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  // Fresh origin defaults to caret dark.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await openSettings(page);
  await page.getByRole("button", { name: "Theme" }).click();

  // Hover the OTHER theme (caret light): an abstract preview card appears beside the
  // open menu — before any selection.
  await page.getByRole("menuitemradio", { name: "caret light" }).hover();
  const preview = page.locator("[data-slot='theme-preview']");
  await expect(preview).toBeVisible();

  // Tinted by caret light's palette (accent #c2410c), applied inline on the card only —
  // and the real app is NOT retinted on hover: html stays dark until a click.
  await expect(preview).toHaveAttribute("style", /--accent:\s*#c2410c/i);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Beside the menu, fully within the viewport (never clipped).
  const menuBox = await page.locator(".setting-menu").boundingBox();
  const cardBox = await preview.boundingBox();
  const vp = page.viewportSize();
  expect(cardBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  if (cardBox && menuBox && vp) {
    expect(cardBox.x).toBeGreaterThanOrEqual(0);
    expect(cardBox.y).toBeGreaterThanOrEqual(0);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(vp.width);
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(vp.height);
    // Beside, not over: the card sits entirely to one side of the menu.
    const clearsRight = cardBox.x >= menuBox.x + menuBox.width - 1;
    const clearsLeft = cardBox.x + cardBox.width <= menuBox.x + 1;
    expect(clearsRight || clearsLeft).toBe(true);
  }

  // Exactly one at a time — moving to the current option swaps it to caret dark.
  await page.getByRole("menuitemradio", { name: "caret dark" }).hover();
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute("style", /--accent:\s*#fb923c/i);
});

test("keyboard-highlighting a theme option previews it too (EXC-753)", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);
  await page.getByRole("button", { name: "Theme" }).click();

  // Roving the menu with the keyboard highlights an option (real focus), which surfaces
  // its preview just like a hover does — the keyboard clause of the acceptance criteria.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-slot='theme-preview']")).toBeVisible();
});

test("toggling shortcut hints applies immediately and persists", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.locator(topbarHints).first()).toBeVisible();

  await openSettings(page);

  // Toggle off: the hint chrome disappears live (no Save), and a toast confirms it.
  await page.getByRole("switch", { name: "Shortcut hints" }).click();
  await expect(page.locator(topbarHints)).toHaveCount(0);
  await expect(page.locator(keyboardButton)).toBeHidden();
  await expect(page.getByText("Shortcut hints updated")).toBeVisible();

  // Persists across a reload.
  await page.reload();
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.locator(keyboardButton)).toBeHidden();
});

test("changing the diff Layout in Settings reflows an open compare diff live", async ({
  daemon,
  page,
}) => {
  await daemon.seedVersions(3, [
    "# Plan\n\nalpha line one\n",
    "# Plan\n\nbeta line two\n",
    "# Plan\n\ngamma line three\n",
  ]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();
  // The library renders split as data-diff-type="split" and unified as "single".
  const pre = page.locator(".diffview pre").first();
  await expect(pre).toHaveAttribute("data-diff-type", "split");

  // Switch Layout → Unified in Settings: the diff behind the modal reflows at once,
  // no reload and no in-view picker — the diff prefs honor immediate apply too.
  await openSettings(page);
  await page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("button", { name: "Layout" })
    .click();
  await page.getByRole("menuitemradio", { name: "Unified" }).click();
  await expect(pre).toHaveAttribute("data-diff-type", "single");
});

test("Esc closes the settings modal", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);
  await waitPastSafeModeGrace(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
});

test("only the selected category is filled — an unselected nav row is transparent", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);

  // Appearance is selected by default; Notifications is not. shadcn's SidebarMenuButton
  // ships `data-active:bg-sidebar-accent`, and Tailwind matches that variant on the mere
  // PRESENCE of data-active — Svelte serializes the unselected row as data-active="false"
  // (attribute present), so without an explicit transparent it wears the grey accent fill
  // at rest and rivals the amber selection (EXC-847 regression). Assert in a real browser:
  // the unselected row is transparent, the selected row is not.
  const unselected = page.locator("[data-category='Notifications']");
  const selected = page.locator("[data-category='Appearance']");
  await expect(unselected).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(selected).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("the Notifications pane reflects the permission and its test affordance fires live", async ({
  daemon,
  page,
}) => {
  await page.addInitScript(initGrantedNotification);
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);

  // Switching to the Notifications category swaps the field pane for the live pane
  // (the first non-staged pane — a new real-browser flow this shell had no coverage
  // for). Its header reads Notifications and it reflects the injected grant.
  await page.locator("[data-category='Notifications']").click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.locator("[data-notifications-pane]")).toHaveAttribute(
    "data-permission",
    "granted",
  );

  // Granted → the diagnosis affordance; clicking it constructs exactly one toast
  // through the live path (the same probe the granted bell offers).
  await dialog.getByRole("button", { name: "Send a test notification" }).click();
  await page.waitForFunction(
    () => (window as unknown as NotesWindow).__notes.length === 1,
    undefined,
    { timeout: 5_000 },
  );
});

// Settings search (EXC-845): the query filters the nav + fields across categories, `/`
// focuses the search from anywhere in the modal, and Esc is two-stage (clear + refocus
// the dialog, then dismiss). Filtering, focus, and keyboard are all real-browser
// behavior, so they live here rather than in the component unit.
test("the search filters the nav and fields across categories; clearing restores them", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const search = dialog.getByRole("textbox", { name: "Search settings" });

  // "theme" leaves only the Theme field; the other Appearance fields drop, and
  // Appearance is the only category with a match — the search-only categories drop.
  await search.fill("theme");
  await expect(dialog.locator("[data-field='theme']")).toBeVisible();
  await expect(dialog.locator("[data-field='shortcutHints']")).toHaveCount(0);
  await expect(dialog.locator("[data-category='Appearance']")).toBeVisible();
  await expect(dialog.locator("[data-category='Advanced']")).toHaveCount(0);

  // Clearing the query restores the full nav and fields. Emptying the field fires a
  // bubbling input event (what a real keystroke fires) — Playwright's fill("") /
  // keyboard-delete don't drive Svelte 5's bind:value to empty in this build, so dispatch
  // it explicitly. (The two-stage Esc, another clear path, is covered below.)
  await search.evaluate((el) => {
    (el as HTMLInputElement).value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(search).toHaveValue("");
  await expect(dialog.locator("[data-field='shortcutHints']")).toBeVisible();
  await expect(dialog.locator("[data-category='Advanced']")).toBeVisible();
});

test("`/` focuses the search from anywhere in the modal; once focused, `/` types", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);
  await waitPastSafeModeGrace(page);
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const search = dialog.getByRole("textbox", { name: "Search settings" });

  // Focus rests on the dialog content after open, not the input.
  await expect(search).not.toBeFocused();
  // `/` moves focus into the search (the EXC-835 capture-phase pattern).
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  // Once it owns focus, `/` types a literal slash instead of re-focusing.
  await page.keyboard.press("/");
  await expect(search).toHaveValue("/");
});

test("Esc in the search clears the query and returns focus to the dialog; a second Esc dismisses", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);
  await waitPastSafeModeGrace(page);
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const search = dialog.getByRole("textbox", { name: "Search settings" });

  // Stage one: with a query in the focused search, Esc clears it and moves focus back
  // to the dialog — the modal stays open.
  await search.fill("theme");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).not.toBeFocused();
  await expect(dialog).toBeVisible();

  // Stage two: a second Esc, now with focus on the dialog content, dismisses.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

// Modal stacking + keyboard flow (EXC-849): `?` opens the shortcuts help ABOVE Settings,
// and `/` routes to the topmost modal's search — not whichever modal registered its
// capture-phase handler first (Settings always mounts first). Peeling the help off with Esc
// hands `/` back to Settings. Portal order, focus, and Escape layering are real-browser
// behavior, so this lives here rather than in a unit.
test("? stacks the shortcuts help over Settings; / routes to the topmost modal's search", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await openSettings(page);
  await waitPastSafeModeGrace(page);

  const contents = page.locator("[data-slot='dialog-content']");
  const settingsSearch = page.locator("input[aria-label='Search settings']");
  const helpSearch = page.locator("input[aria-label='Search shortcuts']");

  // ? opens the shortcuts help stacked above the still-open Settings — two dialogs.
  await page.keyboard.press("?");
  await expect(contents).toHaveCount(2);
  await expect(helpSearch).toBeVisible();

  // / focuses the TOPMOST modal's search (the help), NOT the base Settings search —
  // even though Settings' capture handler is registered first.
  await page.keyboard.press("/");
  await expect(helpSearch).toBeFocused();
  await expect(settingsSearch).not.toBeFocused();

  // Esc peels off just the topmost modal; Settings remains open beneath it.
  await page.keyboard.press("Escape");
  await expect(contents).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();

  // With Settings topmost again, / now claims the Settings search.
  await page.keyboard.press("/");
  await expect(settingsSearch).toBeFocused();
});

// The whole-journey cohesion pass (EXC-849): one flow that opens Settings, edits two
// Appearance settings live (each confirming with a toast), searches across categories, and
// crosses into a second category's live pane — the end-to-end path the redesign shipped,
// exercised as one continuous session rather than a per-feature slice.
test("drives the full journey: edit Appearance live, search across categories, open the Notifications pane", async ({
  daemon,
  page,
}) => {
  await page.addInitScript(initGrantedNotification);
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  // Fresh origin: caret dark, with the shortcut-hint chrome showing.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(topbarHints).first()).toBeVisible();

  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "Settings" });

  // Edit #1 (Appearance): shortcut hints off — the topbar chrome disappears live and a
  // toast confirms it, no Save step.
  await dialog.getByRole("switch", { name: "Shortcut hints" }).click();
  await expect(page.locator(topbarHints)).toHaveCount(0);
  await expect(page.getByText("Shortcut hints updated")).toBeVisible();

  // Edit #2 (Appearance): theme to caret light — the whole UI retints at once, with its
  // own toast.
  await dialog.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "caret light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByText("Theme updated")).toBeVisible();

  // Search across categories: "daemon" matches only the Advanced pane's entry, so the
  // Appearance fields filter away and the Advanced nav row surfaces.
  const search = dialog.getByRole("textbox", { name: "Search settings" });
  await search.fill("daemon");
  await expect(dialog.locator("[data-category='Advanced']")).toBeVisible();
  await expect(dialog.locator("[data-field='theme']")).toHaveCount(0);

  // Clearing the query restores the full nav. Emptying the field fires a bubbling input
  // event (Playwright's fill("") doesn't drive Svelte 5's bind:value empty in this build).
  await search.evaluate((el) => {
    (el as HTMLInputElement).value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(dialog.locator("[data-field='theme']")).toBeVisible();

  // Cross into a second category: the Notifications nav row swaps the field pane for the
  // live pane, which reflects the injected grant.
  await dialog.locator("[data-category='Notifications']").click();
  await expect(dialog.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.locator("[data-notifications-pane]")).toHaveAttribute(
    "data-permission",
    "granted",
  );
});
