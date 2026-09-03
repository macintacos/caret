// Shared Notification-API double for NotificationsPane.test.ts and
// NotifyBell.test.ts: both suites drive the same live `Notification` static, so
// installing and restoring it is one piece of scaffolding, not two.

export interface NotificationStub {
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  // Constructor calls (fireTestNotification) are swallowed; callers only need the count.
  fired: number;
}

/** Install a fake `Notification` constructor reporting `permission`. Returns the
 * stub so a test can reassign `requestPermission` or read `fired`. */
export function installNotificationStub(permission: NotificationPermission): NotificationStub {
  const stub: NotificationStub = {
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
  return stub;
}

/** Restore whatever `Notification` value (real or `undefined`) predated the stub. */
export function restoreNotification(original: unknown): void {
  (globalThis as { Notification?: unknown }).Notification = original;
}

/** Wrap `stub.requestPermission` so a test can assert whether it was called,
 * without hand-rolling the same `requested` flag at every call site. */
export function trackRequestPermission(
  stub: NotificationStub,
  resolveTo: NotificationPermission,
): { requested: () => boolean } {
  let requested = false;
  stub.requestPermission = () => {
    requested = true;
    return Promise.resolve(resolveTo);
  };
  return { requested: () => requested };
}
