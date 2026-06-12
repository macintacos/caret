<script lang="ts">
  // Source-view plan surface: renders the active plan version's stored text as
  // line-numbered markdown source through the diffview SourceView wrapper, with
  // a line gutter for creating comments. Hovering a line shows the built-in `+`;
  // clicking it opens an inline composer at the selected line or range, and
  // submitting creates a line-anchored {startLine, endLine} annotation in the
  // autosave working copy. The composer is positioned at the chosen line's
  // offset (the wrapper's File is container-managed, which disables the library's
  // renderAnnotation, so the composer is rendered here rather than slotted by the
  // library). The wrapper owns the @pierre/diffs lifecycle and preserves the view
  // instance across re-renders when the contentKey is unchanged, so scroll
  // survives the 2s poll re-delivering the same version.
  import SourceView from "../lib/diffview/SourceView.svelte";
  import { createSourceCommenting } from "../lib/diffview/commenting.ts";
  import { buildLinkLayer } from "../lib/diffview/links.ts";
  import type { SourceViewGutter } from "../lib/diffview/options.ts";
  import type { ClientReview } from "@core/types";
  import SourceComposer from "./SourceComposer.svelte";

  interface Props {
    /** The review whose current plan version is rendered. */
    review: ClientReview;
    /** Persist a gutter-created line-anchored annotation. */
    onCreateLineAnnotation: (anchor: {
      startLine: number;
      endLine: number;
      comment: string;
    }) => void;
  }

  let { review, onCreateLineAnnotation }: Props = $props();

  // Identity of the rendered content: the wrapper recreates its instance only
  // when this changes, so a poll tick that re-delivers the same version updates
  // in place (scroll preserved) while a new version recreates the view.
  const contentKey = $derived(`${review.id}:${review.version}`);

  // The opt-in link layer: simplified display text plus per-line clickable spans,
  // with line parity preserved (so line numbers match the stored plan). Memoized
  // on the plan text so an unchanged poll tick yields the SAME layer reference —
  // SourceView change-detects its options by reference, so a fresh object each
  // tick would trigger a redundant setOptions + repaint.
  let memo: { text: string; layer: ReturnType<typeof buildLinkLayer> } | undefined;
  const linkLayer = $derived.by(() => {
    if (memo?.text !== review.currentPlan) {
      memo = { text: review.currentPlan, layer: buildLinkLayer(review.currentPlan) };
    }
    return memo.layer;
  });

  let container = $state<HTMLElement | undefined>();

  // Reactive mirror of the controller's pending target, so the composer renders
  // and re-positions when it opens or closes. The controller owns the state
  // machine; this is the view's read of it.
  let pending = $state<{ startLine: number; endLine: number } | undefined>();
  // Vertical offset (px) of the pending line within the scroll container, where
  // the composer anchors.
  let composerTop = $state(0);

  const commenting = createSourceCommenting({
    onCreate: (anchor) => onCreateLineAnnotation(anchor),
    onChange: () => {
      pending = commenting.pending();
    },
  });

  // Discard an open composer when the rendered content changes (a new version
  // arrives, or the review switches): its line anchor belongs to the prior text,
  // so submitting it onto the new version would mis-anchor. contentKey is the
  // reactive trigger.
  $effect(() => {
    void contentKey;
    commenting.cancel();
  });

  // Offset of `lineNumber` (1-based) within the scroll container: the line row's
  // top relative to the container, plus the current scroll. Falls back to 0 when
  // the row isn't found (e.g. virtualized out), keeping the composer in view.
  function lineOffset(lineNumber: number): number {
    const shadow = container?.querySelector(".diffview")?.shadowRoot;
    const row = shadow?.querySelector(`[data-line-index="${lineNumber - 1}"]`);
    if (row == null || container == null) return container?.scrollTop ?? 0;
    const rowRect = row.getBoundingClientRect();
    const hostRect = container.getBoundingClientRect();
    return rowRect.top - hostRect.top + container.scrollTop;
  }

  const gutter: SourceViewGutter = {
    enableGutterUtility: true,
    onGutterUtilityClick: (range) => {
      composerTop = lineOffset(Math.min(range.start, range.end));
      commenting.open({ start: range.start, end: range.end });
    },
    // Container-managed mode disables library annotation rendering; the option is
    // required by the bag's shape, so it returns nothing here.
    renderAnnotation: () => undefined,
  };
</script>

<div class="diff-plan" bind:this={container}>
  <SourceView
    doc={{ name: "plan.md", text: linkLayer.text }}
    links={linkLayer.spans}
    {gutter}
    {contentKey}
  />
  {#if pending}
    <SourceComposer
      startLine={pending.startLine}
      endLine={pending.endLine}
      top={composerTop}
      onSubmit={(comment) => commenting.submit(comment)}
      onCancel={() => commenting.cancel()}
    />
  {/if}
</div>

<style>
  /* Fills the content row and scrolls on its own; the SourceView container
     virtualizes its own lines inside. position: relative anchors the absolutely
     positioned composer to this scroll container. */
  .diff-plan {
    position: relative;
    min-height: 0;
    overflow: auto;
    background: var(--paper);
  }
</style>
