<script lang="ts">
  import { resolveAnnotation } from "../lib/anchors.ts";
  import { captureSelection } from "../lib/selection.ts";
  import type { Annotation } from "../lib/types.ts";
  import CommentPopover from "./CommentPopover.svelte";

  export interface ResolvedAnnotation {
    annotation: Annotation;
    orphaned: boolean;
    top: number | null;
  }

  interface Props {
    /** Sanitized HTML from renderPlan(). */
    html: string;
    annotations: Annotation[];
    activeId: string | null;
    scrollEl?: HTMLElement;
    /** Reports re-resolution results back up (for the gutter + orphan bucket). */
    onResolved: (resolved: ResolvedAnnotation[]) => void;
    onCreate: (sel: {
      blockId: string;
      startOffset: number;
      endOffset: number;
      quote: string;
      comment: string;
    }) => void;
    onFocusAnnotation: (id: string) => void;
  }
  let {
    html,
    annotations,
    activeId,
    scrollEl = $bindable(),
    onResolved,
    onCreate,
    onFocusAnnotation,
  }: Props = $props();

  let root = $state<HTMLElement | undefined>();

  // Pending selection awaiting a comment.
  let pending = $state<{
    blockId: string;
    startOffset: number;
    endOffset: number;
    quote: string;
    x: number;
    y: number;
  } | null>(null);

  function getBlock(blockId: string): HTMLElement | null {
    return (root?.querySelector(`#${CSS.escape(blockId)}`) as HTMLElement) ?? null;
  }

  /** Wraps each resolved annotation's range in a <mark>, then reports tops. */
  function paint() {
    if (!root) return;
    // Clear previous marks (unwrap).
    root.querySelectorAll("mark[data-annotation]").forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });

    const resolved: ResolvedAnnotation[] = [];
    const rootTop = root.getBoundingClientRect().top;

    for (const annotation of annotations) {
      const res = resolveAnnotation(annotation, getBlock);
      if (res.tier === 3 || !res.range) {
        resolved.push({ annotation, orphaned: true, top: null });
        continue;
      }
      let top: number | null = null;
      try {
        const mark = document.createElement("mark");
        mark.dataset.annotation = annotation.id;
        mark.className = "anno";
        if (annotation.id === activeId) mark.classList.add("active");
        res.range.surroundContents(mark);
        top = mark.getBoundingClientRect().top - rootTop;
      } catch {
        // surroundContents throws if the range crosses element boundaries;
        // fall back to leaving the text unwrapped but still anchored.
        top = res.range.getBoundingClientRect().top - rootTop;
      }
      resolved.push({ annotation, orphaned: false, top });
    }
    onResolved(resolved);
  }

  // Re-paint whenever the html or annotation set changes. Use a microtask so the
  // {@html} content is in the DOM first.
  $effect(() => {
    // touch deps
    void html;
    void annotations;
    void activeId;
    queueMicrotask(paint);
  });

  function onMouseUp(e: MouseEvent) {
    if (!root) return;
    // Ignore clicks on existing marks (handled by click below).
    const cap = captureSelection(root);
    if (!cap) {
      pending = null;
      return;
    }
    pending = {
      blockId: cap.blockId,
      startOffset: cap.startOffset,
      endOffset: cap.endOffset,
      quote: cap.quote,
      x: cap.rect.left + cap.rect.width / 2,
      y: cap.rect.bottom,
    };
  }

  function onClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const mark = target.closest("mark[data-annotation]") as HTMLElement | null;
    if (mark?.dataset.annotation) {
      onFocusAnnotation(mark.dataset.annotation);
    }
  }

  function confirmComment(comment: string) {
    if (!pending) return;
    onCreate({
      blockId: pending.blockId,
      startOffset: pending.startOffset,
      endOffset: pending.endOffset,
      quote: pending.quote,
      comment,
    });
    pending = null;
    window.getSelection()?.removeAllRanges();
  }
</script>

<div class="plan-scroll col col-plan" bind:this={scrollEl}>
  <!-- The plan surface delegates highlight clicks and captures text selections;
       these listeners are intrinsic to a document-review surface. Keyboard
       annotation isn't supported here (selection is pointer-driven). -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <article
    class="plan prose"
    bind:this={root}
    onmouseup={onMouseUp}
    onclick={onClick}
    role="document"
  >
    {@html html}
  </article>
</div>

{#if pending}
  <CommentPopover
    x={pending.x}
    y={pending.y}
    quote={pending.quote}
    onConfirm={confirmComment}
    onDismiss={() => (pending = null)}
  />
{/if}

<style>
  .prose {
    max-width: 72ch;
    margin: 0 auto;
  }

  /* ----- Manuscript typography for rendered plan ----- */
  .prose :global(h1) {
    font-weight: 600;
    font-size: 2.4rem;
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin: 0 0 1.5rem;
    scroll-margin-top: 1.5rem;
  }
  .prose :global(h2) {
    font-weight: 500;
    font-size: 1.65rem;
    line-height: 1.2;
    margin: 2.5rem 0 1rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--rule);
    scroll-margin-top: 1.5rem;
  }
  .prose :global(h3) {
    font-weight: 600;
    font-size: 1.25rem;
    margin: 2rem 0 0.75rem;
    scroll-margin-top: 1.5rem;
  }
  .prose :global(h4),
  .prose :global(h5),
  .prose :global(h6) {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
    margin: 1.75rem 0 0.5rem;
    scroll-margin-top: 1.5rem;
  }
  .prose :global(p) {
    margin: 0 0 1.1rem;
  }
  .prose :global(a) {
    color: var(--accent);
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
  .prose :global(ul),
  .prose :global(ol) {
    margin: 0 0 1.1rem;
    padding-left: 1.4rem;
  }
  .prose :global(li) {
    margin: 0.3rem 0;
  }
  .prose :global(li::marker) {
    color: var(--accent);
  }
  .prose :global(blockquote) {
    margin: 1.25rem 0;
    padding: 0.25rem 0 0.25rem 1.1rem;
    border-left: 3px solid var(--accent);
    color: var(--ink-soft);
    font-style: italic;
  }
  .prose :global(code) {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--paper-sunk);
    border: 1px solid var(--rule);
    border-radius: 3px;
    padding: 0.08em 0.34em;
  }
  .prose :global(pre) {
    background: var(--paper-sunk);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: 1rem 1.1rem;
    overflow-x: auto;
    margin: 0 0 1.25rem;
    line-height: 1.5;
  }
  .prose :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.82rem;
  }
  .prose :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 1.25rem;
    font-size: 0.9rem;
  }
  .prose :global(th),
  .prose :global(td) {
    border: 1px solid var(--rule);
    padding: 0.45rem 0.65rem;
    text-align: left;
  }
  .prose :global(th) {
    font-family: var(--font-mono);
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--paper-sunk);
  }
  .prose :global(hr) {
    border: none;
    border-top: 1px solid var(--rule-strong);
    margin: 2rem 0;
  }
  .prose :global(strong) {
    font-weight: 600;
  }

  /* ----- Annotation highlight ----- */
  .prose :global(mark.anno) {
    background: var(--mark);
    color: inherit;
    border-bottom: 1.5px solid var(--accent);
    border-radius: 1px;
    padding: 0.04em 0.05em;
    cursor: pointer;
    transition: background 0.12s;
  }
  .prose :global(mark.anno:hover),
  .prose :global(mark.anno.active) {
    background: var(--mark-active);
  }
</style>
