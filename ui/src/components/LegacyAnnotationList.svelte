<script lang="ts">
  // Legacy annotations predate line anchoring: they carry a quoted passage rather
  // than a {startLine, endLine}, so they cannot be placed on a source line and are
  // listed at the plan's foot instead. Per the union compat contract they always load
  // and render, but never expose edit or delete.
  //
  // Each one floats on a saved comment's card, its quote stamped into the card where a
  // saved card shows its line. The count stays neutral (no attention tint): this tally
  // reports a static fact.
  import type { LegacyAnnotation } from "@core/lib/types";

  interface Props {
    annotations: LegacyAnnotation[];
  }
  let { annotations }: Props = $props();
</script>

{#if annotations.length > 0}
  <section class="legacy-list" aria-label="Unanchored comments">
    <header class="head">
      <h2 class="title">Unanchored comments</h2>
      <span class="count metric stamp">{annotations.length}</span>
    </header>
    <p class="note">These comments predate line anchoring and are shown read-only.</p>
    {#each annotations as a (a.id)}
      <article class="item">
        <blockquote class="quote">{a.quote}</blockquote>
        <p class="comment">{a.comment}</p>
      </article>
    {/each}
  </section>
{/if}

<style>
  .legacy-list {
    margin-top: 1.5rem;
    padding: 0 1.25rem 1.25rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink-soft);
  }
  .count {
    padding: 0 0.4rem;
    border-radius: 99px;
    font-size: var(--text-2xs);
    font-weight: 600;
  }
  /* --ink-soft, not --ink-faint, which misses 4.5:1 on paper in some palettes. */
  .note {
    margin: 0 0 0.75rem;
    font-size: var(--text-sm);
    color: var(--ink-soft);
    line-height: var(--leading-snug);
  }
  /* A saved comment's card (SourceAnnotationCard). */
  .item {
    max-width: min(46rem, 100%);
    margin-bottom: 0.55rem;
    padding: 0.5rem 0.75rem 0.6rem;
    border-radius: var(--radius-lg);
    background: var(--paper-raised);
    box-shadow: var(--float-surface-low);
  }
  /* Stamped into the card as a stamp's pocket is, on --mark-orphan: the plan-search hit's
     mark drained of hue, a marked passage whose anchor is gone. */
  .quote {
    margin: 0 0 0.4rem;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius);
    background: var(--mark-orphan);
    box-shadow: var(--well-shade), var(--well-lip);
    font-size: var(--text-sm);
    line-height: var(--leading-tight);
    color: var(--ink-soft);
  }
  .comment {
    margin: 0;
    font-size: var(--text-md);
    color: var(--ink);
    white-space: pre-wrap;
  }
</style>
