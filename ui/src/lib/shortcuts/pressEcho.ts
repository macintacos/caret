// The press a shortcut plays on its on-screen control: each control showing it
// (`data-key-pressed`) for PRESS_HOLD_MS, the same press a click plays. While any
// press echoes, the root carries `data-key-echo`, so a modal the key opens holds its
// entrance until the cap's sink has been seen (shadcn-bridge.css).

import { ariaKeyshortcuts, type ShortcutEntry } from "$lib/shortcuts/registry.ts";

/** How long a keyed control shows pressed. A hold, not a transition, so it sits
 * outside the motion durations: a click's mousedown-to-mouseup, so a key's press
 * reads as long as a click's. shadcn-bridge.css repeats it; keep the two in sync. */
export const PRESS_HOLD_MS = 110;

/** A modal's entrance, --dur-state in tokens.css; keep the two in sync. */
const ENTRANCE_MS = 160;

export interface PressEchoDeps {
  /** Carries the echo flag. Defaults to `document.documentElement`. */
  root?: Element;
  /** The on-screen controls a shortcut stands for. Defaults to the visible
   * elements whose aria-keyshortcuts names it. */
  controlsFor?: (entry: ShortcutEntry) => Element[];
  /** Schedules a release and returns its cancel. Defaults to setTimeout. */
  schedule?: (run: () => void, ms: number) => () => void;
}

/** Default control lookup: the rendered elements carrying the shortcut's own
 * aria-keyshortcuts value. A control hidden by CSS has no client rects. */
function defaultControlsFor(entry: ShortcutEntry): Element[] {
  const value = CSS.escape(ariaKeyshortcuts(entry.keys));
  return [...document.querySelectorAll(`[aria-keyshortcuts="${value}"]`)].filter(
    (el) => el.getClientRects().length > 0,
  );
}

const defaultSchedule = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/** A dispatcher `onRun` hook that echoes each run shortcut's press. */
export function createPressEcho(deps: PressEchoDeps = {}): (entry: ShortcutEntry) => void {
  const root = deps.root ?? document.documentElement;
  const controlsFor = deps.controlsFor ?? defaultControlsFor;
  const schedule = deps.schedule ?? defaultSchedule;
  const pendingReleases = new Map<Element, () => void>();
  let cancelEcho: (() => void) | undefined;

  function release(el: Element): void {
    pendingReleases.delete(el);
    el.removeAttribute("data-key-pressed");
  }

  return (entry) => {
    const controls = controlsFor(entry);
    if (controls.length === 0) return;
    for (const el of controls) {
      pendingReleases.get(el)?.();
      el.setAttribute("data-key-pressed", "");
      pendingReleases.set(
        el,
        schedule(() => release(el), PRESS_HOLD_MS),
      );
    }
    // The flag outlives the hold by the entrance it delays: dropping the delay
    // mid-animation would jump the modal forward.
    cancelEcho?.();
    root.setAttribute("data-key-echo", "");
    cancelEcho = schedule(() => root.removeAttribute("data-key-echo"), PRESS_HOLD_MS + ENTRANCE_MS);
  };
}
