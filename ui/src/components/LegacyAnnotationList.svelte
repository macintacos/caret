<script lang="ts">
  // Read-only display of selection-anchored (legacy-shape) annotations on the
  // source-view surface. Legacy annotations predate line anchoring: they carry a
  // quoted passage rather than a {startLine, endLine}, so they cannot be placed
  // on a source line and are listed below the view instead. Per the union compat
  // contract they always load and render, but never expose edit or delete.
  //
  // The container stays a plain full-bleed footer section (a Card's contained,
  // rounded frame would fight the below-the-view framing); the count adopts a
  // shadcn Badge (EXC-765), matching the count-chip pattern used elsewhere — the
  // shared `.count` rule lives in styles/atoms.css. It stays neutral: this tally
  // reports a static fact, so it skips the .count-attention modifier.
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
  /* The quoted passage is a marked region of the document whose anchor is gone,
     which is exactly what --mark-orphan names: the same mark as a live plan-search
     hit, drained of hue because there is no line to point at. Padded on all four
     sides so the wash reads as a marked passage rather than a stray tint — the block
     padding is what stops the quote's text sitting flush against the wash's edge. */
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
