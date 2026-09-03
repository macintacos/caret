import "@ui/test-mount.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { render } from "@ui/test-mount.ts";
import {
  installNotificationStub,
  type NotificationStub,
  restoreNotification,
  trackRequestPermission,
} from "@ui/test-notification-stub.ts";
import NotificationsPane from "@/components/NotificationsPane.svelte";

// The settings Notifications pane (EXC-847) reflects the browser's live
// Notification.permission and offers the enable / test affordance. Its state
// semantics (which affordance each permission gets) come from bellPresentation,
// covered in notify.test.ts; this suite covers the pane's DOM wiring of that
// mapping and its click behavior. Like NotifyBell.test.ts, each test installs a
// Notification stub with a chosen permission and a requestPermission spy. The
// pane is a plain component (no bits-ui portal), so it mounts synchronously.

let stub: NotificationStub;
const realNotification = (globalThis as { Notification?: unknown }).Notification;

const pane = (target: HTMLElement) => target.querySelector("[data-notifications-pane]")!;
const enableBtn = (target: HTMLElement) => target.querySelector("[data-action='enable']");
const testBtn = (target: HTMLElement) => target.querySelector("[data-action='test']");

beforeEach(() => {
  stub = installNotificationStub("default");
});

afterEach(() => {
  restoreNotification(realNotification);
});

describe("NotificationsPane state rendering", () => {
  test("default: shows the enable affordance, no test button", () => {
    stub = installNotificationStub("default");
    const { target } = render(NotificationsPane, {});
    expect(pane(target).getAttribute("data-permission")).toBe("default");
    expect(enableBtn(target)).not.toBeNull();
    expect(testBtn(target)).toBeNull();
    expect(enableBtn(target)?.textContent).toContain("Enable notifications");
  });

  test("granted: shows the test affordance, no enable button", () => {
    stub = installNotificationStub("granted");
    const { target } = render(NotificationsPane, {});
    expect(pane(target).getAttribute("data-permission")).toBe("granted");
    expect(testBtn(target)).not.toBeNull();
    expect(enableBtn(target)).toBeNull();
    expect(testBtn(target)?.textContent).toContain("Send a test notification");
  });

  test("denied: guidance to re-enable in the browser, no action button", () => {
    stub = installNotificationStub("denied");
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
    stub = installNotificationStub("default");
    const permission = trackRequestPermission(stub, "granted");
    const { target } = render(NotificationsPane, {});
    (enableBtn(target) as HTMLElement).click();
    // The badge re-read after the awaited grant is timing/live-static dependent
    // (covered by the settings e2e). Here we assert the deterministic wiring:
    // Enable routes to a permission request, never to a test notification.
    expect(permission.requested()).toBe(true);
    expect(stub.fired).toBe(0);
  });

  test("granted: clicking Send a test notification fires one, no permission request", () => {
    stub = installNotificationStub("granted");
    const permission = trackRequestPermission(stub, "granted");
    const { target } = render(NotificationsPane, {});
    (testBtn(target) as HTMLElement).click();
    expect(stub.fired).toBe(1);
    expect(permission.requested()).toBe(false);
  });
});
