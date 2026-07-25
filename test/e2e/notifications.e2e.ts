// Desktop notifications (EXC-427): the granted path is proven end-to-end —
// the 2s poll, the seen-set diff, the badge, and the notification's click
// wiring (URL + rendered plan flip) are all real; only two browser surfaces
// are stubbed, of necessity:
//
// - window.Notification constructions (an OS toast is unobservable to any
//   automated layer; the capturing stub records what the page constructed).
// - Notification.permission. Headless Chromium hard-codes this surface to
//   "denied" regardless of the context's actual permission state — verified
//   empirically: with Playwright's notifications grant in effect,
//   navigator.permissions.query reports "granted" while Notification.permission
//   still reads "denied" (and "denied" vs "prompt" without the grant). The page
//   reads the standard Notification.permission surface, so each test injects
//   the permission its scenario needs.
//
// The denied branch (red bell-off badge) is covered by unit tests only
// (ui/src/lib/notify.test.ts's bellPresentation cases) — the stub could fake
// it here, but that would re-prove the same pure mapping with no extra wiring.

import { SECOND_PLAN } from "@test/e2e/support/fixture-plan.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";

// Captured constructions of the stubbed Notification (see initStub).
interface CapturedNote {
  title: string;
  body: string;
  closed: boolean;
  onclick: (() => void) | null;
}

// The window globals the stub installs. Type-only, so it crosses the
// addInitScript/evaluate serialization boundary (a helper function couldn't).
type StubWindow = { __notes: CapturedNote[]; __vis?: string };

// Installed before any app code runs: a capturing Notification stub whose
// static permission is the injected per-test value (see header), plus an
// instance-level visibilityState override — headless tabs never report hidden
// naturally, and the notifier reads document.visibilityState at poll time.
function initStub(permission: string) {
  const notes: CapturedNote[] = [];
  (window as unknown as StubWindow).__notes = notes;
  class StubNotification implements CapturedNote {
    title: string;
    body: string;
    closed = false;
    onclick: (() => void) | null = null;
    constructor(title: string, options?: { body?: string }) {
      this.title = title;
      this.body = options?.body ?? "";
      notes.push(this);
    }
    close() {
      this.closed = true;
    }
    static get permission() {
      return permission;
    }
    static requestPermission() {
      return Promise.resolve(permission);
    }
  }
  (window as { Notification: unknown }).Notification = StubNotification;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get() {
      return (window as unknown as StubWindow).__vis ?? "visible";
    },
  });
}

test("a new plan while the tab is hidden notifies; its click selects the review", async ({
  daemon,
  page,
}) => {
  await page.addInitScript(initStub, "granted");
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan").getByText("Widget Cache Refactor")).toBeVisible();

  // The badge reflects the granted permission (green bell).
  await expect(page.getByRole("button", { name: "Notifications: granted" })).toBeVisible();

  // Hide the tab, then seed a second review through the API: the next poll
  // tick must construct exactly one notification for the genuinely-new id.
  await page.evaluate(() => {
    (window as unknown as StubWindow).__vis = "hidden";
  });
  const second = await daemon.seed({ plan: SECOND_PLAN });
  await page.waitForFunction(
    () => (window as unknown as StubWindow).__notes.length > 0,
    undefined,
    { timeout: 5_000 },
  );

  const note = await page.evaluate(() => {
    const [n] = (window as unknown as StubWindow).__notes;
    return { title: n?.title, body: n?.body };
  });
  expect(note.title).toBe("🥕 New Plan Ready");
  expect(note.body).toContain("Gadget Renderer Cleanup");
  expect(note.body).toContain("/tmp/caret-e2e");

  // Click the notification: the handler focuses the window, selects that
  // review (URL + rendered plan flip), and closes the notification.
  await page.evaluate(() => {
    const [n] = (window as unknown as StubWindow).__notes;
    n?.onclick?.();
  });
  await expect(page).toHaveURL(new RegExp(`review=${second}`));
  await expect(page.locator(".diff-plan").getByText("Gadget Renderer Cleanup")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as StubWindow).__notes[0]?.closed)).toBe(
    true,
  );

  // The already-seen ids never re-notify across later polls (the poll has
  // ticked several times by now): still exactly one construction.
  expect(await page.evaluate(() => (window as unknown as StubWindow).__notes.length)).toBe(1);
});

test("clicking the granted bell fires a test notification", async ({ daemon, page }) => {
  // The granted bell's click is the diagnosis affordance: it constructs a
  // notification through the same live path the poll uses, while the user
  // watches — construction with no visible toast means the OS is suppressing.
  await page.addInitScript(initStub, "granted");
  await daemon.seed();
  await page.goto("/");

  await page.getByRole("button", { name: "Notifications: granted" }).click();
  await page.waitForFunction(
    () => (window as unknown as StubWindow).__notes.some((n) => n.title === "🥕 Test notification"),
    undefined,
    { timeout: 5_000 },
  );
});

test("undecided permission shows the attention-tinted, requestable badge", async ({
  daemon,
  page,
}) => {
  await page.addInitScript(initStub, "default");
  // Suppress the first-run onboarding modal (EXC-781) so this asserts the bell in
  // isolation — otherwise the modal opens over an undecided permission and inerts
  // the topbar behind it. The onboarding flow has its own test below.
  await page.addInitScript(() => localStorage.setItem("caret.onboarded", "1"));
  await daemon.seed();
  await page.goto("/");

  const bell = page.getByRole("button", { name: "Notifications: default" });
  await expect(bell).toBeVisible();
  // EXC-760: the state hint moved off a native `title=` onto a shadcn Tooltip
  // (bits-ui links it to the trigger via aria-describedby, not a tooltip role),
  // revealed on hover (delayDuration=0 keeps it instant).
  const tip = page
    .locator("[data-slot='tooltip-content']")
    .filter({ hasText: "Enable desktop notifications for new plans" });
  await expect(tip).toBeHidden();
  await bell.hover();
  await expect(tip).toBeVisible();
});

test("first-run onboarding invites a new user to enable notifications", async ({
  daemon,
  page,
}) => {
  // A brand-new user: undecided permission and no onboarded flag → the modal opens.
  await page.addInitScript(initStub, "default");
  await daemon.seed();
  await page.goto("/");

  const enable = page.getByRole("button", { name: "Enable notifications" });
  await expect(enable).toBeVisible();
  // "Maybe later" records onboarding as seen and returns to the app; the bell
  // (now reachable) still reflects the undecided state.
  await page.getByRole("button", { name: "Maybe later" }).click();
  await expect(enable).toBeHidden();
  await expect(page.getByRole("button", { name: "Notifications: default" })).toBeVisible();
});
