// Review polling, merge, and selection state.
//
// `startPolling` is a self-contained closure (no runes): it polls
// GET /api/reviews on an interval and watches the daemon's identity for a
// same-port takeover. `createReviewSelection` owns the reactive review list,
// the active id, the deep-link reflection, and the connection flags; its merge
// keeps the active review stable across the 2s poll and auto-advances after a
// resolve. The working-copy reload is driven reactively off the derived active
// review (App.svelte), not from here.
//
// The selection also reports the moments only it can see (EXC-1100): a plan
// arriving, one revised in place, one expiring, and the daemon going or coming
// back. Each is a diff between what the last poll held and what this one carries
// — data that lives nowhere else — so the detection sits here rather than in a
// module that would have to keep a second copy of the list.

import type { ClientReview, HealthIdentity } from "@core/lib/types";
import { deepLinkId, setUrl } from "@/state/deepLink.ts";
import { getHealth, listReviews } from "$lib/api.ts";
import { uiLog } from "$lib/log.ts";
import type { SoundEvent } from "$lib/sound.ts";

// Re-check the daemon's identity every Nth successful poll: a same-port
// takeover by a newer build can complete between 2s polls without a single
// failed tick, so the recovery-edge check alone would miss it.
const IDENTITY_CHECK_EVERY = 5;

/**
 * Polls GET /api/reviews on an interval, invoking `onUpdate` with each fresh
 * snapshot. Returns a stop function. Errors are reported via `onError` (or
 * swallowed) so a transient daemon hiccup doesn't kill the loop.
 *
 * `onSwap` fires once when the daemon behind the port is replaced — its
 * per-boot `instanceId` (GET /api/health) differs from the last seen one. The
 * id is checked at three points: once at start (seeds the baseline), on each
 * failure→recovery edge, and on every ~5th successful poll.
 */
