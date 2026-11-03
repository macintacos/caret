// Compare's move: entering or leaving compare swaps the plan and its header's controls and
// folds or stands the outline column, as one view transition, so every region shares one
// clock and the plan's content crossfades as it moves.
//
// The geometry is CSS: each component names its moving parts under the root's
// `data-pane-move` tag, and styles/base.css times them. This module decides whether to run
// the change as a transition and tags the root for its lifetime with which way the column
// goes, since a pane entering takes longer than one leaving.

import { type ViewTransitionDeps, viewTransitionDeps } from "$lib/viewTransition.ts";

/** Which way the outline column goes. */
export type ColumnMove = "enter" | "exit";

export interface PaneMoveDeps extends ViewTransitionDeps {
  /** Tag the root with which way the column goes, or clear the tag with null. */
  tag: (column: ColumnMove | null) => void;
  /** Start the running transition's animations over on the next frame. */
  restart: () => void;
}

function defaultDeps(): PaneMoveDeps {
  return {
    ...viewTransitionDeps(),
    tag: (column) => {
      const root = document.documentElement;
      if (column === null) delete root.dataset.paneMove;
      else root.dataset.paneMove = column;
    },
    restart: () =>
      requestAnimationFrame(() => {
        for (const animation of document.getAnimations()) {
          const effect = animation.effect;
          if (
            effect instanceof KeyframeEffect &&
            effect.pseudoElement?.startsWith("::view-transition")
          ) {
            animation.currentTime = 0;
          }
        }
      }),
  };
}

/** Runs compare's change, as a transition where the browser has the API and motion is
 * allowed, and instantly otherwise. */
export type MovePanes = (column: ColumnMove, update: () => void) => void;

/** A mover for one window. A move started mid-transition skips the running one, as the
 * API does, and keeps its own tag. */
export function createPaneMove(deps: PaneMoveDeps = defaultDeps()): MovePanes {
  let current: object | null = null;
  return (column, update) => {
    const start = deps.startViewTransition;
    if (!start || deps.prefersReducedMotion()) {
      update();
      return;
    }
    const token = {};
    current = token;
    deps.tag(column);
    const transition = start(update);
    // The new layout's first paint, the plan re-laid at its new width, is the long frame,
    // and it lands after the transition is ready, on the animations' clock. Started over on
    // the frame after it, the motion plays whole.
    transition?.ready?.then(deps.restart, () => {});
    // A skipped transition rejects `finished`; the tag clears either way, unless a later
    // move has taken it over.
    const untag = () => {
      if (current !== token) return;
      current = null;
      deps.tag(null);
    };
    Promise.resolve(transition?.finished).then(untag, untag);
  };
}
