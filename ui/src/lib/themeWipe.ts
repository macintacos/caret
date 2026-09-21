// Running an appearance change as a "wipe" (EXC-730). The View Transitions API
// snapshots the whole page — including the shadow-DOM diff view, as pixels — runs
// the DOM update, and animates between the two snapshots, so the wipe sweeps the
// entire UI in one motion. The wipe geometry itself is CSS (::view-transition-*
// in styles/base.css); this module only decides whether to wrap the swap in a
// transition.
//
// The update is passed in rather than named as a theme id, because every kind of
// appearance change wipes (EXC-773): switching mode, switching a slot's palette,
// and an OS appearance flip under `system`. Boot is the one exception — there is
// no previous frame to wipe from — so main.ts paints directly instead.

import { type ViewTransitionDeps, viewTransitionDeps } from "$lib/viewTransition.ts";

export type ThemeWipeDeps = ViewTransitionDeps;

/** Run a DOM update as a whole-UI wipe when the browser supports the View
 * Transitions API and motion is allowed; otherwise run it instantly. The update
 * runs exactly once either way. */
export function withWipe(update: () => void, deps: ThemeWipeDeps = viewTransitionDeps()): void {
  if (!deps.startViewTransition || deps.prefersReducedMotion()) {
    update();
    return;
  }
  deps.startViewTransition(update);
}
