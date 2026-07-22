import "../../test-mount.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import NotificationsPane from "@/components/NotificationsPane.svelte";

import { render } from "../../test-mount.ts";

// The settings Notifications pane (EXC-847) reflects the browser's live
// Notification.permission and offers the enable / test affordance. Its state
// semantics (which affordance each permission gets) come from bellPresentation,
// covered in notify.test.ts; this suite covers the pane's DOM wiring of that
// mapping and its click behavior. Like NotifyBell.test.ts, each test installs a
// Notification stub with a chosen permission and a requestPermission spy. The
// pane is a plain component (no bits-ui portal), so it mounts synchronously.

type Perm = NotificationPermission;

interface NotificationStub {
  permission: Perm;
  requestPermission: () => Promise<Perm>;
  // Constructor calls (fireTestNotification) are swallowed; we only need the count.
  fired: number;
}

let stub: NotificationStub;
const realNotification = (globalThis as { Notification?: unknown }).Notification;

function installNotification(permission: Perm): void {
  stub = {
    permission,
    requestPermission: () => Promise.resolve(permission),
    fired: 0,
  };
  function Ctor(this: unknown) {
    stub.fired++;
  }
  Object.assign(Ctor, {
    get permission() {
      return stub.permission;
    },
    requestPermission: () => stub.requestPermission(),
  });
  (globalThis as { Notification?: unknown }).Notification = Ctor;
}

const pane = (target: HTMLElement) => target.querySelector("[data-notifications-pane]")!;
const enableBtn = (target: HTMLElement) => target.querySelector("[data-action='enable']");
const testBtn = (target: HTMLElement) => target.querySelector("[data-action='test']");

beforeEach(() => {
  installNotification("default");
});

afterEach(() => {
  (globalThis as { Notification?: unknown }).Notification = realNotification;
});

describe("NotificationsPane state rendering", () => {
  test("default: shows the enable affordance, no test button", () => {
    installNotification("default");
    const { target } = render(NotificationsPane, {});
    expect(pane(target).getAttribute("data-permission")).toBe("default");
    expect(enableBtn(target)).not.toBeNull();
    expect(testBtn(target)).toBeNull();
    expect(enableBtn(target)?.textContent).toContain("Enable notifications");
  });

  test("granted: shows the test affordance, no enable button", () => {
    installNotification("granted");
    const { target } = render(NotificationsPane, {});
    expect(pane(target).getAttribute("data-permission")).toBe("granted");
    expect(testBtn(target)).not.toBeNull();
    expect(enableBtn(target)).toBeNull();
    expect(testBtn(target)?.textContent).toContain("Send a test notification");
  });

  test("denied: guidance to re-enable in the browser, no action button", () => {
    installNotification("denied");
    const { target } = render(NotificationsPane, {});
    expect(pane(target).getAttribute("data-permission")).toBe("denied");
    expect(enableBtn(target)).toBeNull();
    expect(testBtn(target)).toBeNull();
    // The guidance names where the block is undone (browser site settings).
    expect(pane(target).textContent).toContain("site settings");
  });

  test("unsupported: an explanatory note, no status or actions", () => {
    (globalThis as { Notification?: unknown }).Notification = undefined;
    const { target } = render(NotificationsPane, {});
    expect(pane(target).getAttribute("data-permission")).toBe("unsupported");
    expect(enableBtn(target)).toBeNull();
    expect(testBtn(target)).toBeNull();
    expect(pane(target).textContent?.toLowerCase()).toContain("doesn't support");
  });
});

describe("NotificationsPane click behavior", () => {
  test("default: clicking Enable requests permission and fires no test notification", () => {
    installNotification("default");
    let requested = false;
    stub.requestPermission = () => {
      requested = true;
      return Promise.resolve("granted");
    };
    const { target } = render(NotificationsPane, {});
    (enableBtn(target) as HTMLElement).click();
    // The badge re-read after the awaited grant is timing/live-static dependent
    // (covered by the settings e2e). Here we assert the deterministic wiring:
    // Enable routes to a permission request, never to a test notification.
    expect(requested).toBe(true);
    expect(stub.fired).toBe(0);
  });

  test("granted: clicking Send a test notification fires one, no permission request", () => {
    installNotification("granted");
    let requested = false;
    stub.requestPermission = () => {
      requested = true;
      return Promise.resolve("granted");
    };
    const { target } = render(NotificationsPane, {});
    (testBtn(target) as HTMLElement).click();
    expect(stub.fired).toBe(1);
    expect(requested).toBe(false);
  });
});
