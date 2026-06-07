import "../../test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type LogCapture, logCapture } from "../../test-helpers.ts";
import { flush } from "./log.ts";
import {
  bellPresentation,
  createPlanNotifier,
  fireTestNotification,
  type NotificationHandle,
  type PlanNotifierOptions,
} from "./notify.ts";

// A recording notify double: captures every construction and returns a handle
// whose onclick the module assigns, so tests can both count firings and drive
// the click path. Returning null simulates an absent Notification API.
type TestHandle = NotificationHandle & { closed: number };

function makeNotify(opts?: { unavailable?: boolean }) {
  const fired: { title: string; body: string; handle: TestHandle }[] = [];
  const notify = (title: string, body: string): NotificationHandle | null => {
    if (opts?.unavailable) return null;
    const handle: TestHandle = {
      onclick: null,
      onshow: null,
      onerror: null,
      closed: 0,
      close: () => handle.closed++,
    };
    fired.push({ title, body, handle });
    return handle;
  };
  return { fired, notify };
}

/** Temporarily install (or remove, with `undefined`) a global Notification. */
function withGlobalNotification(impl: unknown, fn: () => void) {
  const g = globalThis as Record<string, unknown>;
  const had = "Notification" in g;
  const saved = g.Notification;
  if (impl === undefined) delete g.Notification;
  else g.Notification = impl;
  try {
    fn();
  } finally {
    if (had) g.Notification = saved;
    else delete g.Notification;
  }
}

function review(id: string, title = `plan ${id}`, cwd = `/tmp/${id}`) {
  return { id, title, cwd };
}

// Mutable environment doubles, flipped per-observe by individual tests.
let away: boolean;
let permission: NotificationPermission;
let focused: number;
let selected: string[];

beforeEach(() => {
  away = true;
  permission = "granted";
  focused = 0;
  selected = [];
});

function makeNotifier(overrides?: Partial<PlanNotifierOptions>) {
  const { fired, notify } = makeNotify();
  const notifier = createPlanNotifier({
    onSelect: (id) => selected.push(id),
    notify,
    isAway: () => away,
    permission: () => permission,
    focus: () => focused++,
    ...overrides,
  });
  return { notifier, fired };
}

describe("createPlanNotifier", () => {
  test("first observe seeds the seen-set without firing", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([review("a"), review("b")]);
    expect(fired).toHaveLength(0);
  });

  test("a new id while away and granted fires one notification", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([review("a")]);
    notifier.observe([review("a"), review("b", "Add OAuth", "/repo/app")]);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.title).toBe("🥕 New Plan Ready");
    expect(fired[0]!.body).toContain("Add OAuth");
    expect(fired[0]!.body).toContain("/repo/app");
  });

  test("no notification while the user is at the tab (visible and focused)", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    away = false;
    notifier.observe([review("a")]);
    expect(fired).toHaveLength(0);
  });

  test("no notification when permission is default or denied", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    permission = "default";
    notifier.observe([review("a")]);
    permission = "denied";
    notifier.observe([review("a"), review("b")]);
    expect(fired).toHaveLength(0);
  });

  test("an already-seen id does not re-notify across polls", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    notifier.observe([review("a")]);
    notifier.observe([review("a")]);
    notifier.observe([review("a")]);
    expect(fired).toHaveLength(1);
  });

  test("an id continuously present never re-fires, even with changed fields", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([review("a", "plan v1")]);
    notifier.observe([review("a", "plan v2 (revised)")]);
    expect(fired).toHaveLength(0);
  });

  test("a revision that left and re-entered the pending list notifies", () => {
    // The real revision lifecycle: request-changes flips the review to
    // rejected (absent from the pending poll), then the revised plan re-pends
    // the same id. The user asked for the revision — tell them it's ready.
    const { notifier, fired } = makeNotifier();
    notifier.observe([review("a", "plan v1")]);
    notifier.observe([]); // rejected: awaiting the revision
    notifier.observe([review("a", "plan v2 (revised)")]);
    expect(fired).toHaveLength(1);
  });

  test("multiple new ids in one poll fire one notification each", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    notifier.observe([review("a"), review("b")]);
    expect(fired).toHaveLength(2);
  });

  test("clicking a notification focuses, selects that id, and closes it", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    notifier.observe([review("a")]);
    const { handle } = fired[0]!;
    expect(handle.onclick).not.toBeNull();
    handle.onclick?.();
    expect(focused).toBe(1);
    expect(selected).toEqual(["a"]);
    expect(handle.closed).toBe(1);
  });

  test("an absent Notification API (notify returns null) is a graceful no-op", () => {
    const { fired, notify } = makeNotify({ unavailable: true });
    const notifier = createPlanNotifier({
      onSelect: (id) => selected.push(id),
      notify,
      isAway: () => away,
      permission: () => permission,
      focus: () => focused++,
    });
    notifier.observe([]);
    expect(() => notifier.observe([review("a")])).not.toThrow();
    expect(fired).toHaveLength(0);
    // The id still counts as seen — no burst later.
    notifier.observe([review("a")]);
    expect(fired).toHaveLength(0);
  });

  test("the seen-set prunes to the incoming ids", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([review("a")]);
    notifier.observe([]); // a resolved away — pruned
    // Documented trade-off: a pruned id reappearing counts as new again
    // (acceptable; real review ids are fresh UUIDs).
    notifier.observe([review("a")]);
    expect(fired).toHaveLength(1);
  });
});

