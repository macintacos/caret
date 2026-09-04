// Plan notifier (EXC-427): when the 2s poll surfaces a genuinely-new review
// while the user is away — tab hidden OR window unfocused — and notification
// permission is granted, fire a page-context Web Notification whose click
// focuses the tab and selects that review. A notification click is a user
// gesture, so window.focus() is the one focus path browsers reliably allow.
// visibilityState alone misses the common case of a visible-but-background
// window, which is why the away-check also reads document.hasFocus().
//
// Framework-agnostic and unit-tested in isolation (cf. safeMode.ts): every
// browser surface (Notification, visibility, focus) is an injectable option,
// so happy-dom's missing Notification API never matters to the tests.
//
// Also exports bellPresentation, the pure permission → badge mapping consumed
// by NotifyBell.svelte — kept here because bun:test can't compile .svelte.

import type { IconName } from "$lib/icons.ts";
import { shortId, uiLog } from "$lib/log.ts";
import { isAway as defaultIsAway } from "$lib/presence.ts";

/** Minimal surface the notifier needs from a constructed Notification. The
 * show/error events are the only display feedback the platform offers: a
 * granted notification the OS suppresses (macOS Settings, Focus mode) fails
 * SILENTLY at the constructor — only `error` (and the absence of `show`)
 * reveals it. */
export interface NotificationHandle {
  onclick: (() => void) | null;
  onshow?: (() => void) | null;
  onerror?: (() => void) | null;
  close: () => void;
}

/** The slice of ClientReview the notifier reads. */
export interface PlanReviewLike {
  id: string;
  title: string;
  cwd: string;
}

export interface PlanNotifierOptions {
  /** Select a review when its notification is clicked — App passes selectReview. */
  onSelect: (id: string) => void;
  /** Construct a notification; null = unavailable. Injectable for tests. */
  notify?: (title: string, body: string) => NotificationHandle | null;
  /** Whether the user is away (tab hidden or window unfocused). Defaults to
   * document.visibilityState + document.hasFocus(). */
  isAway?: () => boolean;
  /** Current permission. Defaults to Notification.permission. */
  permission?: () => NotificationPermission;
  /** Bring the window forward on click. Defaults to window.focus(). */
  focus?: () => void;
  /** Dedupe a notification across same-origin tabs (EXC-733): return/resolve
   * true if THIS context should fire for the id, false if a peer tab already
   * claimed it. Defaults to a Web Locks claim held just past the poll interval;
   * runtimes without navigator.locks (tests, non-browser) claim synchronously
   * and always win, preserving single-instance behavior. */
  claim?: (id: string) => boolean | Promise<boolean>;
}

export interface PlanNotifier {
  /** Feed each poll snapshot. The first call seeds the seen-set silently
   * (reviews already pending at page open are on screen, not news); later
   * calls fire one notification per genuinely-new id when the user is away
   * and permission is granted, then prune the set to the incoming ids. */
  observe: (reviews: PlanReviewLike[]) => void;
  /** The user returned to caret (focused it, or it became visible). Dismiss
   * every outstanding plan notification when the user is present (EXC-815) —
   * never while away, or it would close a toast they never saw. */
  dismissAllIfPresent: () => void;
}

// An emoji survives the OS toast's bold title styling better than a wordmark prefix.
const NOTIFICATION_TITLE = "🥕 New Plan Ready";

// Notification construction can throw (e.g. platforms that require a service
// worker) — notifications are non-essential, so degrade to a no-op, but a
// LOGGED one: a swallowed construct failure is indistinguishable from a bug.
function defaultNotify(title: string, body: string): NotificationHandle | null {
  if (typeof Notification === "undefined") return null;
  try {
    // Structurally compatible at runtime (zero-arg onclick is a valid DOM
    // handler); the cast bridges the DOM's wider (this, ev) onclick signature.
    return new Notification(title, { body }) as NotificationHandle;
  } catch (err) {
    uiLog.warn("ui", "notification construct failed", { reason: String(err) });
    return null;
  }
}

function defaultPermission(): NotificationPermission {
  return typeof Notification === "undefined" ? "default" : Notification.permission;
}

/** Subscribe to notification-permission changes made outside the caller's own
 * request — the browser's site settings, the first-run onboarding modal, or
 * another caret surface. Each "change" event re-reads the live
 * `Notification.permission` rather than `PermissionStatus.state`, which some
 * engines diverge from, since the former is what the notifier gates on at fire
 * time. Returns a cleanup that detaches the listener; an inert no-op where the
 * Notification API or `navigator.permissions.query` is unavailable. */
