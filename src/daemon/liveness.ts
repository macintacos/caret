// When the daemon steps down. Idle releases it once nothing holds it up; a drain,
// begun on retire/SIGTERM, releases it once no write is in flight and no decision is
// unread, bounded by a deadline. Once a drain begins it owns the release, so idle can
// no longer end the daemon.

import { isSafeMethod } from "@/daemon/guards.ts";
import type { CaretLogger } from "@/lib/log.ts";

export interface LivenessDeps {
  idleMs: number;
  drainMs: number;
  /** Never arm idle, so only a drain releases. */
  resident: boolean;
  pendingCount: () => number;
  openDecisionCount: () => number;
  unreadDecisionCount: () => number;
  uiPresent: () => boolean;
  /** Stop serving and exit. Called at most once, by whichever of idle or drain wins. */
  release: () => void;
  log: CaretLogger;
  /** Defaults to setTimeout; injectable so a test fires idle deterministically. */
  setIdleTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Defaults to clearTimeout. */
  clearIdleTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface Liveness {
  /** Arm idle unless a review is pending. Construction does not, so a caller arms once it
   * can serve. */
  arm(): void;
  /** Bracket one request; the returned callback ends it. */
  begin(method: string): () => void;
  /** Hold a drain open until `write` settles, so a write detached from its request (and
   * never delaying the response) still lands. A rejection is the caller's to log. */
  detachedWrite(write: Promise<void>): void;
  isDraining(): boolean;
  /** Begin stepping down: release once no write is in flight and no decision is unread,
   * or at drainMs. Idempotent. */
  drain(): void;
  /** Cancel liveness's timers so it never releases. Does not call release. */
  stop(): void;
}

export function createLiveness(deps: LivenessDeps): Liveness {
  const { idleMs, drainMs, resident, uiPresent, log } = deps;
  const { pendingCount, openDecisionCount, unreadDecisionCount } = deps;
  const setIdleTimer = deps.setIdleTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearIdleTimer = deps.clearIdleTimer ?? ((h) => clearTimeout(h));

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = 0;
  // The non-safe-method subset of inFlight: what a drain must let land. Reads are
  // safe to cut — a hook re-polls and the UI reloads.
  let writesInFlight = 0;
  let stopped = false;
  let draining = false;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelIdle() {
    if (idleTimer) {
      clearIdleTimer(idleTimer);
      idleTimer = null;
    }
  }
  function armIdle() {
    if (resident || draining || idleTimer || stopped || pendingCount() !== 0) return;
    idleTimer = setIdleTimer(maybeShutdown, idleMs);
  }
  // Arm when no review is awaiting a decision; cancel while one is pending.
  // (A `rejected` review persists to disk and rehydrates when its revision
  // arrives, so it must not keep the daemon alive.)
  function refreshIdle() {
    if (pendingCount() === 0) armIdle();
    else cancelIdle();
  }
  function maybeShutdown() {
    idleTimer = null;
    // Re-check liveness atomically (single-threaded loop). A present UI tab is the
    // non-obvious term: an open tab is the daemon's reason to stay up (EXC-562),
    // and the else-branch re-arms so it shuts down once that tab goes away.
    if (pendingCount() === 0 && openDecisionCount() === 0 && inFlight === 0 && !uiPresent()) {
      log.info("idle", "idle shutdown");
      release();
    } else if (pendingCount() === 0) {
      armIdle();
    }
  }

  function drain() {
    if (draining || stopped) return;
    draining = true;
    // A drain owns the release: an idle shutdown would cut what it waits for.
    cancelIdle();
    log.info("drain", "drain started", { unread: unreadDecisionCount() });
    drainTimer = setTimeout(drainDeadline, drainMs);
    // SIGTERM arrives outside any request, so no request's end re-checks for it.
    setTimeout(maybeReleaseDrain, 0);
  }
  // Releases once no write is in flight and no settled decision is unread. Not
  // openDecisionCount or inFlight, as idle uses: an unsettled entry is a hook
  // waiting on a human and a parked long-poll is a read, so either would ride out
  // the deadline.
  //
  // ponytail: an unread entry whose hook is gone (killed without /expire, an
  // approval `caret reconcile` mirrored, a read-before-settle orphan) holds the
  // drain to its deadline — and an approved one is never reclaimed, so it can date
  // from anywhere in a resident daemon's uptime. Tracking which entries still have
  // a polling reader is the upgrade.
  function maybeReleaseDrain() {
    if (stopped || writesInFlight > 0 || unreadDecisionCount() > 0) return;
    log.info("drain", "drain complete");
    release();
  }
  function drainDeadline() {
    log.warn("drain", "drain deadline reached", {
      unread: unreadDecisionCount(),
      writes: writesInFlight,
    });
    release();
  }
  function detachedWrite(write: Promise<void>) {
    writesInFlight++;
    const settled = () => {
      writesInFlight--;
      if (draining) setTimeout(maybeReleaseDrain, 0);
    };
    void write.then(settled, settled);
  }

  function begin(method: string) {
    inFlight++;
    const isWrite = !isSafeMethod(method);
    if (isWrite) writesInFlight++;
    cancelIdle(); // any in-flight request defers an idle shutdown
    return () => {
      inFlight--;
      if (isWrite) writesInFlight--;
      // Reconcile idle after every request — even a thrown one — so the timer
      // is never left permanently disarmed.
      refreshIdle();
      // A tick later, not inline: the response that settled the drain flushes
      // first, and handleResolve's deferred resolveDecision lands before the
      // unread count is read (timers run FIFO).
      if (draining) setTimeout(maybeReleaseDrain, 0);
    };
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelIdle();
    clearTimeout(drainTimer);
  }
  function release() {
    stop();
    deps.release();
  }

  return { arm: refreshIdle, begin, detachedWrite, isDraining: () => draining, drain, stop };
}
