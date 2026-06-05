import "../../test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type LogCapture, logCapture } from "../../test-helpers.ts";
import { flush, shortId } from "./log.ts";
import {
  bellPresentation,
  createPlanNotifier,
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
    const handle: TestHandle = { onclick: null, closed: 0, close: () => handle.closed++ };
    fired.push({ title, body, handle });
    return handle;
  };
  return { fired, notify };
}

function review(id: string, title = `plan ${id}`, cwd = `/tmp/${id}`) {
  return { id, title, cwd };
}

// Mutable environment doubles, flipped per-observe by individual tests.
let hidden: boolean;
let permission: NotificationPermission;
let focused: number;
let selected: string[];

beforeEach(() => {
  hidden = true;
  permission = "granted";
  focused = 0;
  selected = [];
});

function makeNotifier(overrides?: Partial<PlanNotifierOptions>) {
  const { fired, notify } = makeNotify();
  const notifier = createPlanNotifier({
    onSelect: (id) => selected.push(id),
    notify,
    isHidden: () => hidden,
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

  test("a new id while hidden and granted fires one notification", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([review("a")]);
    notifier.observe([review("a"), review("b", "Add OAuth", "/repo/app")]);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.title).toBe("caret: new plan ready");
    expect(fired[0]!.body).toContain("Add OAuth");
    expect(fired[0]!.body).toContain("/repo/app");
  });

  test("no notification while the tab is visible", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    hidden = false;
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

  test("a revision (same id, changed fields) does not fire", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([review("a", "plan v1")]);
    notifier.observe([review("a", "plan v2 (revised)")]);
    expect(fired).toHaveLength(0);
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
      isHidden: () => hidden,
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
  test("granted maps to bell + ok tone, not requestable", () => {
    const p = bellPresentation("granted");
    expect(p.icon).toBe("bell");
    expect(p.overlay).toBeUndefined();
    expect(p.tone).toBe("ok");
    expect(p.canRequest).toBe(false);
  });

  test("denied maps to bell-off + danger tone, not requestable", () => {
    const p = bellPresentation("denied");
    expect(p.icon).toBe("bell-off");
    expect(p.overlay).toBeUndefined();
    expect(p.tone).toBe("danger");
    expect(p.canRequest).toBe(false);
  });

  test("default maps to the muted bell + question overlay, requestable", () => {
    const p = bellPresentation("default");
    expect(p.icon).toBe("bell");
    expect(p.overlay).toBe("circle-question-mark");
    expect(p.tone).toBe("muted");
    expect(p.canRequest).toBe(true);
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
    expect(events[0]).toMatchObject({
      level: "info",
      step: "ui",
      msg: `plan notification fired: ${shortId(REVIEW_ID)}`,
      extra: { reviewId: REVIEW_ID },
    });
  });

  test("clicking emits one debug record", () => {
    const { notifier, fired } = makeNotifier();
    notifier.observe([]);
    notifier.observe([review(REVIEW_ID, SECRET_TITLE, SECRET_CWD)]);
    fired[0]!.handle.onclick?.();
    flush();

    const clicks = cap
      .events()
      .filter((e) => e.msg === `plan notification clicked: ${shortId(REVIEW_ID)}`);
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
});
