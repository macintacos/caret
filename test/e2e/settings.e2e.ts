// The two-pane Settings shell (EXC-843): a category sidebar + a registry-rendered
// pane whose edits apply IMMEDIATELY — no staged draft, no Save/Discard. Picking a
// value writes it, retints/reflows the app live, and confirms with a bottom-right
// toast. Navigation, live apply, persistence across reload, and Esc-dismiss are all
// real-browser behavior (focus, portalled menus, keyboard, localStorage across
// reload), so this lives here, not in a unit (per doc/agents/browser-testing.md). A
// palette pick uses a mouse CLICK on the portalled option, sidestepping the
// keyboard-focus race that quarantined the old live-preview picker (EXC-796).
//
// The appearance specs (EXC-773) drive page.emulateMedia: caret follows the OS by
// default, so the emulated prefers-color-scheme — pinned to dark in the project
// config — is what a fresh origin resolves against.
//
// The label specs (EXC-1112) are here for the same reason: whether a <label> forwards a
// click to its control, and what accessible name a browser then computes, are both
// engine behaviour that happy-dom does not model.

import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

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
  await planSurface(page);

  await openSettings(page);

  // Appearance is the (only) pane; Diff view is now a section within it, not its own
  // nav row.
  await expect(page.locator("[data-category='Appearance']")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator("[data-category='Diff view']")).toHaveCount(0);

  // Its controls all live in the one pane: the theme block, shortcut hints, and the
  // diff prefs. All three modes are readable at once — the point of a segmented
  // control over a dropdown here.
  await expect(page.getByRole("radio", { name: "Light", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "System", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Light theme" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dark theme" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Shortcut hints" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Layout" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change markers" })).toBeVisible();

  // No staged-edit chrome — edits apply immediately.
  await expect(page.locator(".save-chip")).toHaveCount(0);
});

// Appearance mode (EXC-773). A fresh origin follows the OS, which the project config
// emulates as dark; the whole point is that the resolution is live, so these drive
// page.emulateMedia rather than seeding a stored theme. (That lever was inert while
// caret ignored prefers-color-scheme — it is the real one again under `system`.)
test("a fresh origin follows the system, in both directions", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Flipping the OS retints the running app — no reload, no re-pick.
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("pinning a mode overrides the system and persists across a reload", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openSettings(page);

  // Pin Light while the emulated OS is dark: the whole UI retints AT ONCE, with no
  // Save step, the modal stays open, and a success toast confirms it.
  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Mode updated")).toBeVisible();

  // Pinned means pinned: an OS flip no longer moves it.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // And the choice survives a reload (browser localStorage, no daemon state).
  await page.reload();
  await planSurface(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("both theme slots stay visible, and the IN USE marker tracks the live one", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openSettings(page);

  // Neither slot is hidden behind the current mode — that pairing is the feature.
  const lightRow = page.locator("[data-field='themeLight']");
  const darkRow = page.locator("[data-field='themeDark']");
  await expect(lightRow).toBeVisible();
  await expect(darkRow).toBeVisible();

  // The emulated OS is dark, so the dark slot is the live one.
  await expect(darkRow.getByText("In use")).toBeVisible();
  await expect(lightRow.getByText("In use")).toHaveCount(0);
  await expect(page.locator("[data-theme-summary]")).toContainText("Following your system");

  // An OS flip while the modal is open moves the marker and rewrites the readout,
  // live — the reviewer sees why the app just changed colour.
  await page.emulateMedia({ colorScheme: "light" });
  await expect(lightRow.getByText("In use")).toBeVisible();
  await expect(darkRow.getByText("In use")).toHaveCount(0);
  await expect(page.locator("[data-theme-summary]")).toContainText("caret light");
});

test("picking a slot's palette applies it immediately when that slot is live", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await openSettings(page);

  // The dark slot is live under the emulated dark OS, so changing its palette applies at
  // once — no Save step — and confirms with its own toast. The pick is a DIFFERENT
  // palette than the one already selected: the control is a listbox, so re-picking the
  // current value commits nothing, exactly as a native <select> does (EXC-1111).
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.getByRole("option", { name: "GitHub Dark" }).click();
  await expect(page.getByText("Dark theme updated")).toBeVisible();

  // The chrome repainted from GitHub Dark's own tokens, and the slot is still the live
  // one — applying a palette to the live slot never changes which slot that is.
  await expect(page.locator("html")).toHaveAttribute("style", /--paper:\s*#0d1117/i);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

// The distinct computed colors of the plan row carrying `text`, read inside the diff
// view's shadow root — where the shiki tokens live, so this is the rendered syntax
// color rather than a token value read back out of the registry.
function rowColors(page: import("@playwright/test").Page, text: string): Promise<string[]> {
  return page.evaluate((needle) => {
    const shadow = document.querySelector(".diffview")?.shadowRoot;
    for (const row of shadow?.querySelectorAll("[data-line]") ?? []) {
      if ((row.textContent ?? "").includes(needle)) {
        return [...row.querySelectorAll("span")].map((s) => getComputedStyle(s).color);
      }
    }
    return [];
  }, text);
}

// EXC-752: a palette from outside caret's own pair has to land on BOTH halves of the
// app — the chrome repaints from its tokens, and the code the reviewer is reading
// retints with it. Dracula is the pick precisely because nothing in it is caret's
// amber, so "the heading is still amber" is an unambiguous failure.
test("picking a vendor palette retints the chrome and the code", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  // The emulated OS is dark, so the dark slot is live: caret dark, amber headings.
  // Computed styles come back in decimal, so the two assertions below spell caret
  // dark's --accent (#ff8f3d) as rgb() — grep both forms when the palette is revised.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => rowColors(page, "Widget Cache Refactor")).toContain("rgb(255, 143, 61)");

  await openSettings(page);
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.getByRole("option", { name: "Dracula" }).click();
  await expect(page.getByText("Dark theme updated")).toBeVisible();

  // The chrome repaints from Dracula's own tokens, and the block still explains
  // which slot is showing.
  await expect(page.locator("html")).toHaveAttribute("style", /--paper:\s*#21222c/i);
  await expect(page.locator("[data-field='themeDark']").getByText("In use")).toBeVisible();
  await expect(page.locator("[data-theme-summary]")).toContainText("Dracula");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);

  // And so does the code: the plan's heading is Dracula purple, not caret amber.
  await expect.poll(() => rowColors(page, "Widget Cache Refactor")).toContain("rgb(189, 147, 249)");
  // Read once more and assert the amber is gone. Asserted on a resolved non-empty
  // array rather than inside a poll, so a row that stopped matching can't satisfy
  // "no amber" by returning nothing.
  const retinted = await rowColors(page, "Widget Cache Refactor");
  expect(retinted.length).toBeGreaterThan(0);
  expect(retinted).not.toContain("rgb(255, 143, 61)");

  // EXC-896: the fenced block is upstream Dracula's own highlighting, not caret's
  // own authored theme wearing Dracula's hues. Dracula paints `function` its pink
  // (#ff79c6) — a hue caret's named color set does not carry, so caret's pair
  // cannot produce it at any scope.
  await expect.poll(() => rowColors(page, "function warm")).toContain("rgb(255, 121, 198)");
});

// Back-compat (EXC-773): a user who picked a theme under the pre-mode model must not
// have that explicit choice silently replaced by the new `system` default. Seeded
// through the real boot path, with the emulated OS set the OTHER way so an unmigrated
// build would visibly resolve dark.
test("a pre-mode caret.theme pick migrates to an explicit mode", async ({ daemon, page }) => {
  await page.addInitScript(() => localStorage.setItem("caret.theme", "caret-light"));
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  // The stored light pick became mode=light, which holds against the dark OS.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.evaluate(() => localStorage.getItem("caret.theme.mode"))).resolves.toBe(
    "light",
  );
  // Self-erasing: the legacy key is gone, so the migration never runs twice.
  await expect(page.evaluate(() => localStorage.getItem("caret.theme"))).resolves.toBeNull();
});

test("hovering a theme option previews its palette beside the menu, without applying it (EXC-753)", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  // The emulated OS is dark, so the dark slot is live.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await openSettings(page);
  // Open the LIGHT slot's menu while dark is showing — the palette being previewed is
  // deliberately not the live one, so "preview without applying" is unambiguous.
  await page.getByRole("button", { name: "Light theme" }).click();

  // An abstract preview card appears beside the open panel — before any selection. A
  // listbox always has an active option, so the slot's own palette (caret light, accent
  // #c2490d) is previewed as soon as the panel opens.
  const preview = page.locator("[data-slot='theme-preview']");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("style", /--accent:\s*#c2490d/i);

  // Hovering a DIFFERENT palette re-tints the card to that one. It has to be a different
  // one: hovering the option already highlighted moves nothing, so the assertion would
  // hold whether or not the hover did anything at all.
  await page.getByRole("option", { name: "GitHub Light" }).hover();
  await expect(preview).toHaveAttribute("style", /--accent:\s*#0969da/i);

  // Applied inline on the card only — the real app is NOT retinted on hover: html stays
  // dark until a click.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // The previewed SCHEME is scoped to the card too (EXC-884): it stamps data-theme and
  // an inline color-scheme, so scheme-keyed rules inside it resolve light while the
  // document around it stays dark. color-scheme on a non-root element is legal CSS and
  // is what keeps the card's own form controls / scrollbars in the previewed scheme.
  await expect(preview).toHaveAttribute("data-theme", "light");
  await expect(preview).toHaveAttribute("style", /color-scheme:\s*light/i);

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

  // Exactly one at a time — closing this panel and opening the other slot's swaps the
  // single card to that slot's palette rather than stacking a second.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute("style", /--accent:\s*#ff8f3d/i);
});

test("keyboard-highlighting a theme option previews it too (EXC-753)", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openSettings(page);
  // This spec's first keypress lands ~120ms after the plan renders, well inside the
  // 300ms safe-mode grace window armed at mount — which swallows it capture-phase, so
  // the menu never roves and no preview appears. Fast machines lose that race; slow ones
  // don't, which is the whole flake.
  await waitPastSafeModeGrace(page);
  await page.getByRole("button", { name: "Light theme" }).click();

  // A listbox always has an active option, so the selected palette's card is already up
  // when the panel opens. Read it first — otherwise "a card is visible" after the keypress
  // would pass without the keyboard having moved anything.
  const preview = page.locator("[data-slot='theme-preview']");
  await expect(preview).toBeVisible();
  const atOpen = await preview.getAttribute("style");

  // Roving the panel with the keyboard moves the highlight (bits-ui drives
  // aria-activedescendant rather than focus), which re-tints the card just as a hover
  // does — the keyboard clause of the acceptance criteria.
  await page.keyboard.press("ArrowDown");
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.getAttribute("style")).not.toBe(atOpen);
});

// The reopen path (the reported glitch): after switching themes, reopening the menu and
// highlighting an option used to intermittently strand the preview in the top-left corner,
// because the card was positioned from a measurement of the menu taken synchronously —
// before bits-ui had asynchronously positioned it (Floating UI applies the menu's transform
// a microtask after mount). The card now measures on the next animation frame, after that
// microtask, so it lands beside the menu — aligned to its top — no matter how fast the
// reopen is.
test("reopening the theme menu after a switch keeps the preview beside the menu, not at the origin (EXC-753)", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openSettings(page);

  // Commit a palette — the panel closes on pick. A palette other than the one already
  // selected, since re-picking the current value commits nothing (EXC-1111).
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.getByRole("option", { name: "Dracula" }).click();
  await expect(page.getByText("Dark theme updated")).toBeVisible();

  // Reopen and highlight the first option — the fast reopen that raced the menu's async
  // positioning in the bug report.
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.locator(".setting-menu [role='option']").first().hover();

  const preview = page.locator("[data-slot='theme-preview']");
  await expect(preview).toBeVisible();

  const menuBox = await page.locator(".setting-menu").boundingBox();
  const cardBox = await preview.boundingBox();
  const vp = page.viewportSize();
  expect(cardBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  if (cardBox && menuBox && vp) {
    // Beside the menu (either side), fully within the viewport.
    const clearsRight = cardBox.x >= menuBox.x + menuBox.width - 1;
    const clearsLeft = cardBox.x + cardBox.width <= menuBox.x + 1;
    expect(clearsRight || clearsLeft).toBe(true);
    expect(cardBox.x).toBeGreaterThanOrEqual(0);
    expect(cardBox.y).toBeGreaterThanOrEqual(0);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(vp.width);
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(vp.height);
    // Aligned to the menu top — NOT stranded in the top-left corner, where the glitch left
    // it near y≈8 while the menu opened far lower down the pane.
    expect(Math.abs(cardBox.y - menuBox.y)).toBeLessThan(40);
  }
});

// Real labels (EXC-1112). Both halves of the claim are real-browser behaviour: whether a
// <label> forwards its click to the control, and what name the browser computes for that
// control once it has one. A unit test can assert the for/id attributes but neither of
// these — and every other locator in this file passes `name` without `exact`, which
// matches on substring, so a name that silently GREW would satisfy all of them.
// toHaveAccessibleName is exact, which is the point of asserting it here.
test("clicking a row's label reaches its control, and names it", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "Settings" });

  // The switch is a <button>, so it is labelable: the label forwards its click.
  const hints = dialog.getByRole("switch");
  await expect(hints).toHaveAccessibleName("Shortcut hints");
  await expect(hints).toBeChecked();
  await dialog.locator("#setting-shortcutHints-label").click();
  await expect(hints).not.toBeChecked();
  await expect(page.getByText("Shortcut hints updated")).toBeVisible();

  // A menu trigger is a <button> too, so the label click lands on it.
  await dialog.locator("#setting-diffStyle-label").click();
  await expect(dialog.locator("#setting-diffStyle")).toBeFocused();
  await page.keyboard.press("Escape");

  // The names come from the visible label rather than a parallel string. The theme rows
  // are the pair that could regress unseen: their IN USE badge sits inside the label, so
  // it is aria-hidden to keep the trigger's name off the live scheme — without that these
  // read "Light theme In use" and move between rows on an OS flip.
  await expect(dialog.locator("#setting-diffStyle")).toHaveAccessibleName("Layout");
  await expect(dialog.locator("#setting-diffIndicators")).toHaveAccessibleName("Change markers");
  await expect(dialog.locator("#setting-themeLight")).toHaveAccessibleName("Light theme");
  await expect(dialog.locator("#setting-themeDark")).toHaveAccessibleName("Dark theme");

  // The segmented Mode control is a <div role="group">, which no <label for> can bind to;
  // it takes its name from that same label through aria-labelledby.
  await expect(dialog.locator("[data-slot='toggle-group']")).toHaveAccessibleName("Mode");
});

