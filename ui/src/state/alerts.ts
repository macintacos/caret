// The in-UI alert/toast queue (EXC-850). A plain, node-free factory over an
// injected store — the same state-factory-over-injected-store shape as the rest
// of ui/src/state/*, and the injectable-timer discipline of lib/safeMode.ts — so
// the timing logic unit-tests deterministically without mounting or real timers.
// App.svelte owns the reactive `$state` backing store; AlertHost.svelte renders
// it; this module owns the lifecycle: push, auto-dismiss dwell, and the two-phase
// exit (mark `leaving` so the CSS exit animation runs, then remove).
//
// It is also caret's one funnel for "something just happened", so it is where the
// sound layer attaches (EXC-1100): a push carries a cue derived from its variant,
// or an explicit one the caller names. A verdict names its own so it is heard once
// — as its verdict — rather than sounding twice alongside its confirmation toast.

import type { SoundEvent } from "$lib/sound.ts";

export type AlertVariant = "default" | "success" | "destructive";

/**
 * An affordance that ACTS on an alert, rendered as a labelled button beside the
 * message (EXC-1207: the update toast opens Settings on its Updates pane). It is
 * a button of its own rather than a clickable card: the card already carries the
 * dismiss control, and nesting interactive controls is an accessibility defect.
 */
export interface AlertAction {
  label: string;
  run: () => void;
}

export interface AlertItem {
  id: number;
  variant: AlertVariant;
  title?: string;
  message: string;
  action?: AlertAction;
  /** True once dismissal has begun — drives the CSS exit animation before removal. */
  leaving: boolean;
}

export interface AlertStore {
  alerts: AlertItem[];
}

export interface AlertDeps {
  /**
   * setTimeout-shaped: run `fn` after `ms`, returning a cancel fn. Injectable so
   * tests drive the dwell/exit windows deterministically. Defaults to setTimeout.
   */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** How long an alert dwells before auto-dismissing ("a couple of seconds"). */
  dwellMs?: number;
  /** Exit-animation window before the item is removed (matches --dur-exit = 140ms,
   * pinned by motion.test.ts). */
  exitMs?: number;
  /** Play a cue for a pushed alert. Injectable so tests observe the cue without
   * an AudioContext; absent, the queue is silent. Dismissal never sounds — the
   * news was the alert arriving. */
  sound?: (event: SoundEvent) => void;
}

export interface Alerts {
  /**
   * Enqueue an alert; returns its id. Auto-dismisses after `dwellMs` unless
   * `persistent` — a persistent alert (a failure the user must read and act on)
   * arms no dwell timer and stays until it's manually dismissed.
   */
  push(alert: {
    variant?: AlertVariant;
    title?: string;
    message: string;
    persistent?: boolean;
    action?: AlertAction;
    /** Override the cue the variant would play — `null` pushes silently. */
    sound?: SoundEvent | null;
  }): number;
  /** Begin dismissing an alert now (exit animation, then removal). Idempotent. */
  dismiss(id: number): void;
}

/** The cue a variant plays when the caller names none. */
const VARIANT_SOUND: Record<AlertVariant, SoundEvent> = {
  default: "toastNotice",
  success: "toastSuccess",
  destructive: "toastError",
};

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export function createAlerts(store: AlertStore, deps: AlertDeps = {}): Alerts {
  const schedule = deps.schedule ?? defaultSchedule;
  const dwellMs = deps.dwellMs ?? 4000;
  const exitMs = deps.exitMs ?? 140;

  let nextId = 1;
  // Live dwell-timer cancels, keyed by alert id, so a manual dismiss cancels the
  // pending auto-dismiss instead of firing a redundant second exit.
  const dwellCancels = new Map<number, () => void>();

  function remove(id: number): void {
    store.alerts = store.alerts.filter((a) => a.id !== id);
  }

  function dismiss(id: number): void {
    const item = store.alerts.find((a) => a.id === id);
    if (!item || item.leaving) return;
    item.leaving = true;
    dwellCancels.get(id)?.();
    dwellCancels.delete(id);
    schedule(() => remove(id), exitMs);
  }

  function push(alert: {
    variant?: AlertVariant;
    title?: string;
    message: string;
    persistent?: boolean;
    action?: AlertAction;
    sound?: SoundEvent | null;
  }): number {
    const id = nextId++;
    const variant = alert.variant ?? "default";
    store.alerts = [
      ...store.alerts,
      {
        id,
        variant,
        title: alert.title,
        message: alert.message,
        action: alert.action,
        leaving: false,
      },
    ];
    // `undefined` takes the variant's cue; `null` is a deliberate silence.
    const cue = alert.sound === undefined ? VARIANT_SOUND[variant] : alert.sound;
    if (cue) deps.sound?.(cue);
    // A persistent alert never auto-dismisses — it waits for the user's click.
    if (!alert.persistent) {
      dwellCancels.set(
        id,
        schedule(() => dismiss(id), dwellMs),
      );
    }
    return id;
  }

  return { push, dismiss };
}
