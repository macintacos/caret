// Render memoization for the active plan.
//
// The 2s poll replaces `reviews` with fresh objects every tick, so a naive
// derive would re-parse the (unchanged) markdown — and needlessly churn the
// syntax-highlight repaint — on every poll. Keying the cache on id:version
// renders once per plan version: a revision (new version) re-parses, a poll of
// the same version returns the cached result.

import { renderPlan } from "../lib/render.ts";
import type { HeadingEntry } from "../lib/render.ts";
import type { ClientReview } from "@core/types";

export interface RenderedPlan {
  html: string;
  headings: HeadingEntry[];
}

const EMPTY: RenderedPlan = { html: "", headings: [] };

export interface RenderMemo {
  /** Render the active review's plan, reusing the cached result when its
   * id:version is unchanged. Returns an empty result when nothing is active. */
  render: (active: ClientReview | null) => RenderedPlan;
}

export function createRenderMemo(): RenderMemo {
  let cache: { key: string; value: RenderedPlan } | null = null;
  return {
    render(active) {
      if (!active) return EMPTY;
      const key = `${active.id}:${active.version}`;
      if (cache?.key === key) return cache.value;
      const value = renderPlan(active.currentPlan);
      cache = { key, value };
      return value;
    },
  };
}