test("toggling shortcut hints applies immediately and persists", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await expect(page.locator(topbarHints).first()).toBeVisible();

  await openSettings(page);

  // Toggle off: the hint chrome disappears live (no Save), and a toast confirms it.
  await page.getByRole("switch", { name: "Shortcut hints" }).click();
  await expect(page.locator(topbarHints)).toHaveCount(0);
  await expect(page.locator(keyboardButton)).toHaveCount(0);
  await expect(page.getByText("Shortcut hints updated")).toBeVisible();

  // Persists across a reload.
  await page.reload();
  await planSurface(page);
  await expect(page.locator(keyboardButton)).toHaveCount(0);
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
  await page.getByRole("button", { name: "Versions" }).click();
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
  await page.getByRole("option", { name: "Unified" }).click();
  await expect(pre).toHaveAttribute("data-diff-type", "single");
});

test("Esc closes the settings modal", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openSettings(page);
  await waitPastSafeModeGrace(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
});

test("only the selected category is filled — an unselected nav row is transparent", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openSettings(page);

  // Appearance is selected by default; Notifications is not. sidebar-menu-button.svelte
  // keys its accent fill on `data-[active=true]:`; stock's bare `data-active:` matches on
  // the mere PRESENCE of the attribute, and Svelte serializes the unselected row as
  // data-active="false" — so a revert paints every row with the grey accent fill at rest
  // and it rivals the amber selection (EXC-847 regression, EXC-1117 fix). Assert in a real
  // browser: the unselected row is transparent, the selected row is not.
  // test/structure/shadcn-data-variants.test.ts is the cheaper guard and reds first.
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
  await planSurface(page);

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
  await page.waitForFunction(() => (window as unknown as NotesWindow).__notes.length === 1);
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
  await planSurface(page);

  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const search = dialog.getByRole("textbox", { name: "Search settings" });

  // "theme" leaves the whole appearance block intact — all three of its fields carry
  // the word, so the mode control never ends up stranded from its slots. The other
  // Appearance fields drop, and Appearance is the only category with a match, so the
  // search-only categories drop.
  await search.fill("theme");
  await expect(dialog.locator("[data-field='themeMode']")).toBeVisible();
  await expect(dialog.locator("[data-field='themeLight']")).toBeVisible();
  await expect(dialog.locator("[data-field='themeDark']")).toBeVisible();
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
  await planSurface(page);

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
  await planSurface(page);

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
  await expect(dialog).toHaveCount(0);
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
  await planSurface(page);

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
  await planSurface(page);
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

  // Edit #2 (Appearance): pin Light — the whole UI retints at once, with its own toast,
  // and the IN USE marker follows to the light slot.
  await dialog.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByText("Mode updated")).toBeVisible();
  await expect(dialog.locator("[data-field='themeLight']").getByText("In use")).toBeVisible();

  // Search across categories: "daemon" matches only the Advanced pane's entry, so the
  // Appearance fields filter away and the Advanced nav row surfaces.
  const search = dialog.getByRole("textbox", { name: "Search settings" });
  await search.fill("daemon");
  await expect(dialog.locator("[data-category='Advanced']")).toBeVisible();
  await expect(dialog.locator("[data-field='themeLight']")).toHaveCount(0);

  // Clearing the query restores the full nav. Emptying the field fires a bubbling input
  // event (Playwright's fill("") doesn't drive Svelte 5's bind:value empty in this build).
  await search.evaluate((el) => {
    (el as HTMLInputElement).value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(dialog.locator("[data-field='themeLight']")).toBeVisible();

  // Cross into a second category: the Notifications nav row swaps the field pane for the
  // live pane, which reflects the injected grant.
  await dialog.locator("[data-category='Notifications']").click();
  await expect(dialog.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.locator("[data-notifications-pane]")).toHaveAttribute(
    "data-permission",
    "granted",
  );
});

