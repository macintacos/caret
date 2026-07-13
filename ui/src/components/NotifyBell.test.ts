import "../../test-mount.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import NotifyBell from "./NotifyBell.svelte";

// bellPresentation() (the permission→icon/tone/title mapping) is covered in
// notify.test.ts; this suite covers NotifyBell's DOM wiring of that mapping and
// its click behavior. The component reads the live Notification static, so each
// test installs a stub with a chosen permission and a requestPermission spy.
//
// EXC-760: the state hint moved off a native `title=` onto a shadcn Tooltip
// (portalled, hover-driven), so the tooltip text is asserted in
// notifications.e2e.ts (real hover) rather than here. The tone now lives on the
// inner icon `.stack` (the Button is neutral ghost chrome).

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

beforeEach(() => {
  installNotification("default");
});

afterEach(() => {
  (globalThis as { Notification?: unknown }).Notification = realNotification;
});

describe("NotifyBell presentation wiring", () => {
  test("undecided: muted tone, request title, question-mark overlay", () => {
    const { target } = render(NotifyBell, {});
    const bell = target.querySelector(".bell")!;
    expect(target.querySelector(".stack")!.classList.contains("tone-muted")).toBe(true);
    expect(bell.getAttribute("aria-label")).toBe("Notifications: default");
    // overlay present (two stacked icons), bell base + question-mark.
    expect(target.querySelector(".overlay")).not.toBeNull();
  });

  test("granted: ok tone, no overlay, not aria-disabled (test is a real click)", () => {
    installNotification("granted");
    const { target } = render(NotifyBell, {});
    const bell = target.querySelector(".bell")!;
    expect(target.querySelector(".stack")!.classList.contains("tone-ok")).toBe(true);
    expect(target.querySelector(".overlay")).toBeNull();
    expect(bell.getAttribute("aria-disabled")).toBeNull();
  });

  test("denied: danger tone, aria-disabled (read-only state)", () => {
    installNotification("denied");
    const { target } = render(NotifyBell, {});
    const bell = target.querySelector(".bell")!;
    expect(target.querySelector(".stack")!.classList.contains("tone-danger")).toBe(true);
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
    installNotification("default");
    let requested = false;
    stub.requestPermission = () => {
      requested = true;
      return Promise.resolve("granted");
    };
    const { target } = render(NotifyBell, {});
    (target.querySelector(".bell") as HTMLElement).click();
    // The badge re-read after the awaited grant resolves is timing/live-static
    // dependent — that round trip is covered by the notifications e2e. Here we
    // assert the deterministic wiring: undecided routes to a permission request,
    // never to a test notification.
    expect(requested).toBe(true);
    expect(stub.fired).toBe(0);
  });

  test("granted: clicking fires a test notification, no permission request", () => {
    installNotification("granted");
    let requested = false;
    stub.requestPermission = () => {
      requested = true;
      return Promise.resolve("granted");
    };
    const { target } = render(NotifyBell, {});
    (target.querySelector(".bell") as HTMLElement).click();
    expect(stub.fired).toBe(1);
    expect(requested).toBe(false);
  });

  test("denied: clicking is inert (no request, no test)", () => {
    installNotification("denied");
    let requested = false;
    stub.requestPermission = () => {
      requested = true;
      return Promise.resolve("denied");
    };
    const { target } = render(NotifyBell, {});
    (target.querySelector(".bell") as HTMLElement).click();
    expect(requested).toBe(false);
    expect(stub.fired).toBe(0);
  });
});
