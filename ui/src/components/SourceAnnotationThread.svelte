<script lang="ts">
  // The comments anchored to one source line, framed as a single caret-owned
  // thread. @pierre/diffs reserves exactly one annotation row per line, so when
  // several comments share a line they belong together in that one row — this
  // component is the shared container that makes them read as one ordered
  // conversation instead of disconnected chips. A lone comment needs no chrome:
  // it renders as a bare card. Two or more render inside a labelled container
  // with a comment count and a per-card order cue, in thread order. Card behavior
  // (collapse, edit, delete) stays in SourceAnnotationCard; this owns the framing
  // and passes focus/edit/delete straight through.
  import type { LineAnnotation } from "@core/types";
  import SourceAnnotationCard from "./SourceAnnotationCard.svelte";

  interface Props {
    /** The comments on this line, in thread (display) order. */
    annotations: LineAnnotation[];
    /** The single focused annotation id across the whole surface, or null. */
    focusedAnnotation: string | null;
    onFocus: (id: string) => void;
    onEdit: (id: string, comment: string) => void;
    onDelete: (id: string) => void;
  }
  let { annotations, focusedAnnotation, onFocus, onEdit, onDelete }: Props = $props();

  const threaded = $derived(annotations.length > 1);
</script>

{#if threaded}
  <section class="thread" aria-label="Comment thread">
    <header class="thread-head">
      <span class="thread-count metric">{annotations.length} comments</span>
    </header>
    {#each annotations as a, i (a.id)}
      <div class="thread-item">
        <span class="thread-ordinal metric" aria-hidden="true">{i + 1}</span>
        <SourceAnnotationCard
          annotation={a}
          focused={a.id === focusedAnnotation}
          {onFocus}
          {onEdit}
          {onDelete}
        />
      </div>
    {/each}
  </section>
{:else if annotations[0]}
  <SourceAnnotationCard
    annotation={annotations[0]}
    focused={annotations[0].id === focusedAnnotation}
    {onFocus}
    {onEdit}
    {onDelete}
  />
{/if}

<style>
  /* The thread container: quiet paper-raised chrome that binds the line's comments
     into one block. It is structural framing, not the amber action affordance —
     the focused card keeps its own amber left-border, so the thread stays neutral
     and amber stays scarce. */
  .thread {
    max-width: min(46rem, 100%);
    margin: 0.4rem 0 0.55rem;
    padding: 0.35rem 0.45rem 0.45rem;
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
  }
  .thread-head {
    display: flex;
    align-items: baseline;
    padding: 0.1rem 0.15rem 0.35rem;
  }
  /* The comment count: an eyebrow-quiet tally, tabular via .metric so it doesn't
     reflow as the thread grows. */
  .thread-count {
    font-size: var(--text-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  /* Each entry pairs an order cue with its card. The cards sit flush; the inner
     card's own vertical margin gives them air, so the ordinal aligns to the
     card's top. */
  .thread-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }
  /* The order cue: a small numeric prefix tying each comment to its place in the
     conversation. Faint and tabular so it reads as chrome, not content; the
     top offset lines it up with the card body's first line. */
  .thread-ordinal {
    flex: none;
    margin-top: 0.7rem;
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    user-select: none;
  }
  /* The card inside a thread takes the remaining width; its own max-width cap is
     redundant under the thread's, so let it fill the row. */
  .thread-item :global(.card) {
    flex: 1 1 auto;
    min-width: 0;
    max-width: none;
  }
</style>
