// Plan notifier (EXC-427): when the 2s poll surfaces a genuinely-new review
// while the user is away — tab hidden OR window unfocused — and notification
// permission is granted, fire a page-context Web Notification whose click
// focuses the tab and selects that review. A notification click is a user
// gesture, so window.focus() is the one focus path browsers reliably allow —
// the OS-level counterpart to opening a new tab per plan. visibilityState
// alone misses the common case of a visible-but-background window, which is
// why the away-check also reads document.hasFocus().
//
// Framework-agnostic and unit-tested in isolation (cf. safeMode.ts): every
// browser surface (Notification, visibility, focus) is an injectable option,
// so happy-dom's missing Notification API never matters to the tests.
//
// Also exports bellPresentation, the pure permission → badge mapping consumed
// by NotifyBell.svelte — kept here because bun:test can't compile .svelte.

import type { IconName } from "./icons.ts";
import { shortId, uiLog } from "./log.ts";

/** Minimal surface the notifier needs from a constructed Notification. */
export interface NotificationHandle {
  onclick: (() => void) | null;
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
}

export interface PlanNotifier {
  /** Feed each poll snapshot. The first call seeds the seen-set silently
   * (reviews already pending at page open are on screen, not news); later
   * calls fire one notification per genuinely-new id when the user is away
   * and permission is granted, then prune the set to the incoming ids. */
  observe: (reviews: PlanReviewLike[]) => void;
}

const NOTIFICATION_TITLE = "caret: new plan ready";

// Notification construction can throw (e.g. platforms that require a service
// worker) — notifications are non-essential, so degrade to a silent no-op.
function defaultNotify(title: string, body: string): NotificationHandle | null {
  if (typeof Notification === "undefined") return null;
  try {
    // Structurally compatible at runtime (zero-arg onclick is a valid DOM
    // handler); the cast bridges the DOM's wider (this, ev) onclick signature.
    return new Notification(title, { body }) as NotificationHandle;
  } catch {
    return null;
  }
}

function defaultPermission(): NotificationPermission {
  return typeof Notification === "undefined" ? "default" : Notification.permission;
}

export function createPlanNotifier(opts: PlanNotifierOptions): PlanNotifier {
  const notify = opts.notify ?? defaultNotify;
  const isAway =
    opts.isAway ?? (() => document.visibilityState !== "visible" || !document.hasFocus());
  const permission = opts.permission ?? defaultPermission;
  const focus = opts.focus ?? (() => window.focus());

  // null until the first observe seeds it. Pruning to each snapshot bounds the
  // set to the pending count, and a pruned id reappearing counts as new again.
  // That reappearance is the revision lifecycle: a request-changes round flips
  // the review to rejected (it leaves the pending list), and the revised plan
  // re-pends the SAME id — so a revision the user is waiting on notifies,
  // deliberately. Only an id continuously present never re-fires.
  let seen: Set<string> | null = null;

  return {
    observe(reviews) {
      const prev = seen;
      seen = new Set(reviews.map((r) => r.id));
      if (prev === null) return; // first poll: seed silently
      if (!isAway() || permission() !== "granted") return;
      for (const r of reviews) {
        if (prev.has(r.id)) continue;
        // The body renders on the user's own desktop — never log it.
        const handle = notify(NOTIFICATION_TITLE, `${r.title} — ${r.cwd}`);
        if (!handle) continue;
        uiLog.info("ui", `plan notification fired: ${shortId(r.id)}`, { reviewId: r.id });
        handle.onclick = () => {
          uiLog.debug("ui", `plan notification clicked: ${shortId(r.id)}`, { reviewId: r.id });
          focus();
          opts.onSelect(r.id);
          handle.close();
        };
      }
    },
  };
}

// ----- Permission bell badge mapping -----

export type BellTone = "ok" | "danger" | "muted";

export interface BellPresentation {
  /** Base icon. */
  icon: IconName;
  /** Small icon overlaid at the base icon's top-right (undecided state). */
  overlay?: IconName;
  tone: BellTone;
  /** Tooltip explaining the current state. */
  title: string;
  /** Whether a click should call Notification.requestPermission(). */
  canRequest: boolean;
}

/** Pure permission → badge presentation mapping for NotifyBell.svelte. */
export function bellPresentation(permission: NotificationPermission): BellPresentation {
  switch (permission) {
    case "granted":
      return {
        icon: "bell",
        tone: "ok",
        title: "Desktop notifications on — new plans notify you while caret is in the background",
        canRequest: false,
      };
    case "denied":
      return {
        icon: "bell-off",
        tone: "danger",
        title: "Notifications blocked — re-enable them in your browser's site settings",
        canRequest: false,
      };
    default:
      return {
        icon: "bell",
        overlay: "circle-question-mark",
        tone: "muted",
        title: "Enable desktop notifications for new plans",
        canRequest: true,
      };
  }
}
