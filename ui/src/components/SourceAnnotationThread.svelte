<script lang="ts">
  // The comments anchored to one source line, framed as a single caret-owned
  // thread. @pierre/diffs reserves exactly one annotation row per line, so several
  // comments sharing a line must read as one ordered conversation rather than
  // disconnected chips. A lone comment needs no chrome and renders as a bare card.
  // Card behavior (collapse, edit, delete) stays in SourceAnnotationCard; this owns
  // the framing only (EXC-765).
  import type { LineAnnotation } from "@core/lib/types";
  import { Card } from "$lib/components/ui/card/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import type { ReviewContext } from "$lib/editorCompletion.ts";
  import SourceAnnotationCard from "@/components/SourceAnnotationCard.svelte";

  interface Props {
    /** The comments on this line, in thread (display) order. */
    annotations: LineAnnotation[];
    /** The single focused annotation id across the whole surface, or null. */
    focusedAnnotation: string | null;
    onFocus: (id: string) => void;
    onEdit: (id: string, comment: string) => void;
    onDelete: (id: string) => void;
    /** The review being commented on, forwarded to each card's edit composer. */
    reviewContext?: ReviewContext;
  }
  let {
    annotations,
    focusedAnnotation,
    onFocus,
    onEdit,
    onDelete,
    reviewContext,
  }: Props = $props();

  const threaded = $derived(annotations.length > 1);
</script>

{#if threaded}
  <Card class="thread" role="group" aria-label="Comment thread">
    <header class="thread-head">
      <span class="thread-count metric">{annotations.length} comments</span>
    </header>
    {#each annotations as a, i (a.id)}
      {#if i > 0}
        <Separator decorative class="thread-rule" />
      {/if}
      <div class="thread-item">
        <span class="thread-ordinal metric" aria-hidden="true">{i + 1}</span>
        <SourceAnnotationCard
          annotation={a}
          focused={a.id === focusedAnnotation}
          {onFocus}
          {onEdit}
          {onDelete}
          {reviewContext}
        />
      </div>
    {/each}
  </Card>
{:else if annotations[0]}
  <!-- A card seeds its editor once at mount, and the row this renders into is keyed
       on the LINE number (DiffPlanView). Without this key, a review switch landing a
       different comment on the same line reuses the card instance: an open edit field
       keeps the old text while onEdit saves under the new comment's id. -->
  {#key annotations[0].id}
    <SourceAnnotationCard
      annotation={annotations[0]}
      focused={annotations[0].id === focusedAnnotation}
      {onFocus}
      {onEdit}
      {onDelete}
      {reviewContext}
    />
  {/key}
{/if}

<style>
  /* Structural framing, not an action affordance: the focused card owns the amber
     left-border, so the thread stays neutral and amber stays scarce. The compound
     [data-slot] selector (0,2,0) outranks the copied Card's utility classes. */
  :global([data-slot="card"].thread) {
    display: block;
    max-width: min(46rem, 100%);
    margin: 0.4rem 0 0.55rem;
    padding: 0.35rem 0.45rem 0.45rem;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    box-shadow: none;
  }
  .thread-head {
    display: flex;
    align-items: baseline;
    padding: 0.1rem 0.15rem 0.35rem;
  }
  /* Tabular via .metric so the tally doesn't reflow as the thread grows. */
  .thread-count {
    font-size: var(--text-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  /* Inset so it divides within the thread rather than reading as a full-bleed cut. */
  :global(.thread-rule) {
    margin: 0.15rem 0;
  }
  .thread-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }
  /* The order cue. The top offset lines it up with the card body's first line. */
  .thread-ordinal {
    flex: none;
    margin-top: 0.7rem;
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    user-select: none;
  }
  /* The card's own max-width cap is redundant under the thread's — fill the row. */
  .thread-item :global(.card) {
    flex: 1 1 auto;
    min-width: 0;
    max-width: none;
  }
</style>
