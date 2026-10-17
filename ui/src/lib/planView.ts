// The plan view's surfaces and where each source-view behavior runs: the reader's
// remembered source/preview choice, and SURFACE_BEHAVIORS, the one declaration of which
// surfaces each behavior runs on.
//
// The choice is a pure display pref with no security surface, so it lives in localStorage;
// definePref registers the key for the `--fresh` reset and degrades a blocked store.

import { definePref } from "$lib/definePref.ts";

/** Which view of a single plan version the reader reads. */
export type PlanView = "source" | "preview";
/** What the plan pane shows: the reader's view, or "compare", which overrides it while comparing. */
export type PlanSurface = PlanView | "compare";

/** localStorage key holding the remembered plan view. */
export const PLAN_VIEW_KEY = "caret.planView";

const pref = definePref<PlanView>(PLAN_VIEW_KEY, ["source", "preview"], "source");

/** Read the remembered view, defaulting to "source" on a missing, unrecognized, or
 * unreadable value. */
export const readPlanView = pref.read;

/** Persist the chosen view; a storage failure is swallowed. */
export const writePlanView = pref.write;

/** The surfaces each source-view behavior runs on — the only place that is declared.
 * Running a behavior on another surface means adding the surface to its row; see
 * doc/agents/plan-render-rules.md § Surfaces for what that does and does not switch on. */
export const SURFACE_BEHAVIORS = {
  codeChrome: ["source", "preview"], // copy / soft-wrap chrome over fenced code
  referenceHints: ["source"], // ref-hint badges
  fileReferences: ["source", "preview"], // the file lane and folder card a reference opens
  search: ["source", "preview"], // `/` dock, n/N, match highlights, Esc's close
  keyboardCursor: ["source", "preview"], // cursor motions
  keyboardComments: ["source"], // c, V, Esc's visual exit
  commentThreads: ["source", "preview"], // inline threads, draft markers, the open composer, the preview's comment highlight, comment reveal
  lineComments: ["source"], // drag readout, gutter range drag, drag/visual hint chips, hover re-fire
  textComments: ["source", "preview"], // a click or text selection on the plan opens the composer
  headingTracking: ["source", "preview"], // top-visible heading, ?heading= mirror, ToC, breadcrumbs, b and \
} as const satisfies Record<string, readonly PlanSurface[]>;

export type SurfaceBehavior = keyof typeof SURFACE_BEHAVIORS;

/** Whether `behavior` is declared to run on `surface`. */
export function runsOn(behavior: SurfaceBehavior, surface: PlanSurface): boolean {
  const surfaces: readonly PlanSurface[] = SURFACE_BEHAVIORS[behavior];
  return surfaces.includes(surface);
}
