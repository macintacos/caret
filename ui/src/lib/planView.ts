// Which view of a single plan version the reviewer reads — the line-numbered source or
// the rendered preview — persisted in localStorage.
//
// A pure browser display preference with no security surface, so it lives in
// localStorage like diffStylePref.ts rather than the daemon's prefs. definePref
// registers the key for the `--fresh` reset and degrades a blocked store to the default.

import { definePref } from "$lib/definePref.ts";
import type { RenderedPlan } from "$lib/planMarkdown.ts";

export type PlanView = "source" | "preview";
export type PlanSurface = PlanView | "compare";

/** localStorage key holding the remembered plan view. */
export const PLAN_VIEW_KEY = "caret.planView";

const pref = definePref<PlanView>(PLAN_VIEW_KEY, ["source", "preview"], "source");

/** Read the remembered view, defaulting to "source" on a missing, unrecognized, or
 * unreadable value. */
export const readPlanView = pref.read;

/** Persist the chosen view; a storage failure is swallowed. */
export const writePlanView = pref.write;

/** The surfaces each source-view behavior runs on. A sibling issue that ports a
 * behavior to the preview adds "preview" to its row — the one place to do so. */
export const SURFACE_BEHAVIORS = {
  codeChrome: ["source"], // copy / soft-wrap chrome over fenced code
  referenceHints: ["source"], // ref-hint badges, file drawer, folder card
  search: ["source"], // `/` dock, n/N, match highlights
  keyboardCursor: ["source"], // cursor motions, `c`, `V`, Esc
  lineComments: ["source"], // drag readout, gutter range drag, drag/visual hint chips, hover re-fire, comment reveal
  headingTracking: ["source"], // top-visible heading, ?heading= mirror, ToC, breadcrumbs, b and \
} as const satisfies Record<string, readonly PlanSurface[]>;

export type SurfaceBehavior = keyof typeof SURFACE_BEHAVIORS;

export function runsOn(behavior: SurfaceBehavior, surface: PlanSurface): boolean {
  return (SURFACE_BEHAVIORS[behavior] as readonly PlanSurface[]).includes(surface);
}

/** Wrap `render` so the same text returns the last result (same reference) without
 * re-rendering — a same-version poll tick must not churn the mounted HTML. */
export function previewRenderer(
  render: (text: string) => RenderedPlan,
): (text: string) => RenderedPlan {
  let last: { text: string; plan: RenderedPlan } | undefined;
  return (text) => {
    if (last?.text !== text) last = { text, plan: render(text) };
    return last.plan;
  };
}