export function observePermission(
  onChange: (permission: NotificationPermission) => void,
): () => void {
  const perms = globalThis.navigator?.permissions;
  if (typeof Notification === "undefined" || !perms?.query) return () => {};
  let status: PermissionStatus | undefined;
  let cancelled = false;
  const sync = () => onChange(Notification.permission);
  perms
    .query({ name: "notifications" as PermissionName })
    .then((s) => {
      // The subscription may have been cleaned up while the query was in flight;
      // don't attach a listener the cleanup already ran past.
      if (cancelled) return;
      status = s;
      s.addEventListener("change", sync);
    })
    .catch(() => {
      // Some engines reject a notifications permission query — nothing to sync.
    });
  return () => {
    cancelled = true;
    status?.removeEventListener("change", sync);
  };
}

// Open tabs observe a newly-pending review within one 2s poll of each other, so the
// hold must outlast that window yet stay well short of a request-changes → revision
// cycle, which must still notify. Best-effort only: a hidden tab whose timers the
// browser throttles to ~once/minute can poll after the hold expires and duplicate.
const NOTIFY_CLAIM_HOLD_MS = 5000;

// Cross-tab claim via the Web Locks API. The winner resolves true immediately — the
// toast must not wait on the hold — and keeps the lock in the background for
// NOTIFY_CLAIM_HOLD_MS. Runtimes without navigator.locks claim synchronously and
// always win. A rejected request degrades toward firing: a rare duplicate beats a
// lost notification.
export function defaultClaim(id: string): boolean | Promise<boolean> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return true;
  return new Promise<boolean>((resolve) => {
    locks
      .request(`caret-notify-${id}`, { ifAvailable: true }, (lock) => {
        if (lock === null) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise<void>((release) => setTimeout(release, NOTIFY_CLAIM_HOLD_MS));
      })
      .catch((err) => {
        // Degrade toward firing so the notification is never lost, but log — a
        // swallowed claim failure would silently revert to duplicate toasts.
        uiLog.warn("ui", `plan notification claim failed: ${shortId(id)}`, {
          reviewId: id,
          reason: String(err),
        });
        resolve(true);
      });
  });
}

export function createPlanNotifier(opts: PlanNotifierOptions): PlanNotifier {
  const notify = opts.notify ?? defaultNotify;
  const isAway = opts.isAway ?? defaultIsAway;
  const permission = opts.permission ?? defaultPermission;
  const focus = opts.focus ?? (() => window.focus());
  const claim = opts.claim ?? defaultClaim;

  // Fired toasts still on screen, keyed by review id (EXC-815). Retained so they can
  // be closed after the fact — a bare new Notification() handle is otherwise lost the
  // moment fire() returns.
  const handles = new Map<string, NotificationHandle>();

  const dismiss = (id: string) => {
    handles.get(id)?.close();
    handles.delete(id);
  };

  // The body renders on the user's own desktop — never log it.
  const fire = (r: PlanReviewLike) => {
    const handle = notify(NOTIFICATION_TITLE, `${r.title} — ${r.cwd}`);
    if (!handle) {
      uiLog.warn("ui", `plan notification unavailable: ${shortId(r.id)}`, { reviewId: r.id });
      return;
    }
    handles.set(r.id, handle);
    uiLog.info("ui", `plan notification fired: ${shortId(r.id)}`, { reviewId: r.id });
    handle.onshow = () =>
      uiLog.debug("ui", `plan notification shown: ${shortId(r.id)}`, { reviewId: r.id });
    handle.onerror = () =>
      uiLog.warn("ui", `plan notification failed: ${shortId(r.id)}`, { reviewId: r.id });
    handle.onclick = () => {
      uiLog.debug("ui", `plan notification clicked: ${shortId(r.id)}`, { reviewId: r.id });
      focus();
      opts.onSelect(r.id);
      dismiss(r.id);
    };
  };

  // Silent to the user, so log it: every new id must still resolve to exactly one
  // record.
  const skipDuplicate = (r: PlanReviewLike) =>
    uiLog.debug("ui", `plan notification skipped (duplicate): ${shortId(r.id)}`, {
      reviewId: r.id,
    });

  // null until the first observe seeds it. Pruning to each snapshot means a pruned id
  // reappearing counts as new again, deliberately: a request-changes round drops the
  // review from the pending list and the revised plan re-pends the SAME id, which the
  // user is waiting on. Only an id continuously present never re-fires.
  let seen: Set<string> | null = null;

  return {
    observe(reviews) {
      const prev = seen;
      seen = new Set(reviews.map((r) => r.id));
      if (prev === null) return; // first poll: seed silently
      const fresh = reviews.filter((r) => !prev.has(r.id));
      if (fresh.length === 0) return;
      const skip = !isAway() ? "active" : permission() !== "granted" ? "permission" : null;
      if (skip) {
        // The undecided (default) permission skip masquerades as a broken feature on a
        // fresh per-origin install (EXC-559), so it logs at info — discoverable without
        // debug logging. `denied` already shows a danger bell and `active` means the
        // user is watching the review render, so both stay at debug.
        const level = skip === "permission" && permission() === "default" ? "info" : "debug";
        for (const r of fresh) {
          uiLog[level]("ui", `plan notification skipped (${skip}): ${shortId(r.id)}`, {
            reviewId: r.id,
          });
        }
        return;
      }
      for (const r of fresh) {
        const won = claim(r.id);
        if (won === true) fire(r);
        else if (won === false) skipDuplicate(r);
        else void won.then((w) => (w ? fire(r) : skipDuplicate(r)));
      }
    },
    dismissAllIfPresent() {
      // Close every toast, not just the selected plan's: once the user is back, the bell
      // and switcher show all of them. Gated on presence because mergeReviews
      // auto-selects while away, and closing a toast the away user never saw is worse
      // than leaving it.
      if (isAway()) return;
      for (const handle of handles.values()) handle.close();
      handles.clear();
    },
  };
}

