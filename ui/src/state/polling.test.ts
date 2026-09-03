import "@ui/test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ClientReview } from "@core/lib/types";
import type { LogCapture } from "@ui/test-helpers.ts";
import {
  emptyResponse,
  installRoutedFetch,
  jsonResponse,
  type Respond,
} from "@ui/test-routed-fetch.ts";
import {
  createReviewSelection,
  type SelectionStore,
  startPolling,
} from "@/state/polling.svelte.ts";
import { flush } from "$lib/log.ts";
import type { SoundEvent } from "$lib/sound.ts";

// Shared URL-routing fetch double (test-routed-fetch.ts): /api/logs POSTs are
// captured; the review/health endpoints answer from the per-test `respond`.
let respond: Respond;
let cap: LogCapture;

beforeEach(() => {
  respond = emptyResponse;
  cap = installRoutedFetch(() => respond);
});

afterEach(() => {
  cap.restore();
});

// Build a ClientReview list of `n` placeholder reviews to drive count changes.
function reviewsOfLength(n: number): ClientReview[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}` }) as unknown as ClientReview);
}

// A minimal review with just the fields the selection reads.
function review(id: string, version = 1): ClientReview {
  return { id, version } as unknown as ClientReview;
}

function makeStore(over: Partial<SelectionStore> = {}): SelectionStore {
  return {
    reviews: [],
    activeId: null,
    connected: true,
    daemonChanged: false,
    unread: [],
    arrivals: 0,
    ...over,
  };
}

/** A fresh selection over a fresh store, for cases with no onSound wiring. */
function selectionOf(over: Partial<SelectionStore> = {}) {
  const store = makeStore(over);
  const sel = createReviewSelection(store);
  return { store, sel };
}

/** A fresh selection with "b" freshly arrived and marked unread. */
function withUnreadB(over: Partial<SelectionStore> = {}) {
  const result = selectionOf(over);
  result.sel.mergeReviews([review("a")]);
  result.sel.mergeReviews([review("a"), review("b")]);
  return result;
}

// Set the `?review=` deep-link param. happy-dom's base is about:blank and
// rejects a bare relative path, so build the href off the current location
// (the same shape setUrl writes).
function setDeepLink(id: string | null) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("review", id);
  else url.searchParams.delete("review");
  history.replaceState(null, "", url.href);
}

// Await until `predicate` holds or a deadline passes, polling real timers. The
// deadline only bounds the failure case — generous so a loaded CI machine
// (parallel suites, saturated event loop) can't outrun it and flake.
async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("until: timed out");
    await new Promise((r) => setTimeout(r, 1));
  }
}

describe("startPolling instrumentation", () => {
  test("two consecutive failures emit exactly one warn; recovery emits info failures:2", async () => {
    const sequence: Array<() => Promise<Response>> = [
      () => Promise.reject(new Error("down")),
      () => Promise.reject(new Error("down")),
      () => Promise.resolve(jsonResponse(reviewsOfLength(1))),
    ];
    let i = 0;
    // /api/health answers benignly (no instanceId) so it never consumes a
    // reviews-sequence slot — the sequence drives /api/reviews alone.
    respond = (url) =>
      url === "/api/health"
        ? Promise.resolve(jsonResponse({ service: "caret", version: "1" }))
        : sequence[Math.min(i++, sequence.length - 1)]!();

    let updates = 0;
    const stop = startPolling(() => updates++, 1);
    await until(() => updates >= 1);
    stop();
    flush();

    const records = cap.events();
    const warns = records.filter((r) => r.level === "warn" && r.step === "poll");
    expect(warns).toHaveLength(1);
    expect(warns[0]!.msg as string).toContain("poll failed");

    const recovered = records.find(
      (r) => r.level === "info" && r.step === "poll" && (r.msg as string).includes("recovered"),
    );
    expect(recovered).toBeDefined();
    expect(recovered!.extra).toMatchObject({ failures: 2 });
  });

  test("a review-count change emits a debug record with the new count", async () => {
    respond = () => Promise.resolve(jsonResponse(reviewsOfLength(3)));

    let updates = 0;
    const stop = startPolling(() => updates++, 1);
    await until(() => updates >= 1);
    stop();
    flush();

    const debug = cap.events().find((r) => r.level === "debug" && r.step === "poll");
    expect(debug).toBeDefined();
    expect(debug!.msg as string).toContain("reviews pending: 3");
    expect(debug!.extra).toMatchObject({ count: 3 });
  });
});

describe("startPolling daemon identity (onSwap)", () => {
  // Route a startPolling test's two endpoints: /api/reviews answers from
  // `reviews` (a thunk so it can change across polls), /api/health from `health`
  // (likewise). Everything else (i.e. /api/logs) is left to the shared capture.
  function route(reviews: () => Response, health: () => Response) {
    respond = (url) => {
      if (url === "/api/health") return Promise.resolve(health());
      if (url === "/api/reviews") return Promise.resolve(reviews());
      return Promise.resolve(new Response(null, { status: 204 }));
    };
  }

  /** Start polling with an onSwap recorder wired in, alongside the plain update
   * counter every onSwap case also reads. Callers own the returned `stop`. */
  function startPollingWithSwaps() {
    const swaps: string[] = [];
    let updates = 0;
    const stop = startPolling(
      () => updates++,
      1,
      undefined,
      (id) => swaps.push(id),
    );
    return { swaps, getUpdates: () => updates, stop };
  }

  /** Run polling to completion and assert onSwap never fired. */
  async function expectNoSwap(): Promise<void> {
    const { swaps, getUpdates, stop } = startPollingWithSwaps();
    await until(() => getUpdates() >= 8);
    stop();
    flush();
    expect(swaps).toEqual([]);
  }

  test("onSwap fires once when instanceId changes across a failure→recovery edge", async () => {
    // Health flips identity while the reviews poll is mid-outage; the recovery
    // edge re-checks identity and notices the swap.
    let instanceId = "aaaa1111";
    let reviewsFails = false;
    route(
      () => (reviewsFails ? new Response(null, { status: 503 }) : jsonResponse(reviewsOfLength(1))),
      () => jsonResponse({ service: "caret", version: "1", instanceId }),
    );

    const { swaps, getUpdates, stop } = startPollingWithSwaps();
    // Let the baseline seed (start-of-poll health check) and one good poll land.
    await until(() => getUpdates() >= 1);
    reviewsFails = true;
    instanceId = "bbbb2222";
    await new Promise((r) => setTimeout(r, 5));
    reviewsFails = false;
    await until(() => swaps.length >= 1);
    stop();
    flush();

    expect(swaps).toEqual(["bbbb2222"]);
  });

  test("onSwap does not fire when instanceId is unchanged", async () => {
    route(
      () => jsonResponse(reviewsOfLength(1)),
      () => jsonResponse({ service: "caret", version: "1", instanceId: "stable00" }),
    );

    await expectNoSwap();
  });

  test("the periodic check catches a swap with no intervening failure", async () => {
    // A same-port takeover completes between 2s polls without any failed tick:
    // reviews never errors, so only the periodic ~5th-poll health check sees it.
    let instanceId = "first000";
    route(
      () => jsonResponse(reviewsOfLength(1)),
      () => jsonResponse({ service: "caret", version: "1", instanceId }),
    );

    const { swaps, getUpdates, stop } = startPollingWithSwaps();
    await until(() => getUpdates() >= 1);
    instanceId = "second00";
    await until(() => swaps.length >= 1);
    stop();
    flush();

    expect(swaps).toEqual(["second00"]);
  });

  test("exactly one warn is logged under step poll with the opaque from/to ids", async () => {
    let instanceId = "from1234";
    route(
      () => jsonResponse(reviewsOfLength(1)),
      () => jsonResponse({ service: "caret", version: "1", instanceId }),
    );

    let updates = 0;
    const stop = startPolling(() => updates++, 1);
    await until(() => updates >= 1);
    instanceId = "to567890";
    await until(() => updates >= 8);
    stop();
    flush();

    const warns = cap
      .events()
      .filter(
        (r) =>
          r.level === "warn" &&
          r.step === "poll" &&
          (r.msg as string).includes("daemon instance changed"),
      );
    expect(warns).toHaveLength(1);
    expect(warns[0]!.extra).toMatchObject({ from: "from1234", to: "to567890" });
  });

  test("a pre-fix daemon (no instanceId) never fires onSwap", async () => {
    route(
      () => jsonResponse(reviewsOfLength(1)),
      () => jsonResponse({ service: "caret", version: "1" }),
    );

    await expectNoSwap();
  });
});

describe("createReviewSelection", () => {
  beforeEach(() => {
    // Reset the deep-link param between cases (selectReview writes the URL).
    setDeepLink(null);
  });

  test("active is derived from reviews + activeId", () => {
    const { sel } = selectionOf({ reviews: [review("a"), review("b")], activeId: "b" });
    expect(sel.active?.id).toBe("b");
  });

  test("selectReview sets activeId and mirrors it into the URL", () => {
    const { store, sel } = selectionOf({ reviews: [review("a")] });
    sel.selectReview("a");
    expect(store.activeId).toBe("a");
    expect(new URLSearchParams(location.search).get("review")).toBe("a");
    sel.selectReview(null);
    expect(store.activeId).toBe(null);
    expect(new URLSearchParams(location.search).get("review")).toBe(null);
  });

  test("merge keeps the active review when it is still present", () => {
    const { store, sel } = selectionOf({ reviews: [review("a")], activeId: "a" });
    sel.mergeReviews([review("a"), review("b")]);
    expect(store.activeId).toBe("a");
  });

  test("merge selects the first review when nothing is active", () => {
    const { store, sel } = selectionOf();
    sel.mergeReviews([review("x"), review("y")]);
    expect(store.activeId).toBe("x");
  });

  test("merge honors the deep link when the active review is gone", () => {
    setDeepLink("y");
    const { store, sel } = selectionOf({ reviews: [review("a")], activeId: "a" });
    // `a` is gone; the deep link `y` wins over the first review `x`.
    sel.mergeReviews([review("x"), review("y")]);
    expect(store.activeId).toBe("y");
  });

  test("merge clears the active id when the snapshot is empty", () => {
    const { store, sel } = selectionOf({ reviews: [review("a")], activeId: "a" });
    sel.mergeReviews([]);
    expect(store.activeId).toBe(null);
  });

  test("afterResolve drops the review and auto-advances to the next", () => {
    const { store, sel } = selectionOf({ reviews: [review("a"), review("b")], activeId: "a" });
    sel.afterResolve("a");
    expect(store.reviews.map((r) => r.id)).toEqual(["b"]);
    expect(store.activeId).toBe("b");
  });

  test("afterResolve clears selection when no reviews remain", () => {
    const { store, sel } = selectionOf({ reviews: [review("a")], activeId: "a" });
    sel.afterResolve("a");
    expect(store.reviews).toEqual([]);
    expect(store.activeId).toBe(null);
  });

  test("connection and daemon-changed flags are settable", () => {
    const { store, sel } = selectionOf();
    sel.setConnected(false);
    expect(store.connected).toBe(false);
    sel.markDaemonChanged();
    expect(store.daemonChanged).toBe(true);
    sel.dismissDaemonChanged();
    expect(store.daemonChanged).toBe(false);
  });
});

describe("createReviewSelection sound events (EXC-1100)", () => {
  /** A selection wired to a recording onSound, plus the events it has reported. */
  function withSound(over: Partial<SelectionStore> = {}) {
    const store = makeStore(over);
    const events: SoundEvent[] = [];
    const sel = createReviewSelection(store, { onSound: (e) => events.push(e) });
    return { store, sel, events };
  }

  test("the first merge seeds silently — reviews already pending at page open are not news", () => {
    const { sel, events } = withSound();
    sel.mergeReviews([review("a"), review("b")]);
    expect(events).toEqual([]);
  });

  test("a genuinely-new review announces one arrival", () => {
    const { sel, events } = withSound();
    sel.mergeReviews([review("a")]);
    sel.mergeReviews([review("a"), review("b")]);
    expect(events).toEqual(["planArrived"]);
  });

  test("two new reviews in one poll still announce one arrival", () => {
    const { sel, events } = withSound();
    sel.mergeReviews([review("a")]);
    sel.mergeReviews([review("a"), review("b"), review("c")]);
    expect(events).toEqual(["planArrived"]);
  });

  test("an unchanged snapshot is silent, so the 2s poll never repeats itself", () => {
    const { sel, events } = withSound();
    sel.mergeReviews([review("a")]);
    sel.mergeReviews([review("a")]);
    sel.mergeReviews([review("a")]);
    expect(events).toEqual([]);
  });

  test("a review bumped to a new version announces a revision, not an arrival", () => {
    const { sel, events } = withSound();
    sel.mergeReviews([review("a", 1)]);
    sel.mergeReviews([review("a", 2)]);
    expect(events).toEqual(["planRevised"]);
  });

  test("a review that vanishes from the snapshot announces an expiry", () => {
    const { sel, events } = withSound();
    sel.mergeReviews([review("a"), review("b")]);
    sel.mergeReviews([review("a")]);
    expect(events).toEqual(["planExpired"]);
  });

  test("a resolved review is already gone locally, so it never reads as an expiry", () => {
    const { sel, events } = withSound({ reviews: [review("a")], activeId: "a" });
    sel.mergeReviews([review("a")]);
    sel.afterResolve("a");
    sel.mergeReviews([]);
    expect(events).toEqual([]);
  });

  test("losing the daemon announces a drop, once", () => {
    const { sel, events } = withSound();
    sel.setConnected(false);
    sel.setConnected(false);
    expect(events).toEqual(["daemonDropped"]);
  });

  test("getting the daemon back announces a reconnect", () => {
    const { sel, events } = withSound();
    sel.setConnected(false);
    sel.setConnected(true);
    expect(events).toEqual(["daemonDropped", "daemonReconnected"]);
  });

  test("a poll confirming the daemon is still up is silent", () => {
    const { sel, events } = withSound();
    sel.setConnected(true);
    sel.setConnected(true);
    expect(events).toEqual([]);
  });

  test("an arrival suppresses a revision in the same poll — the bigger news wins", () => {
    const { sel, events } = withSound();
    sel.mergeReviews([review("a", 1)]);
    sel.mergeReviews([review("a", 2), review("b", 1)]);
    expect(events).toEqual(["planArrived"]);
  });

  test("an expiry sounds alongside an arrival — two separate pieces of news", () => {
    const { sel, events } = withSound();
    sel.mergeReviews([review("a")]);
    sel.mergeReviews([review("b")]);
    expect(events).toEqual(["planArrived", "planExpired"]);
  });

  test("the dep is optional — a selection with no onSound still merges", () => {
    const store = makeStore();
    const sel = createReviewSelection(store);
    sel.mergeReviews([review("a")]);
    sel.mergeReviews([review("a"), review("b")]);
    expect(store.reviews).toHaveLength(2);
  });
});

describe("createReviewSelection unread markers (EXC-411)", () => {
  beforeEach(() => {
    setDeepLink(null);
  });

  test("the first snapshot marks nothing — what was already pending is not news", () => {
    const { sel } = selectionOf();
    sel.mergeReviews([review("a"), review("b")]);
    expect(sel.unread).toEqual([]);
  });

  test("a plan arriving while another is active is marked unread", () => {
    const { sel } = withUnreadB();
    expect(sel.unread).toEqual(["b"]);
  });

  test("a version bump on a background plan re-marks it", () => {
    const { sel } = selectionOf();
    sel.mergeReviews([review("a"), review("b", 1)]);
    sel.selectReview("b");
    sel.selectReview("a");
    sel.mergeReviews([review("a"), review("b", 2)]);
    expect(sel.unread).toEqual(["b"]);
  });

  test("the plan you are reading is never marked, however it became active", () => {
    const { sel } = selectionOf();
    sel.mergeReviews([review("a", 1)]);
    sel.mergeReviews([review("a", 2)]);
    expect(sel.unread).toEqual([]);
  });

  test("an unchanged snapshot marks nothing, so the 2s poll never accumulates", () => {
    const { sel } = selectionOf();
    sel.mergeReviews([review("a")]);
    sel.mergeReviews([review("a")]);
    sel.mergeReviews([review("a")]);
    expect(sel.unread).toEqual([]);
  });

  test("picking the plan from the dropdown clears its mark", () => {
    const { sel } = withUnreadB();
    sel.selectReview("b");
    expect(sel.unread).toEqual([]);
  });

  test("a deep link resolving to the plan clears its mark", () => {
    const { store, sel } = withUnreadB();
    setDeepLink("b");
    // The active plan vanishes, so merge re-selects — through the deep link.
    sel.mergeReviews([review("b")]);
    expect(store.activeId).toBe("b");
    expect(sel.unread).toEqual([]);
  });

  test("merge auto-reselecting onto the plan clears its mark", () => {
    const { store, sel } = withUnreadB();
    expect(sel.unread).toEqual(["b"]);
    sel.mergeReviews([review("b")]);
    expect(store.activeId).toBe("b");
    expect(sel.unread).toEqual([]);
  });

  test("resolve auto-advancing onto the plan clears its mark", () => {
    const { store, sel } = withUnreadB();
    sel.afterResolve("a");
    expect(store.activeId).toBe("b");
    expect(sel.unread).toEqual([]);
  });

  test("a plan bumped twice while unread clears in one select", () => {
    const { sel } = selectionOf();
    sel.mergeReviews([review("a"), review("b", 1)]);
    sel.mergeReviews([review("a"), review("b", 2)]);
    sel.mergeReviews([review("a"), review("b", 3)]);
    expect(sel.unread).toEqual(["b"]);
    sel.selectReview("b");
    expect(sel.unread).toEqual([]);
  });

  test("a plan expiring while unread is pruned, so no mark outlives its row", () => {
    const { sel } = withUnreadB();
    expect(sel.unread).toEqual(["b"]);
    sel.mergeReviews([review("a")]);
    expect(sel.unread).toEqual([]);
  });

  test("a tick that clears one mark and raises another still counts an arrival", () => {
    const { sel } = withUnreadB();
    expect(sel.unread).toEqual(["b"]);
    const before = sel.arrivals;
    // b expires and c lands in the same poll: the total stays at one, so a count
    // delta would report no arrival even though a plan did arrive.
    sel.mergeReviews([review("a"), review("c")]);
    expect(sel.unread).toEqual(["c"]);
    expect(sel.arrivals).toBe(before + 1);
  });

  test("seeding and unchanged snapshots never count an arrival", () => {
    const { sel } = selectionOf();
    sel.mergeReviews([review("a"), review("b")]);
    sel.mergeReviews([review("a"), review("b")]);
    expect(sel.arrivals).toBe(0);
  });

  test("resolving an unread plan prunes its mark", () => {
    const { sel } = selectionOf();
    sel.mergeReviews([review("a")]);
    sel.mergeReviews([review("a"), review("b"), review("c")]);
    expect(sel.unread).toEqual(["b", "c"]);
    sel.afterResolve("b");
    expect(sel.unread).toEqual(["c"]);
  });
});
