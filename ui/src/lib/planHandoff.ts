// Handing the window back to the waiting room as a crossfade (EXC-1400). Emptying the
// queue swaps everything at once — the plan view for the empty state, the TopBar's whole
// action cluster for nothing — so one view transition carries every piece in one gesture.
//
// The crossfade geometry is CSS (::view-transition-* in styles/base.css); this module
// only decides whether to wrap the swap in a transition, and tags the document root so
// the stylesheet can tell it from the theme wipe's directional sweep, which is reserved
// because there it means "everything was restyled". A CLASS rather than
// startViewTransition({ update, types }): the object form throws a TypeError on Chrome
// 111-124, while the class works wherever the API exists.

import { type ViewTransitionDeps, viewTransitionDeps } from "$lib/viewTransition.ts";

/** The class the stylesheet's crossfade arms are scoped under. */
const HANDOFF_CLASS = "plan-handoff";

export interface PlanHandoffDeps extends ViewTransitionDeps {
  /** Tag the document for the transition's lifetime so CSS can pick this animation. */
  tag: (on: boolean) => void;
}

function defaultHandoffDeps(): PlanHandoffDeps {
  return {
    ...viewTransitionDeps(),
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
  const transition = deps.startViewTransition(update);
  // Untag on rejection too: a skipped transition REJECTS `finished`, and a stranded class
  // would restyle the next theme wipe. The tag is a boolean, not a count, so an overlapping
  // hand-off loses it to the first's untag — harmless, that swap has nothing left to animate.
  const untag = () => deps.tag(false);
  Promise.resolve(transition?.finished).then(untag, untag);
}
