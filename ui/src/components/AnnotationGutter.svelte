<script lang="ts">
  import type { Annotation } from "../lib/types.ts";
  import AnnotationCard from "./AnnotationCard.svelte";

  interface Resolved {
    annotation: Annotation;
    orphaned: boolean;
    top: number | null;
  }

  interface Props {
    resolved: Resolved[];
    activeId: string | null;
    onFocus: (id: string) => void;
    onEdit: (id: string, comment: string) => void;
    onDelete: (id: string) => void;
  }
  let { resolved, activeId, onFocus, onEdit, onDelete }: Props = $props();

  let anchored = $derived(resolved.filter((r) => !r.orphaned));
  let orphans = $derived(resolved.filter((r) => r.orphaned));
</script>

<div class="gutter">
  <div class="head">
    <span class="eyebrow">Annotations</span>
    <span class="count mono">{resolved.length}</span>
  </div>

  {#if resolved.length === 0}
    <p class="hint">
      Select any passage in the plan to leave an inline comment.
    </p>
  {/if}

  <div class="stack">
    {#each anchored as r (r.annotation.id)}
      <AnnotationCard
        annotation={r.annotation}
        active={r.annotation.id === activeId}
        top={r.top ?? undefined}
        {onFocus}
        {onEdit}
        {onDelete}
      />
    {/each}
  </div>

  {#if orphans.length > 0}
    <div class="orphan-section">
      <div class="orphan-head">
        <span class="eyebrow">Detached</span>
        <p class="orphan-note">
          These comments lost their anchor when the plan changed. They are still
          sent with your feedback.
        </p>
      </div>
      {#each orphans as r (r.annotation.id)}
        <AnnotationCard
          annotation={r.annotation}
          orphaned
          active={r.annotation.id === activeId}
          {onFocus}
          {onEdit}
          {onDelete}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .gutter {
    position: relative;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 0.6rem;
    margin-bottom: 1.25rem;
  }
  .count {
    color: var(--accent);
    font-weight: 600;
  }
  .hint {
    font-size: 0.85rem;
    color: var(--ink-faint);
    font-style: italic;
    line-height: 1.5;
  }
  /* Cards are positioned with translateY to align near their spans; the stack
     stays in flow but each card nudges down toward its highlight. */
  .stack {
    position: relative;
  }
  .orphan-section {
    margin-top: 2rem;
    border-top: 1px dashed var(--rule-strong);
    padding-top: 1.25rem;
  }
  .orphan-note {
    font-size: 0.78rem;
    color: var(--ink-faint);
    line-height: 1.45;
    margin: 0.35rem 0 1rem;
  }
</style>
