// Safe Mode: a brief guard against accidental in-flight keystrokes. When the
// view opens (page load) or regains focus, a keystroke that arrives within the
// grace window is treated as an accidental interruption — the user was typing
// elsewhere when caret grabbed focus. While Safe Mode is active every key event
// is swallowed (capture-phase preventDefault + stopImmediatePropagation) so no
// shortcut fires and nothing is typed, until the duration elapses.
//
// Framework-agnostic and unit-tested in isolation; App.svelte wires it to a
// `window` target and reflects `onChange` into reactive state.

import { uiLog } from "./log.ts";

export interface SafeModeOptions {
  /** Event source to guard — `window` in the app. */
  target: EventTarget;
  /** Notified whenever Safe Mode turns on (true) or off (false). */
  onChange: (active: boolean) => void;
  /** Monotonic clock; injectable for tests. Defaults to performance.now. */
  now?: () => number;
  /** A keystroke this soon after arming triggers Safe Mode. */
  graceMs?: number;
  /** How long Safe Mode swallows input once triggered. */
  durationMs?: number;
}

export interface SafeModeGuard {
  /** (Re)open the grace window — call on open and on every refocus. */
  arm: () => void;
  isActive: () => boolean;
  /** Cancel any pending timer and detach listeners. */
  destroy: () => void;
}

export function createSafeModeGuard(opts: SafeModeOptions): SafeModeGuard {
  const now = opts.now ?? (() => performance.now());
  const graceMs = opts.graceMs ?? 300;
  const durationMs = opts.durationMs ?? 2000;

  let armedAt = now();
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Key events eaten during the current activation — never the keys themselves,
  // only the count (a key sequence reconstructs what the user was typing).
  let swallowed = 0;

  function eat(e: Event) {
    e.preventDefault();
    e.stopImmediatePropagation();
    swallowed++;
  }

  function deactivate() {
    timer = undefined;
    if (!active) return;
    active = false;
    uiLog.debug("ui", "safe mode released", { swallowed });
    opts.onChange(false);
  }

  function onKeyDown(e: Event) {
    if (active) {
      eat(e);
      return;
    }
    if (now() - armedAt <= graceMs) {
      swallowed = 0; // reset per activation, before the triggering eat() counts
      eat(e);
      active = true;
      uiLog.info("ui", "safe mode triggered");
      opts.onChange(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(deactivate, durationMs);
    }
  }

  function onKeyUp(e: Event) {
    if (active) eat(e);
  }

  opts.target.addEventListener("keydown", onKeyDown, true);
  opts.target.addEventListener("keyup", onKeyUp, true);

  return {
    arm() {
      armedAt = now();
    },
    isActive() {
      return active;
    },
    destroy() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      opts.target.removeEventListener("keydown", onKeyDown, true);
      opts.target.removeEventListener("keyup", onKeyUp, true);
    },
  };
}
