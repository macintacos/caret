<script lang="ts">
  // Read-only display of selection-anchored (legacy-shape) annotations on the
  // source-view surface. Legacy annotations predate line anchoring: they carry a
  // quoted passage rather than a {startLine, endLine}, so they cannot be placed
  // on a source line and are listed below the view instead. Per the union compat
  // contract they always load and render, but never expose edit or delete.
  import type { LegacyAnnotation } from "@core/types";

  interface Props {
    annotations: LegacyAnnotation[];
  }
  let { annotations }: Props = $props();
</script>

{#if annotations.length > 0}
  <section class="legacy-list" aria-label="Unanchored comments">
    <header class="head">
      <span class="eyebrow">Unanchored comments</span>
      <span class="count">{annotations.length}</span>
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
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .count {
    font-size: 0.72rem;
    color: var(--ink-faint);
  }
  .note {
    margin: 0 0 0.85rem;
    font-size: 0.78rem;
    color: var(--ink-faint);
    line-height: 1.45;
  }
  .item {
    margin-bottom: 0.85rem;
  }
  .item:last-child {
    margin-bottom: 0;
  }
  .quote {
    margin: 0 0 0.3rem;
    padding-left: 0.55rem;
    border-left: 2px solid var(--rule-strong);
    font-size: 0.82rem;
    color: var(--ink-soft);
    line-height: 1.4;
  }
  .comment {
    margin: 0;
    font-size: 0.92rem;
    color: var(--ink);
    white-space: pre-wrap;
  }
</style>
