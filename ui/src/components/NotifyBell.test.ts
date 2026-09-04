import "@ui/support/mount.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { render } from "@ui/support/mount.ts";
import {
  installNotificationStub,
  type NotificationStub,
  restoreNotification,
  trackRequestPermission,
} from "@ui/support/notification-stub.ts";
import NotifyBell from "@/components/NotifyBell.svelte";

// bellPresentation() (the permission→icon/tone/title mapping) is covered in
// notify.test.ts; this suite covers NotifyBell's DOM wiring of that mapping and
// its click behavior. The component reads the live Notification static, so each
// test installs a stub with a chosen permission and a requestPermission spy.
//
// EXC-760: the state hint rides a shadcn Tooltip (portalled, hover-driven), so its text
// is asserted in notifications.e2e.ts under a real hover rather than here. The tone lives
// on the inner icon `.stack` — the Button itself is neutral ghost chrome.

let stub: NotificationStub;
const realNotification = (globalThis as { Notification?: unknown }).Notification;

beforeEach(() => {
  stub = installNotificationStub("default");
});

afterEach(() => {
  restoreNotification(realNotification);
});

function renderBell(): { target: HTMLElement; bell: Element } {
  const { target } = render(NotifyBell, {});
  return { target, bell: target.querySelector(".bell")! };
}

describe("NotifyBell presentation wiring", () => {
  test("undecided: attention tone, request title, question-mark overlay, no dot", () => {
    const { target, bell } = renderBell();
    expect(target.querySelector(".stack")!.classList.contains("tone-attention")).toBe(true);
    expect(bell.getAttribute("aria-label")).toBe("Notifications: default");
    // overlay present (two stacked icons), bell base + question-mark; no status dot.
    expect(target.querySelector(".overlay")).not.toBeNull();
    expect(target.querySelector(".dot")).toBeNull();
  });

  test("granted: neutral bell + green dot, no overlay, not aria-disabled (test is a real click)", () => {
    stub = installNotificationStub("granted");
    const { target, bell } = renderBell();
    // Neutral bell chrome; the green status dot is the on-state signal.
    expect(target.querySelector(".stack")!.classList.contains("tone-muted")).toBe(true);
    expect(target.querySelector(".dot")!.classList.contains("tone-ok")).toBe(true);
    expect(target.querySelector(".overlay")).toBeNull();
    expect(bell.getAttribute("aria-disabled")).toBeNull();
  });

  test("denied: neutral bell + red dot, aria-disabled (read-only state)", () => {
    stub = installNotificationStub("denied");
    const { target, bell } = renderBell();
    expect(target.querySelector(".stack")!.classList.contains("tone-muted")).toBe(true);
    expect(target.querySelector(".dot")!.classList.contains("tone-danger")).toBe(true);
    expect(bell.getAttribute("aria-disabled")).toBe("true");
  });

  test("renders nothing when the Notification API is unavailable", () => {
    (globalThis as { Notification?: unknown }).Notification = undefined;
    const { target } = render(NotifyBell, {});
    expect(target.querySelector(".bell")).toBeNull();
  });
});

describe("NotifyBell click behavior", () => {
  test("undecided: clicking requests permission and fires no test notification", () => {
    stub = installNotificationStub("default");
    const permission = trackRequestPermission(stub, "granted");
    const { bell } = renderBell();
    (bell as HTMLElement).click();
    // The badge re-read after the awaited grant resolves is timing/live-static
    // dependent — that round trip is covered by the notifications e2e. Here we
    // assert the deterministic wiring: undecided routes to a permission request,
    // never to a test notification.
    expect(permission.requested()).toBe(true);
    expect(stub.fired).toBe(0);
  });

  test("granted: clicking fires a test notification, no permission request", () => {
    stub = installNotificationStub("granted");
    const permission = trackRequestPermission(stub, "granted");
    const { bell } = renderBell();
    (bell as HTMLElement).click();
    expect(stub.fired).toBe(1);
    expect(permission.requested()).toBe(false);
  });

  test("denied: clicking is inert (no request, no test)", () => {
    stub = installNotificationStub("denied");
    const permission = trackRequestPermission(stub, "denied");
    const { bell } = renderBell();
    (bell as HTMLElement).click();
    expect(permission.requested()).toBe(false);
    expect(stub.fired).toBe(0);
  });
});