describe("bellPresentation", () => {
  test("granted maps to bell + ok tone, testable but not requestable", () => {
    const p = bellPresentation("granted");
    expect(p.icon).toBe("bell");
    expect(p.overlay).toBeUndefined();
    expect(p.tone).toBe("ok");
    expect(p.canRequest).toBe(false);
    // Granted's click affordance is the diagnosis path: fire a test
    // notification so "caret vs the OS" resolves in one click.
    expect(p.canTest).toBe(true);
    expect(p.title).toContain("test notification");
  });

  test("denied maps to bell-off + danger tone, inert", () => {
    const p = bellPresentation("denied");
    expect(p.icon).toBe("bell-off");
    expect(p.overlay).toBeUndefined();
    expect(p.tone).toBe("danger");
    expect(p.canRequest).toBe(false);
    expect(p.canTest).toBe(false);
  });

  test("default maps to the muted bell + question overlay, requestable", () => {
    const p = bellPresentation("default");
    expect(p.icon).toBe("bell");
    expect(p.overlay).toBe("circle-question-mark");
    expect(p.tone).toBe("muted");
    expect(p.canRequest).toBe(true);
    expect(p.canTest).toBe(false);
  });

  test("each state's tooltip is present and distinct", () => {
    const titles = (["granted", "denied", "default"] as const).map(
      (s) => bellPresentation(s).title,
    );
    for (const t of titles) expect(t.length).toBeGreaterThan(0);
    expect(new Set(titles).size).toBe(3);
  });
});

