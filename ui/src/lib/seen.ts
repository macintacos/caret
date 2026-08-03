// Read-detection for the cmux unread mark (EXC-961). A plan submitted from a
// cmux pane leaves that pane unread; the mark should clear once the reviewer has
// genuinely read the plan, not merely once a tab exists somewhere. "Read" is a
// continuous dwell: the review on screen, the tab visible, the window focused,
// for SEEN_DWELL_MS uninterrupted. Losing either presence signal cancels the
// dwell outright rather than pausing it, so a background tab left open all day
// never accumulates its way to a false read.
//
// Framework-agnostic and unit-tested in isolation (cf. safeMode.ts): the
// presence predicate, the timers, and both event sources are injectable options,
// and App.svelte wires the real `window` / `document`. Injecting the timers
// rather than a clock is what makes the dwell window deterministic in a unit.

import { isAway as defaultIsAway } from "$lib/presence.ts";

/** How long a review must stay on screen, visible and focused, to count as read. */
export const SEEN_DWELL_MS = 5000;

export interface SeenWatcherOptions {
  /** Report a review as read. App passes the markSeen API call. */
  onSeen: (id: string) => void;
  /** Whether the user is away from this tab; defaults to presence.ts isAway. */
  isAway?: () => boolean;
  /** Schedule the dwell timer; injectable so tests drive it deterministically. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Cancel a scheduled dwell timer. */
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Focus/blur source — `window` in the app. */
  target: EventTarget;
  /** Visibility source — `document` in the app. */
  doc: EventTarget;
}

export interface SeenWatcher {
  /** Point the dwell at the review now on screen (null when none). Idempotent
   * for an unchanged id:version, so the 2s poll doesn't restart the window. */
  track: (active: { id: string; version: number } | null) => void;
  /** Cancel any pending dwell and detach the presence listeners. Call once, at
   * teardown — the watcher is not reusable afterwards. */
  destroy: () => void;
}

export function createSeenWatcher(opts: SeenWatcherOptions): SeenWatcher {
  const isAway = opts.isAway ?? defaultIsAway;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));

  // The key carries the version, so a revision re-pending the same id — which
  // produces a fresh unread mark on the pane — is reported again, while the 2s
  // poll re-delivering the same version is not.
  const reported = new Set<string>();
  let current: { id: string; version: number; key: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel() {
    if (timer === undefined) return;
    clearTimer(timer);
    timer = undefined;
  }

  function arm() {
    if (timer !== undefined || !current || isAway() || reported.has(current.key)) return;
    const armed = current;
    timer = setTimer(() => {
      timer = undefined;
      reported.add(armed.key);
      opts.onSeen(armed.id);
    }, SEEN_DWELL_MS);
  }

  // Any presence change restarts the decision from scratch: cancel first, then
  // re-arm only if the user is present again. That is what makes the dwell
  // continuous — a refocus starts a fresh window rather than resuming a partial.
  function onPresenceChange() {
    cancel();
    arm();
  }

  opts.target.addEventListener("focus", onPresenceChange);
  opts.target.addEventListener("blur", onPresenceChange);
  opts.doc.addEventListener("visibilitychange", onPresenceChange);

  return {
    track(active) {
      const key = active ? `${active.id}:${active.version}` : null;
      // The poll re-delivering the same review is not a change; restarting the
      // dwell on every poll would mean it never completes.
      if (key === (current?.key ?? null)) return;
      cancel();
      current = active && key ? { ...active, key } : null;
      arm();
    },
    destroy() {
      cancel();
      opts.target.removeEventListener("focus", onPresenceChange);
      opts.target.removeEventListener("blur", onPresenceChange);
      opts.doc.removeEventListener("visibilitychange", onPresenceChange);
    },
  };
}
