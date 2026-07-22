// Switching the caret theme with a "wipe" (EXC-730). The View Transitions API
// snapshots the whole page — including the shadow-DOM diff view, as pixels — runs
// the DOM update, and animates between the two snapshots, so the wipe sweeps the
// entire UI in one motion. The wipe geometry itself is CSS (::view-transition-*
// in app.css); this module only decides whether to wrap the swap in a transition.
//
// It degrades cleanly: browsers without startViewTransition, and users who ask
// for reduced motion, get an instant swap. The decision is behind injected deps
// so it is unit-testable without a real browser (see themeWipe.test.ts).
//
// Retained, not dead: EXC-843 moved theme selection to a staged Save (applyTheme,
// no wipe), so this has no production caller right now. Kept for EXC-753 (theme
// preview), which decides whether the staged preview re-adopts the wipe.

import { applyTheme, type ThemeId } from "$lib/theme.ts";

/** A page whose View Transitions support we probe without hard-typing the API
 * (it isn't in every TS DOM lib). */
type MaybeViewTransitions = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

export interface ThemeWipeDeps {
  /** Runs the swap inside a wipe when supported; undefined means unsupported. */
  startViewTransition?: (update: () => void) => unknown;
  /** True when the user prefers reduced motion — apply instantly, no wipe. */
  prefersReducedMotion: () => boolean;
  /** Apply and persist the theme. */
  apply: (id: ThemeId) => void;
}

function defaultDeps(): ThemeWipeDeps {
  const doc = typeof document !== "undefined" ? (document as MaybeViewTransitions) : undefined;
  const start = doc?.startViewTransition;
  return {
    startViewTransition: typeof start === "function" ? start.bind(doc) : undefined,
    prefersReducedMotion: () =>
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
    apply: applyTheme,
  };
}

/** Switch the caret theme, wiping the whole UI when the browser supports the View
 * Transitions API and motion is allowed; otherwise apply instantly. */
export function changeTheme(id: ThemeId, deps: ThemeWipeDeps = defaultDeps()): void {
  if (!deps.startViewTransition || deps.prefersReducedMotion()) {
    deps.apply(id);
    return;
  }
  deps.startViewTransition(() => deps.apply(id));
}
