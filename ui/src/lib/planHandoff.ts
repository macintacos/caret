// Handing the window back to the waiting room as a crossfade (EXC-1400). Resolving
// the last pending plan swaps everything at once — the plan view for the empty state,
// the TopBar's whole action cluster for nothing — so the View Transitions API runs the
// swap: the browser snapshots the old window, applies the update, and crossfades to the
// new one, which carries every piece in one gesture rather than four hand-animated ones.
//
// The crossfade geometry is CSS (::view-transition-* in styles/base.css); this module
// only decides whether to wrap the swap in a transition, and tags the document root so
// the stylesheet can tell this transition from the theme wipe's directional sweep —
// which is reserved, because there it means "everything was restyled". A CLASS rather
// than startViewTransition({ update, types }): the object call form throws a TypeError
// on Chrome 111-124, while the class works on every engine that has the API at all.

/** A page whose View Transitions support we probe without hard-typing the API
 * (it isn't in every TS DOM lib). */
type MaybeViewTransitions = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

/** The class the stylesheet's crossfade arms are scoped under. */
const HANDOFF_CLASS = "plan-handoff";

export interface PlanHandoffDeps {
  /** Runs the update inside a crossfade when supported; undefined means unsupported. */
  startViewTransition?: (update: () => void) => unknown;
  /** True when the user prefers reduced motion — run instantly, no crossfade. */
  prefersReducedMotion: () => boolean;
  /** Tag the document for the transition's lifetime so CSS can pick this animation. */
  tag: (on: boolean) => void;
}

/** True when this document can run a view transition at all — also the curtain's gate,
 * since App's `.arrival` keeps covering the hand-off wherever the crossfade cannot. */
export function supportsViewTransition(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof (document as MaybeViewTransitions).startViewTransition === "function"
  );
}

function defaultHandoffDeps(): PlanHandoffDeps {
  const doc = typeof document !== "undefined" ? (document as MaybeViewTransitions) : undefined;
  const start = doc?.startViewTransition;
  return {
    startViewTransition: typeof start === "function" ? start.bind(doc) : undefined,
    prefersReducedMotion: () =>
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
    tag: (on) => document.documentElement.classList.toggle(HANDOFF_CLASS, on),
  };
}

/** Run a DOM update as a whole-window crossfade when the browser supports the View
 * Transitions API and motion is allowed; otherwise run it instantly. The update runs
 * exactly once either way. */
export function withPlanHandoff(
  update: () => void,
  deps: PlanHandoffDeps = defaultHandoffDeps(),
): void {
  if (!deps.startViewTransition || deps.prefersReducedMotion()) {
    update();
    return;
  }
  deps.tag(true);
  const transition = deps.startViewTransition(update) as { finished?: Promise<unknown> };
  // Settled either way: a transition the browser skips REJECTS `finished`, and a
  // stranded class would restyle the next theme wipe.
  const untag = () => deps.tag(false);
  Promise.resolve(transition?.finished).then(untag, untag);
}
