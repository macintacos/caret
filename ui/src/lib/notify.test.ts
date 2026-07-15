import "../../test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { flush } from "$lib/log.ts";
import {
  bellPresentation,
  createPlanNotifier,
  defaultClaim,
  fireTestNotification,
  type NotificationHandle,
  type PlanNotifierOptions,
} from "$lib/notify.ts";

import { type LogCapture, logCapture } from "../../test-helpers.ts";

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

// EXC-733: two open caret tabs each run their own notifier with a private
// seen-set. Nothing coordinated them, so a single new review fired one toast
// per tab. The fix adds a cross-tab `claim` seam; these drive two instances
// through a shared claim primitive (the Web Locks stand-in) and pin that
// exactly one wins. Every test above uses a single instance — which is why
// this class of bug slipped through.
describe("createPlanNotifier cross-tab dedup (EXC-733)", () => {
  // A shared, atomic claim across instances: the first caller to see an id wins
  // (adds it, resolves true); later callers lose (resolve false). Async, like
  // the Web Locks default it stands in for.
  function sharedClaim() {
    const taken = new Set<string>();
    return (id: string): Promise<boolean> => {
      if (taken.has(id)) return Promise.resolve(false);
      taken.add(id);
      return Promise.resolve(true);
    };
  }

  // Let the async claim's resolution (and the fire it gates) run before asserting.
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("two concurrent notifiers fire exactly one notification for one review", async () => {
    const claim = sharedClaim();
    const a = makeNotifier({ claim });
    const b = makeNotifier({ claim });

    // Both tabs seed silently, then both observe the same genuinely-new id.
    a.notifier.observe([]);
    b.notifier.observe([]);
    a.notifier.observe([review("x")]);
    b.notifier.observe([review("x")]);
    await settle();

    expect(a.fired.length + b.fired.length).toBe(1);
  });

  test("two notifiers over one shared Web Locks manager (real defaultClaim) dedupe", async () => {
    // The composition the injected-claim test above can't reach: both notifiers
    // run the real defaultClaim against ONE stateful LockManager. ifAvailable
    // grants the lock when free, hands null when a peer holds it. The winner
    // holds until its callback's promise settles — which (setTimeout stubbed to
    // a no-op) it never does here, so the lock stays held and the second
    // notifier is forced to lose. This is what the 5s hold buys in production.
    function makeLockManager() {
      const held = new Set<string>();
      return {
        request(name: string, _opts: unknown, cb: (lock: object | null) => unknown) {
          if (held.has(name)) return Promise.resolve(cb(null));
          held.add(name);
          return Promise.resolve(cb({})).finally(() => held.delete(name));
        },
      };
    }
    const flushMicrotasks = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };

    const realSetTimeout = globalThis.setTimeout;
    // No-op the hold timer so the lock never auto-releases (and no 5s timer
    // lingers past the test); the fake keeps it held for the loser to hit.
    globalThis.setTimeout = ((_cb: () => void) =>
      0 as unknown as ReturnType<typeof setTimeout>) as typeof globalThis.setTimeout;
    const nav = globalThis.navigator as unknown as Record<string, unknown>;
    const savedLocks = Object.getOwnPropertyDescriptor(nav, "locks");
    Object.defineProperty(nav, "locks", { configurable: true, value: makeLockManager() });
    try {
      // No injected claim → both notifiers use the real defaultClaim (Web Locks).
      const a = makeNotifier();
      const b = makeNotifier();
      a.notifier.observe([]);
      b.notifier.observe([]);
      a.notifier.observe([review("y")]);
      b.notifier.observe([review("y")]);
      await flushMicrotasks();

      // a claimed first and fired; b found the lock held and stayed silent.
      expect(a.fired).toHaveLength(1);
      expect(b.fired).toHaveLength(0);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      if (savedLocks) Object.defineProperty(nav, "locks", savedLocks);
      else delete nav.locks;
    }
  });
});

