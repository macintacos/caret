import "@ui/test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ClientReview } from "@core/lib/types";
import { type LogCapture, logCapture } from "@ui/test-helpers.ts";
import {
  createReviewSelection,
  type SelectionStore,
  startPolling,
} from "@/state/polling.svelte.ts";
import { flush } from "$lib/log.ts";
import type { SoundEvent } from "$lib/sound.ts";

// Shared URL-routing fetch double (test-helpers.ts): /api/logs POSTs are
// captured; the review/health endpoints answer from the per-test `respond`.
let respond: (url: string, options: RequestInit | undefined) => Promise<Response>;
let cap: LogCapture;

beforeEach(() => {
  respond = () => Promise.resolve(new Response(null, { status: 204 }));
  cap = logCapture((url, options) => respond(url, options));
});

afterEach(() => {
  cap.restore();
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Build a ClientReview list of `n` placeholder reviews to drive count changes.
function reviewsOfLength(n: number): ClientReview[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}` }) as unknown as ClientReview);
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
    // Sequence: fail, fail, then succeed with one review.
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

  test("onSwap fires once when instanceId changes across a failure→recovery edge", async () => {
    // Health flips identity while the reviews poll is mid-outage; the recovery
    // edge re-checks identity and notices the swap.
    let instanceId = "aaaa1111";
    let reviewsFails = false;
    route(
      () => (reviewsFails ? new Response(null, { status: 503 }) : jsonResponse(reviewsOfLength(1))),
      () => jsonResponse({ service: "caret", version: "1", instanceId }),
    );

    const swaps: string[] = [];
    let updates = 0;
    const stop = startPolling(
      () => updates++,
      1,
      undefined,
      (id) => swaps.push(id),
    );
    // Let the baseline seed (start-of-poll health check) and one good poll land.
    await until(() => updates >= 1);
    // Now drive an outage, swap identity behind it, then recover.
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

    const swaps: string[] = [];
    let updates = 0;
    const stop = startPolling(
      () => updates++,
      1,
      undefined,
      (id) => swaps.push(id),
    );
    await until(() => updates >= 8);
    stop();
    flush();

    expect(swaps).toEqual([]);
  });

  test("the periodic check catches a swap with no intervening failure", async () => {
    // A same-port takeover completes between 2s polls without any failed tick:
    // reviews never errors, so only the periodic ~5th-poll health check sees it.
    let instanceId = "first000";
    route(
      () => jsonResponse(reviewsOfLength(1)),
      () => jsonResponse({ service: "caret", version: "1", instanceId }),
    );

    const swaps: string[] = [];
    let updates = 0;
    const stop = startPolling(
      () => updates++,
      1,
      undefined,
      (id) => swaps.push(id),
    );
    await until(() => updates >= 1);
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

    const swaps: string[] = [];
    let updates = 0;
    const stop = startPolling(
      () => updates++,
      1,
      undefined,
      (id) => swaps.push(id),
    );
    await until(() => updates >= 8);
    stop();
    flush();

    expect(swaps).toEqual([]);
  });
});

describe("createReviewSelection", () => {
  // A minimal review with just the fields the selection reads.
  function review(id: string): ClientReview {
    return { id } as unknown as ClientReview;
  }

  function makeStore(over: Partial<SelectionStore> = {}): SelectionStore {
    return { reviews: [], activeId: null, connected: true, daemonChanged: false, ...over };
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

  beforeEach(() => {
    // Reset the deep-link param between cases (selectReview writes the URL).
    setDeepLink(null);
  });

  test("active is derived from reviews + activeId", () => {
    const store = makeStore({ reviews: [review("a"), review("b")], activeId: "b" });
    const sel = createReviewSelection(store);
    expect(sel.active?.id).toBe("b");
  });

  test("selectReview sets activeId and mirrors it into the URL", () => {
    const store = makeStore({ reviews: [review("a")] });
    const sel = createReviewSelection(store);
    sel.selectReview("a");
    expect(store.activeId).toBe("a");
    expect(new URLSearchParams(location.search).get("review")).toBe("a");
    sel.selectReview(null);
    expect(store.activeId).toBe(null);
    expect(new URLSearchParams(location.search).get("review")).toBe(null);
  });

  test("merge keeps the active review when it is still present", () => {
    const store = makeStore({ reviews: [review("a")], activeId: "a" });
    const sel = createReviewSelection(store);
    sel.mergeReviews([review("a"), review("b")]);
    expect(store.activeId).toBe("a");
  });

  test("merge selects the first review when nothing is active", () => {
    const store = makeStore();
    const sel = createReviewSelection(store);
    sel.mergeReviews([review("x"), review("y")]);
    expect(store.activeId).toBe("x");
  });

  test("merge honors the deep link when the active review is gone", () => {
    setDeepLink("y");
    const store = makeStore({ reviews: [review("a")], activeId: "a" });
    const sel = createReviewSelection(store);
    // `a` is gone; the deep link `y` wins over the first review `x`.
    sel.mergeReviews([review("x"), review("y")]);
    expect(store.activeId).toBe("y");
  });

  test("merge clears the active id when the snapshot is empty", () => {
    const store = makeStore({ reviews: [review("a")], activeId: "a" });
    const sel = createReviewSelection(store);
    sel.mergeReviews([]);
    expect(store.activeId).toBe(null);
  });

  test("afterResolve drops the review and auto-advances to the next", () => {
    const store = makeStore({ reviews: [review("a"), review("b")], activeId: "a" });
    const sel = createReviewSelection(store);
    sel.afterResolve("a");
    expect(store.reviews.map((r) => r.id)).toEqual(["b"]);
    expect(store.activeId).toBe("b");
  });

  test("afterResolve clears selection when no reviews remain", () => {
    const store = makeStore({ reviews: [review("a")], activeId: "a" });
    const sel = createReviewSelection(store);
    sel.afterResolve("a");
    expect(store.reviews).toEqual([]);
    expect(store.activeId).toBe(null);
  });

  test("connection and daemon-changed flags are settable", () => {
    const store = makeStore();
    const sel = createReviewSelection(store);
    sel.setConnected(false);
    expect(store.connected).toBe(false);
    sel.markDaemonChanged();
    expect(store.daemonChanged).toBe(true);
    sel.dismissDaemonChanged();
    expect(store.daemonChanged).toBe(false);
  });
});

describe("createReviewSelection sound events (EXC-1100)", () => {
  function review(id: string, version = 1): ClientReview {
    return { id, version } as unknown as ClientReview;
  }

  function makeStore(over: Partial<SelectionStore> = {}): SelectionStore {
    return { reviews: [], activeId: null, connected: true, daemonChanged: false, ...over };
  }

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

  test("the dep is optional — a selection with no onSound still merges", () => {
    const store = makeStore();
    const sel = createReviewSelection(store);
    sel.mergeReviews([review("a")]);
    sel.mergeReviews([review("a"), review("b")]);
    expect(store.reviews).toHaveLength(2);
  });
});
