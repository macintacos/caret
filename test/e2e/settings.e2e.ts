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
