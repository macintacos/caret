// Every plan swap as one crossfade (EXC-1400): a plan arriving, the next one after a
// decision, a switch, the queue draining. Each swaps everything at once — the plan view,
// the TopBar's action cluster — so one view transition carries every piece in one gesture.
// And each one's render is synchronous and long: the transition holds a still of the old
// window while it runs and starts the crossfade only once the new one has painted, where an
// animation started beside the update spends its duration before the first frame lands.
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

/** How long a swap waits on motion already playing, at most: above every one-shot tier, so
 * the wait is a courtesy and never a gate an animation that misjudged its end can hold shut. */
const SETTLE_LIMIT_MS = 500;

export interface PlanHandoffDeps extends ViewTransitionDeps {
  /** Tag the document for the transition's lifetime so CSS can pick this animation. */
  tag: (on: boolean) => void;
  /** Resolves once the one-shot motion already running has finished. */
  settled: () => Promise<unknown>;
}

function defaultHandoffDeps(): PlanHandoffDeps {
  return {
    ...viewTransitionDeps(),
    tag: (on) => document.documentElement.classList.toggle(HANDOFF_CLASS, on),
    settled: () =>
      Promise.race([
        Promise.allSettled(
          document
            .getAnimations()
            .filter(isOneShot)
            .map((animation) => animation.finished),
        ),
        new Promise((resolve) => setTimeout(resolve, SETTLE_LIMIT_MS)),
      ]),
  };
}

/** A running animation that ends on its own clock: not an ambient loop, which never ends,
 * nor a scroll-driven one — the preview's pinned table headers — which ends only on scroll. */
function isOneShot(animation: Animation): boolean {
  const end = animation.effect?.getComputedTiming().endTime;
  return (
    animation.playState === "running" &&
    animation.timeline === document.timeline &&
    typeof end === "number" &&
    Number.isFinite(end)
  );
}

/** Runs a plan swap, resolving once its update has run. */
export type PlanHandoff = (update: () => void) => Promise<void>;

/** A hand-off that runs each swap as a whole-window crossfade when the browser supports the
 * View Transitions API and motion is allowed, and instantly otherwise. Every update runs
 * exactly once. One per window: it serializes the transitions it starts. */
export function createPlanHandoff(deps: PlanHandoffDeps = defaultHandoffDeps()): PlanHandoff {
  // Swaps asked for before the transition takes its still, which all run in its one update.
  // A second transition would skip the first and cut that update in with no crossfade.
  let gathering: { updates: (() => void)[]; ran: Promise<void> } | null = null;
  // The last transition, untag included, which a later one waits out: started any sooner it
  // would skip this one, and this untag landing after the next tag would strip its class.
  let previous: Promise<unknown> = Promise.resolve();

  async function crossfade(
    start: NonNullable<PlanHandoffDeps["startViewTransition"]>,
    updates: (() => void)[],
  ): Promise<void> {
    // The transition freezes the window on a still while the update renders, and the motion
    // in flight — a decided guard leaving, its confirmation sliding in — is the answer to the
    // reader's click. Frozen mid-gesture it reads as the click not landing, so it ends first.
    await Promise.all([previous, deps.settled()]);
    gathering = null;
    deps.tag(true);
    return new Promise<void>((ran) => {
      const transition = start(() => {
        try {
          for (const update of updates) update();
        } finally {
          ran();
        }
      });
      // Untag on rejection too: a skipped transition REJECTS `finished`, and a stranded class
      // would restyle the next theme wipe.
      const untag = () => deps.tag(false);
      previous = Promise.resolve(transition?.finished).then(untag, untag);
    });
  }

  return (update) => {
    const start = deps.startViewTransition;
    if (!start || deps.prefersReducedMotion()) {
      update();
      return Promise.resolve();
    }
    if (gathering) {
      gathering.updates.push(update);
      return gathering.ran;
    }
    const updates = [update];
    const ran = crossfade(start, updates);
    gathering = { updates, ran };
    return ran;
  };
}