// Scoped shortcuts (EXC-849): while the Settings modal owns the view, only the
// shortcuts valid there are active — the review keybinds are inert and the `?` help
// lists just the settings view's shortcuts, not the whole review keymap. daemon.seed()
// gives an active review, so a/r carry live runs whose suppression is observable.
test("while Settings is open, the review shortcuts are inert underneath", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openSettings(page);
  await waitPastSafeModeGrace(page);

  const contents = page.locator("[data-slot='dialog-content']");
  await expect(contents).toHaveCount(1); // just Settings

  // r would open Request Changes and a the approve guard — each a dialog that would
  // stack a second content. Under the settings scope the dispatcher fires neither, so
  // no review action leaks past the modal.
  await page.keyboard.press("r");
  await page.keyboard.press("a");
  await expect(contents).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

test("? over Settings lists only the settings-view shortcuts, not the review keymap", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openSettings(page);
  await waitPastSafeModeGrace(page);

  // ? opens the help over Settings (a global shortcut, still active in the modal scope).
  await page.keyboard.press("?");
  const help = page.locator("[data-slot='dialog-content']").last();
  await expect(help).toBeVisible();

  // With only a section or two, the help drops to a single column (fitsSingleColumn),
  // not the wide multi-column keymap.
  await expect(help.locator(".help-groups")).toHaveCSS("column-count", "1");

  // The settings-scoped affordances plus the global ? — exactly what works in this view.
  await expect(help.getByText("Search settings")).toBeVisible();
  await expect(help.getByText("Close settings")).toBeVisible();
  await expect(help.getByText("Show shortcuts")).toBeVisible();

  // The review keymap is absent — those shortcuts are suppressed while Settings owns
  // the view, so listing them would advertise keys that do nothing here.
  await expect(help.getByText("Approve", { exact: true })).toHaveCount(0);
  await expect(help.getByText("Request changes")).toHaveCount(0);
});

