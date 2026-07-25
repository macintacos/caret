// Running an appearance change as a "wipe" (EXC-730). The View Transitions API
// snapshots the whole page — including the shadow-DOM diff view, as pixels — runs
// the DOM update, and animates between the two snapshots, so the wipe sweeps the
// entire UI in one motion. The wipe geometry itself is CSS (::view-transition-*
// in app.css); this module only decides whether to wrap the swap in a transition.
//
// It degrades cleanly: browsers without startViewTransition, and users who ask
// for reduced motion, get an instant swap. The decision is behind injected deps
// so it is unit-testable without a real browser (see themeWipe.test.ts).
//
// The update is passed in rather than named as a theme id, because every kind of
// appearance change wipes (EXC-773): switching mode, switching a slot's palette,
// and an OS appearance flip under `system`. Boot is the one exception — there is
// no previous frame to wipe from — so main.ts paints directly instead.

/** A page whose View Transitions support we probe without hard-typing the API
 * (it isn't in every TS DOM lib). */
type MaybeViewTransitions = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

export interface ThemeWipeDeps {
  /** Runs the update inside a wipe when supported; undefined means unsupported. */
  startViewTransition?: (update: () => void) => unknown;
  /** True when the user prefers reduced motion — run instantly, no wipe. */
  prefersReducedMotion: () => boolean;
}

function defaultWipeDeps(): ThemeWipeDeps {
  const doc = typeof document !== "undefined" ? (document as MaybeViewTransitions) : undefined;
  const start = doc?.startViewTransition;
  return {
    startViewTransition: typeof start === "function" ? start.bind(doc) : undefined,
    prefersReducedMotion: () =>
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

/** Run a DOM update as a whole-UI wipe when the browser supports the View
 * Transitions API and motion is allowed; otherwise run it instantly. The update
 * runs exactly once either way. */
export function withWipe(update: () => void, deps: ThemeWipeDeps = defaultWipeDeps()): void {
  if (!deps.startViewTransition || deps.prefersReducedMotion()) {
    update();
    return;
  }
  deps.startViewTransition(update);
}
