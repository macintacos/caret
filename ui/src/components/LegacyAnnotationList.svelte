<script lang="ts">
  // Legacy annotations predate line anchoring: they carry a quoted passage rather
  // than a {startLine, endLine}, so they cannot be placed on a source line and are
  // listed below the view instead. Per the union compat contract they always load
  // and render, but never expose edit or delete.
  //
  // A plain full-bleed footer section, not a Card, whose contained rounded frame
  // would fight the below-the-view framing. The count badge stays neutral (no
  // .count-attention): this tally reports a static fact.
  import type { LegacyAnnotation } from "@core/lib/types";
  import { Badge } from "$lib/components/ui/badge/index.js";

  interface Props {
    annotations: LegacyAnnotation[];
  }
  let { annotations }: Props = $props();
</script>

{#if annotations.length > 0}
  <section class="legacy-list" aria-label="Unanchored comments">
    <header class="head">
      <span class="eyebrow">Unanchored comments</span>
      <Badge variant="outline" class="count">{annotations.length}</Badge>
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
    border-top: 1px dashed var(--rule-strong);
    padding: 1rem 1.25rem 1.25rem;
    background: var(--paper);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }
  .eyebrow {
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .note {
    margin: 0 0 0.85rem;
    font-size: var(--text-sm);
    color: var(--ink-faint);
    line-height: var(--leading-snug);
  }
  .item {
    margin-bottom: 0.85rem;
  }
  .item:last-child {
    margin-bottom: 0;
  }
  /* --mark-orphan is the plan-search hit's mark drained of hue: a marked region
     whose anchor is gone. Padded on all four sides so the wash reads as a marked
     passage rather than a stray tint. */
  .quote {
    margin: 0 0 0.3rem;
    padding: 0.2rem 0.5rem 0.2rem 0.55rem;
    border-left: 2px solid var(--rule-strong);
    background: var(--mark-orphan);
    font-size: var(--text-base);
    color: var(--ink-soft);
    line-height: var(--leading-tight);
  }
  .comment {
    margin: 0;
    font-size: var(--text-md);
    color: var(--ink);
    white-space: pre-wrap;
  }
</style>