// uiLog instrumentation: notification records ride the same buffer the log
// bridge POSTs to /api/logs — observed by stubbing fetch and draining with
// flush() (cf. safeMode.test.ts). Scoped to its own describe so the fetch stub
// never leaks into the behavior tests above.
describe("createPlanNotifier instrumentation", () => {
  let cap: LogCapture;

  // Distinctive values so the negative test can assert they never hit the wire.
  const SECRET_TITLE = "ZxQvSecretPlanTitle";
  const SECRET_CWD = "/zxqv/secret/path";
  const REVIEW_ID = "0f8b6c1e-dead-beef-0000-000000000000";

  beforeEach(() => {
    cap = logCapture();
  });

  afterEach(() => {
    cap.restore();
  });

  test("firing emits one info record with the reviewId and no title", () => {
    const { notifier } = makeNotifier();
    notifier.observe([]);
    notifier.observe([review(REVIEW_ID, SECRET_TITLE, SECRET_CWD)]);
    flush();

    const events = cap.events();
    expect(events).toHaveLength(1);
    // Stable contract: an info-level "ui" record carrying the reviewId in its
    // structured field, classified "fired". The full id rides `extra.reviewId`;
    // the message prose (including the shortId interpolation) isn't pinned.
    expect(events[0]).toMatchObject({ level: "info", step: "ui", extra: { reviewId: REVIEW_ID } });
    expect(events[0]?.msg).toContain("fired");
  });

  test("clicking emits one debug record", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    notifier.observe([review(REVIEW_ID, SECRET_TITLE, SECRET_CWD)]);
    fired[0]!.handle.onclick?.();
    flush();

    // Stable contract: a debug-level "ui" record classified "clicked", carrying
    // the reviewId. Match the classifying keyword loosely, not the full prose.
    const clicks = cap.events().filter((e) => String(e.msg).includes("clicked"));
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({
      level: "debug",
      step: "ui",
      extra: { reviewId: REVIEW_ID },
    });
  });

  test("no record carries the review title or cwd", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    notifier.observe([review(REVIEW_ID, SECRET_TITLE, SECRET_CWD)]);
    fired[0]!.handle.onclick?.();
    flush();

    expect(cap.text()).not.toContain(SECRET_TITLE);
    expect(cap.text()).not.toContain(SECRET_CWD);
  });

  // A silently-dropped notification is indistinguishable from a bug without
  // these: every new id resolves to exactly one record — fired, skipped
  // (active / permission), or unavailable — and a fired one also reports
  // whether the browser displayed it (show/error events).

  test("a new id while the page is active logs a skip, not a fire", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    away = false;
    notifier.observe([review(REVIEW_ID)]);
    flush();

    expect(fired).toHaveLength(0);
    expect(cap.events()).toHaveLength(1);
    // Stable contract: a debug-level "ui" skip record classified "active",
    // carrying the reviewId. The "active" cause is the behavioral distinction
    // (vs a permission skip); match it loosely, not the full prose.
    const rec = cap.events()[0];
    expect(rec).toMatchObject({ level: "debug", step: "ui", extra: { reviewId: REVIEW_ID } });
    expect(rec?.msg).toContain("skipped");
    expect(rec?.msg).toContain("active");
  });

  test("a new id without permission logs a skip", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    permission = "denied";
    notifier.observe([review(REVIEW_ID)]);
    flush();

    expect(fired).toHaveLength(0);
    // Stable contract: a debug-level skip classified "permission" — the cause
    // (permission, not active) is the behavioral distinction; match it loosely.
    const rec = cap.events()[0];
    expect(rec).toMatchObject({ level: "debug", extra: { reviewId: REVIEW_ID } });
    expect(rec?.msg).toContain("skipped");
    expect(rec?.msg).toContain("permission");
  });

  test("an unavailable notify logs a warn for the lost plan", () => {
    const { fired, notify } = makeNotify({ unavailable: true });
    const notifier = createPlanNotifier({
      onSelect: () => {},
      notify,
      isAway: () => true,
      permission: () => "granted",
      focus: () => {},
    });
    notifier.observe([]);
    notifier.observe([review(REVIEW_ID)]);
    flush();

    expect(fired).toHaveLength(0);
    // Stable contract: exactly one warn-level record classified "unavailable"
    // (warn, not debug — the plan was lost), carrying the reviewId.
    const warns = cap.events().filter((e) => e.level === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ extra: { reviewId: REVIEW_ID } });
    expect(warns[0]?.msg).toContain("unavailable");
  });

  test("the browser displaying the notification logs a debug via onshow", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    notifier.observe([review(REVIEW_ID)]);
    fired[0]!.handle.onshow?.();
    flush();

    // Stable contract: the browser's display callback emits one debug "shown"
    // record carrying the reviewId; match the classifying keyword loosely.
    const shown = cap.events().filter((e) => String(e.msg).includes("shown"));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ level: "debug", extra: { reviewId: REVIEW_ID } });
  });

  test("a display failure logs a warn via onerror", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    notifier.observe([review(REVIEW_ID)]);
    fired[0]!.handle.onerror?.();
    flush();

    // Stable contract: the browser's error callback emits one warn "failed"
    // record (warn, not debug) carrying the reviewId; classify loosely.
    const failed = cap.events().filter((e) => String(e.msg).includes("failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: "warn", extra: { reviewId: REVIEW_ID } });
  });
});

// fireTestNotification goes through the LIVE Notification global (the same
// default path the notifier uses), so these stub globalThis.Notification —
// the one place the real constructor seam is exercised under test.
describe("fireTestNotification", () => {
  let cap: LogCapture;

  beforeEach(() => {
    cap = logCapture();
  });

  afterEach(() => {
    cap.restore();
  });

  test("constructs through the live API and reports success", () => {
    const constructed: { title: string; body?: string }[] = [];
    class FakeNotification {
      onclick = null;
      onshow = null;
      onerror = null;
      constructor(title: string, options?: { body?: string }) {
        constructed.push({ title, body: options?.body });
      }
      close() {}
      static permission: NotificationPermission = "granted";
    }
    withGlobalNotification(FakeNotification, () => {
      expect(fireTestNotification()).toBe(true);
    });
    flush();

    expect(constructed).toHaveLength(1);
    expect(constructed[0]!.title).toBe("🥕 Test notification");
    expect(cap.events()).toContainEqual(
      expect.objectContaining({ level: "info", msg: "test notification fired" }),
    );
  });

  test("a throwing constructor degrades to false with a warn", () => {
    class ThrowingNotification {
      constructor() {
        throw new TypeError("nope");
      }
      static permission: NotificationPermission = "granted";
    }
    withGlobalNotification(ThrowingNotification, () => {
      expect(fireTestNotification()).toBe(false);
    });
    flush();

    expect(cap.events().some((e) => e.level === "warn")).toBe(true);
  });

  test("an absent Notification API degrades to false with a warn", () => {
    withGlobalNotification(undefined, () => {
      expect(fireTestNotification()).toBe(false);
    });
    flush();

    expect(cap.events().some((e) => e.level === "warn")).toBe(true);
  });
});