// defaultClaim is the production cross-tab seam (Web Locks). happy-dom reports
// navigator.locks === null, so the module falls back to always-claim; these
// fake a LockManager to pin the mapping the real primitive provides.
describe("defaultClaim (Web Locks seam)", () => {
  function withFakeLocks(
    outcome: "granted" | "held",
    fn: () => void | Promise<void>,
  ): Promise<void> {
    const nav = globalThis.navigator as unknown as Record<string, unknown>;
    const saved = Object.getOwnPropertyDescriptor(nav, "locks");
    Object.defineProperty(nav, "locks", {
      configurable: true,
      value: {
        // ifAvailable: the callback gets the lock when free, null when a peer
        // holds it. We resolve cb's result so defaultClaim's promise settles.
        request(_name: string, _opts: unknown, cb: (lock: object | null) => unknown) {
          return Promise.resolve(cb(outcome === "granted" ? {} : null));
        },
      },
    });
    return Promise.resolve(fn()).finally(() => {
      if (saved) Object.defineProperty(nav, "locks", saved);
      else delete nav.locks;
    });
  }

  test("no Web Locks (navigator.locks null): claims synchronously", () => {
    expect(defaultClaim("x")).toBe(true);
  });

  test("winning the per-id lock resolves true", async () => {
    // Collapse the background hold so no real 5s timer lingers past the test.
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((cb: () => void) => {
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof globalThis.setTimeout;
    try {
      await withFakeLocks("granted", async () => {
        expect(await defaultClaim("abc")).toBe(true);
      });
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test("a peer already holding the lock (null) resolves false", async () => {
    await withFakeLocks("held", async () => {
      expect(await defaultClaim("abc")).toBe(false);
    });
  });
});

describe("bellPresentation", () => {
  test("granted maps to a neutral bell + green status dot, testable but not requestable", () => {
    const p = bellPresentation("granted");
    expect(p.icon).toBe("bell");
    expect(p.overlay).toBeUndefined();
    // The bell stays neutral chrome; the green corner dot is the on-state signal.
    expect(p.tone).toBe("muted");
    expect(p.dot).toBe("ok");
    expect(p.canRequest).toBe(false);
    // Granted's click affordance is the diagnosis path: fire a test
    // notification so "caret vs the OS" resolves in one click.
    expect(p.canTest).toBe(true);
    expect(p.title).toContain("test notification");
  });

  test("denied maps to a neutral bell-off + red status dot, inert", () => {
    const p = bellPresentation("denied");
    expect(p.icon).toBe("bell-off");
    expect(p.overlay).toBeUndefined();
    expect(p.tone).toBe("muted");
    expect(p.dot).toBe("danger");
    expect(p.canRequest).toBe(false);
    expect(p.canTest).toBe(false);
  });

  test("default maps to the attention bell + question overlay, requestable, no dot", () => {
    const p = bellPresentation("default");
    expect(p.icon).toBe("bell");
    expect(p.overlay).toBe("circle-question-mark");
    // The undecided state is the one invitation to act — it tints purple to
    // draw the eye, and carries the `?` glyph rather than a plain status dot.
    expect(p.tone).toBe("attention");
    expect(p.dot).toBeUndefined();
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

  test("a new id while permission is denied logs a debug skip", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    permission = "denied";
    notifier.observe([review(REVIEW_ID)]);
    flush();

    expect(fired).toHaveLength(0);
    // Stable contract: a debug-level skip classified "permission". Denied stays
    // at debug — the bell already shows a prominent danger state, so the skip
    // doesn't masquerade as broken (unlike the undecided case below, EXC-559).
    const rec = cap.events()[0];
    expect(rec).toMatchObject({ level: "debug", extra: { reviewId: REVIEW_ID } });
    expect(rec?.msg).toContain("skipped");
    expect(rec?.msg).toContain("permission");
  });

  test("a new id while permission is undecided logs an info skip (EXC-559)", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    permission = "default";
    notifier.observe([review(REVIEW_ID)]);
    flush();

    expect(fired).toHaveLength(0);
    // Stable contract: the undecided (default) permission skip logs at INFO, so a
    // fresh per-origin install's silent skip is discoverable without debug
    // logging (EXC-559). Match the cause loosely, pin the level.
    const rec = cap.events()[0];
    expect(rec).toMatchObject({ level: "info", step: "ui", extra: { reviewId: REVIEW_ID } });
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
