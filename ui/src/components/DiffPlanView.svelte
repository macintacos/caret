<script lang="ts">
  // Source-view plan surface: renders the active plan version's stored text as
  // line-numbered markdown source through the diffview SourceView wrapper. A
  // read-only surface — no gutter affordances, no annotations, no contents rail.
  // The wrapper owns the @pierre/diffs lifecycle and preserves the view instance
  // across re-renders when the contentKey is unchanged, so scroll survives the
  // 2s poll re-delivering the same version.
  import SourceView from "../lib/diffview/SourceView.svelte";
  import { buildLinkLayer } from "../lib/diffview/links.ts";
  import type { ClientReview } from "@core/types";

  interface Props {
    /** The review whose current plan version is rendered. */
    review: ClientReview;
  }

  let { review }: Props = $props();

  // Identity of the rendered content: the wrapper recreates its instance only
  // when this changes, so a poll tick that re-delivers the same version updates
  // in place (scroll preserved) while a new version recreates the view.
  const contentKey = $derived(`${review.id}:${review.version}`);

  // The opt-in link layer: simplified display text plus per-line clickable spans,
  // with line parity preserved (so future line numbers match the stored plan).
  // Memoized on the plan text so an unchanged poll tick yields the SAME layer
  // reference — SourceView change-detects its options by reference, so a fresh
  // object each tick would trigger a redundant setOptions + repaint.
  let memo: { text: string; layer: ReturnType<typeof buildLinkLayer> } | undefined;
  const linkLayer = $derived.by(() => {
    if (memo?.text !== review.currentPlan) {
      memo = { text: review.currentPlan, layer: buildLinkLayer(review.currentPlan) };
    }
    return memo.layer;
  });
</script>

<div class="diff-plan">
  <SourceView
    doc={{ name: "plan.md", text: linkLayer.text }}
    links={linkLayer.spans}
    {contentKey}
  />
</div>

<style>
  /* Fills the content row and scrolls on its own; the SourceView container
     virtualizes its own lines inside. */
  .diff-plan {
    min-height: 0;
    overflow: auto;
    background: var(--paper);
  }
</style>