export function startPolling(
  onUpdate: (reviews: ClientReview[]) => void,
  intervalMs = 2000,
  onError?: (err: unknown) => void,
  onSwap?: (instanceId: string) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Transition state: log only when the poll's health flips or the pending count
  // changes — never per-tick, which would drown the timeline in noise. Health is
  // carried by `failures` alone: zero ⟺ healthy.
  let failures = 0;
  let lastCount = -1;
  let successes = 0;
  // Last-seen daemon identity. `undefined` until the first health read seeds it;
  // a pre-fix daemon (no instanceId) keeps it undefined, so detection no-ops.
  let lastInstanceId: string | undefined;

  // Fetch /api/health and compare its instanceId against the baseline. Fires
  // onSwap (and logs one warn) only when a previous id existed and differs;
  // then advances the baseline so one swap yields one notification, not one per
  // poll. Opaque ids only — stateDir is identifying and is never read/logged.
  // No in-flight guard: after the one-time boot seed, every call comes from
  // inside the serialized tick loop (and the first periodic check is ≥5
  // intervals out), so two checks can never overlap — keep it that way if you
  // add a call site.
  const checkIdentity = async () => {
    let health: HealthIdentity;
    try {
      health = await getHealth();
    } catch {
      return; // health hiccup is not a swap; the reviews poll tracks liveness
    }
    // A check resolving after stop() must not fire a detached poller's onSwap.
    if (stopped) return;
    const id = health.instanceId;
    if (id === undefined) return; // pre-fix daemon: cannot detect, skip
    const prev = lastInstanceId;
    lastInstanceId = id;
    if (prev !== undefined && prev !== id) {
      uiLog.warn("poll", "daemon instance changed", { from: prev, to: id });
      onSwap?.(id);
    }
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const reviews = await listReviews();
      let checked = false;
      if (failures > 0) {
        uiLog.info("poll", "poll recovered", { failures });
        failures = 0;
        // A swap can complete during an outage; re-check on the recovery edge.
        await checkIdentity();
        checked = true;
      }
      if (reviews.length !== lastCount) {
        uiLog.debug("poll", `reviews pending: ${reviews.length}`, { count: reviews.length });
        lastCount = reviews.length;
      }
      successes++;
      // Skip the periodic check on a tick that already checked on recovery.
      if (!checked && successes % IDENTITY_CHECK_EVERY === 0) await checkIdentity();
      if (!stopped) onUpdate(reviews);
    } catch (err) {
      // Warn only on the healthy→unhealthy transition; a sustained outage logs once.
      if (failures === 0) uiLog.warn("poll", "poll failed", { reason: String(err) });
      failures++;
      onError?.(err);
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };

  // Seed the identity baseline concurrently with the first poll — the seed
  // can't detect a swap (nothing to differ from), so it must not delay the
  // first reviews snapshot by a serial health round-trip.
  void checkIdentity();
  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export interface ReviewSelection {
  /** Reactive pending-review list (replaced wholesale each poll). */
  readonly reviews: ClientReview[];
  /** The active review id, or null when nothing is selected. */
  readonly activeId: string | null;
  /** The active review object, or null. */
  readonly active: ClientReview | null;
  /** Whether the daemon is reachable (false on a network failure, not a 4xx). */
  readonly connected: boolean;
  /** Set once when the daemon behind the port is replaced (instanceId flip). */
  readonly daemonChanged: boolean;

  /** Mark the daemon connected/disconnected from an API outcome. */
  setConnected: (value: boolean) => void;
  /** Mark the daemon as replaced (persistent until reload or dismiss). */
  markDaemonChanged: () => void;
  /** Dismiss the replaced-daemon banner. */
  dismissDaemonChanged: () => void;
  /** Select a review (mirrors the id into the URL). */
  selectReview: (id: string | null) => void;
  /** Merge a fresh poll snapshot, keeping the active review stable. */
  mergeReviews: (incoming: ClientReview[]) => void;
  /** Drop a resolved review and auto-advance to the next pending one. */
  afterResolve: (id: string) => void;
}

/** The effects the selection performs beyond mutating its store, injectable in
 * the shape the rest of `@/state/*` uses. */
export interface SelectionDeps {
  /** Report a moment worth hearing. Absent, the selection is silent. */
  onSound?: (event: SoundEvent) => void;
}

/** Backing fields the selection reads and writes. App.svelte supplies a
 * `$state`-backed implementation; tests supply a plain object. */
export interface SelectionStore {
  reviews: ClientReview[];
  activeId: string | null;
  connected: boolean;
  daemonChanged: boolean;
}

/**
 * Owns review-list merge and active-selection, including deep-link resolution
 * and post-resolve auto-advance. The active review is derived from
 * `reviews` + `activeId`, so App.svelte drives the working-copy reload off a
 * reactive `active` — including the case where the poll bumps the active
 * review to a new version without changing the id.
 */
export function createReviewSelection(
  store: SelectionStore,
  deps: SelectionDeps = {},
): ReviewSelection {
  const activeOf = (): ClientReview | null =>
    store.reviews.find((r) => r.id === store.activeId) ?? null;

  const select = (id: string | null) => {
    store.activeId = id;
    setUrl(id);
  };

  // The first snapshot seeds silently: reviews already pending when the page
  // opened are on screen, not news — the same rule createPlanNotifier's seen-set
  // follows for desktop notifications.
  let seeded = false;

  /** Announce what changed between the last snapshot and `incoming`. At most one
   * cue per kind, so a poll that brings three plans is one arrival rather than
   * three overlapping sounds — and an arrival SUPPRESSES a revision in the same
   * poll, since the bigger news wins. An expiry is not on that ladder: it can
   * sound alongside either, because a plan leaving and a plan landing are two
   * separate pieces of news. */
  function announceMerge(incoming: readonly ClientReview[]): void {
    if (!seeded) {
      seeded = true;
      return;
    }
    const before = new Map(store.reviews.map((r) => [r.id, r.version]));
    if (incoming.some((r) => !before.has(r.id))) deps.onSound?.("planArrived");
    else if (incoming.some((r) => (before.get(r.id) ?? r.version) < r.version))
      deps.onSound?.("planRevised");
    const after = new Set(incoming.map((r) => r.id));
    if (store.reviews.some((r) => !after.has(r.id))) deps.onSound?.("planExpired");
  }

  return {
    get reviews() {
      return store.reviews;
    },
    get activeId() {
      return store.activeId;
    },
    get active() {
      return activeOf();
    },
    get connected() {
      return store.connected;
    },
    get daemonChanged() {
      return store.daemonChanged;
    },
    setConnected(value) {
      // Sound the transition only. Every poll tick reports the connection, so a
      // per-call cue would be a metronome.
      if (value !== store.connected) deps.onSound?.(value ? "daemonReconnected" : "daemonDropped");
      store.connected = value;
    },
    markDaemonChanged() {
      store.daemonChanged = true;
    },
    dismissDaemonChanged() {
      store.daemonChanged = false;
    },
    selectReview: select,
    mergeReviews(incoming) {
      announceMerge(incoming);
      store.reviews = incoming;
      // Pick active: keep current if still present, else deep link, else first.
      if (!store.activeId || !incoming.some((r) => r.id === store.activeId)) {
        const wanted = deepLinkId();
        const next =
          (wanted && incoming.find((r) => r.id === wanted)?.id) ?? incoming[0]?.id ?? null;
        if (next !== store.activeId) select(next);
      }
    },
    afterResolve(id) {
      const remaining = store.reviews.filter((r) => r.id !== id);
      store.reviews = remaining;
      // Auto-advance to the next pending review, or clear.
      select(remaining[0]?.id ?? null);
    },
  };
}