/** Fire a test notification through the live default path (the granted bell's
 * click affordance). Returns whether construction succeeded: true with nothing
 * appearing on screen means the OS is suppressing caret's notifications (macOS
 * System Settings → Notifications → the browser; Focus/Do Not Disturb) — the
 * page's logic is fine. */
export function fireTestNotification(): boolean {
  const handle = defaultNotify("🥕 Test notification", "Notifications reach your desktop");
  if (!handle) {
    uiLog.warn("ui", "test notification unavailable");
    return false;
  }
  handle.onshow = () => uiLog.debug("ui", "test notification shown");
  handle.onerror = () => uiLog.warn("ui", "test notification failed");
  uiLog.info("ui", "test notification fired");
  return true;
}

// ----- Permission bell badge mapping -----

export type BellTone = "ok" | "danger" | "muted" | "attention";

export interface BellPresentation {
  /** Base icon. */
  icon: IconName;
  /** Small icon overlaid at the base icon's top-right (undecided state). */
  overlay?: IconName;
  /** Color of the base icon (and the overlay glyph, when present). */
  tone: BellTone;
  /** A small filled status dot pinned to the bell's top-right, colored by this
   * tone. The at-a-glance signal for the decided states (granted → ok, denied
   * → danger); absent in the undecided state, which carries the `?` overlay. */
  dot?: BellTone;
  /** Tooltip explaining the current state. */
  title: string;
  /** Whether a click should call Notification.requestPermission(). */
  canRequest: boolean;
  /** Whether a click should fire a test notification (granted only). */
  canTest: boolean;
}

/** Pure permission → badge presentation mapping for NotifyBell.svelte. The bell
 * itself stays neutral chrome for the decided states so the colored status dot
 * is the signal; the undecided state is the one invitation to act, so it tints
 * `attention` (subtle verdigris) and shows the `?` glyph instead of a dot. */
export function bellPresentation(permission: NotificationPermission): BellPresentation {
  switch (permission) {
    case "granted":
      return {
        icon: "bell",
        tone: "muted",
        dot: "ok",
        title: "Desktop notifications on — click to send a test notification",
        canRequest: false,
        canTest: true,
      };
    case "denied":
      return {
        icon: "bell-off",
        tone: "muted",
        dot: "danger",
        title: "Notifications blocked — re-enable them in your browser's site settings",
        canRequest: false,
        canTest: false,
      };
    default:
      return {
        icon: "bell",
        overlay: "circle-question-mark",
        tone: "attention",
        title: "Enable desktop notifications for new plans",
        canRequest: true,
        canTest: false,
      };
  }
}
