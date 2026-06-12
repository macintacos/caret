<script lang="ts">
  // Source-view plan surface: renders the active plan version's stored text as
  // line-numbered markdown source through the diffview SourceView wrapper, with
  // a line gutter for creating comments. Hovering a line shows the built-in `+`;
  // clicking it opens an inline composer at the selected line or range, and
  // submitting creates a line-anchored {startLine, endLine} annotation in the
  // autosave working copy. The wrapper owns the @pierre/diffs lifecycle and
  // preserves the view instance across re-renders when the contentKey is
  // unchanged, so scroll survives the 2s poll re-delivering the same version.
  import SourceView from "../lib/diffview/SourceView.svelte";
  import { createSourceCommenting } from "../lib/diffview/commenting.ts";
  import { buildLinkLayer } from "../lib/diffview/links.ts";
  import type { SourceViewGutter } from "../lib/diffview/options.ts";
  import type { SourceLineAnnotation } from "../lib/diffview/types.ts";
  import { type Annotation, type ClientReview, isLineAnnotation } from "@core/types";

  interface Props {
    /** The review whose current plan version is rendered. */
    review: ClientReview;
    /** The active version's working-copy annotations. */
    annotations: Annotation[];
    /** Persist a gutter-created line-anchored annotation. */
    onCreateLineAnnotation: (anchor: {
      startLine: number;
      endLine: number;
      comment: string;
    }) => void;
  }

  let { review, annotations, onCreateLineAnnotation }: Props = $props();

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

  // Bump on every composer open/close so the annotation list and gutter bag
  // re-derive (the controller's pending line drives which line shows the
  // composer). A plain counter is the reactive trigger for the controller's
  // otherwise-imperative state.
  let composerTick = $state(0);
  const commenting = createSourceCommenting({
    // Read the prop live so a reassignment is honored; the controller is created
    // once but defers the create to whatever handler is current at submit.
    onCreate: (anchor) => onCreateLineAnnotation(anchor),
    onChange: () => composerTick++,
  });

  // The line-anchored annotations on the active version, mapped to the library's
  // per-line shape (legacy selection-anchored annotations have no line and are
  // skipped — they surface in the unanchored bucket elsewhere).
  const lineAnnotations = $derived(
    annotations.filter(isLineAnnotation).map((a) => ({ lineNumber: a.startLine })),
  );

  // The list fed to the view: real line annotations plus, while the composer is
  // open, a synthetic pending entry at its anchor line so renderAnnotation slots
  // the composer inline. Re-derives on composerTick.
  const viewAnnotations = $derived.by<SourceLineAnnotation[]>(() => {
    void composerTick;
    const pending = commenting.pendingLine();
    const list = [...lineAnnotations];
    if (pending != null && !list.some((a) => a.lineNumber === pending)) {
      list.push({ lineNumber: pending });
    }
    return list;
  });

  // renderAnnotation: the composer for the pending line, else a minimal card
  // showing the created comment (collapsible cards land on a later milestone).
  function renderAnnotation(annotation: SourceLineAnnotation): HTMLElement | undefined {
    void composerTick;
    const composer = commenting.renderComposer(annotation.lineNumber);
    if (composer != null) return composer;
    const card = document.createElement("div");
    card.className = "diff-plan-card";
    card.dataset.line = String(annotation.lineNumber);
    const existing = annotations.find(
      (a) => isLineAnnotation(a) && a.startLine === annotation.lineNumber,
    );
    card.textContent = existing?.comment ?? "";
    return card;
  }

  // Stable for the component's life: both callbacks read live controller state,
  // so the bag never needs to change identity. A stable reference keeps the
  // lifecycle from re-running setOptions on each composer toggle — the composer
  // appears/disappears via the re-derived annotation list (setLineAnnotations).
  const gutter: SourceViewGutter = {
    enableGutterUtility: true,
    onGutterUtilityClick: (range) => commenting.open({ start: range.start, end: range.end }),
    renderAnnotation,
  };
</script>

<div class="diff-plan">
  <SourceView
    doc={{ name: "plan.md", text: linkLayer.text }}
    links={linkLayer.spans}
    annotations={viewAnnotations}
    {gutter}
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