// The Sound pane's volume slider (EXC-1101). Everything asserted here is engine
// behaviour happy-dom does not model: the accessible name a browser actually computes
// for a bits-ui thumb named through aria-labelledby, real keyboard on a focused
// element, and localStorage surviving a reload. The unit suites
// (ui/src/components/SettingSlider.test.ts, ui/src/lib/components/ui/slider/) cover
// the coalescing and the ARIA wiring; this covers that it works in a browser.
test("the volume slider is keyboard-operable, named, and persists", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.locator("[data-category='Sound']").click();

  // The slider's root is a <span>, so no <label for> can bind to it — the name has to
  // arrive via aria-labelledby, forwarded to the thumb that carries role="slider".
  // This is the assertion the vendored-file patch exists to satisfy.
  const slider = dialog.getByRole("slider");
  await expect(slider).toHaveAccessibleName("Volume");
  await expect(slider).toHaveAttribute("aria-valuenow", "25");
  await expect(dialog.locator("[data-field='soundVolume'] .readout")).toHaveText("25%");

  // The track has to actually be a track. slider.svelte sizes it with
  // `data-[orientation=horizontal]:h-1`; stock's bare `data-horizontal:` compiles to
  // `[data-horizontal]` while the component stamps `data-orientation="horizontal"`, so a
  // revert leaves the track 0px tall and invisible with every ARIA assertion above still
  // green (EXC-1117). This is what notices in a browser;
  // test/structure/shadcn-data-variants.test.ts is the cheaper guard and reds first.
  const box = await dialog.locator("[data-slot='slider-track']").boundingBox();
  expect(box?.height).toBeGreaterThan(0);
  expect(box?.width).toBeGreaterThan(0);
  const fill = await dialog.locator("[data-slot='slider-range']").boundingBox();
  expect(fill?.height).toBeGreaterThan(0);

  // Three steps of 5% from the keyboard, coalesced into one applied change.
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "40");
  await expect(dialog.locator("[data-field='soundVolume'] .readout")).toHaveText("40%");

  // Wait for the confirming toast before reloading — it is the app's own signal that the
  // write landed. Deliberately NOT a count assertion: toasts dwell 4s then exit, so a
  // retrying toHaveCount(1) would catch any stack of them mid-decay and pass even with
  // coalescing removed. It would also demand three CDP round-trips inside the app's own
  // 200ms window, i.e. a test required to outrun a deadline — the shape
  // browser-testing.md warns about for a loaded host. SettingSlider.test.ts pins the
  // coalescing deterministically with an injected timer; this spec owns what only a
  // browser can prove.
  await expect(page.getByText("Volume updated").first()).toBeVisible();

  // The level survives a reload: it is a persisted preference, not view state.
  await page.reload();
  await planSurface(page);
  await openSettings(page);
  await page.getByRole("dialog", { name: "Settings" }).locator("[data-category='Sound']").click();
  await expect(page.getByRole("dialog", { name: "Settings" }).getByRole("slider")).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
});

test("the volume slider reaches silence, which is a real setting", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);

  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.locator("[data-category='Sound']").click();

  // 0 is falsy, so a `||` anywhere on the read path would resurrect the default and
  // leave the left end of the track unreachable.
  await dialog.getByRole("slider").focus();
  await page.keyboard.press("Home");
  await expect(dialog.getByRole("slider")).toHaveAttribute("aria-valuenow", "0");
  await expect(dialog.locator("[data-field='soundVolume'] .readout")).toHaveText("0%");

  // Wait for the confirming toast, not a sleep: the slider applies once the reviewer
  // settles rather than on the keystroke, and the toast is the app's own signal that
  // the write landed. Reloading before it appears would discard the in-flight change
  // and test nothing.
  await expect(page.getByText("Volume updated")).toBeVisible();

  await page.reload();
  await planSurface(page);
  await openSettings(page);
  await page.getByRole("dialog", { name: "Settings" }).locator("[data-category='Sound']").click();
  await expect(page.getByRole("dialog", { name: "Settings" }).getByRole("slider")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
});
