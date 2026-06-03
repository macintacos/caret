<script lang="ts">
  import { anchorPoint, isAnchorVisible } from "../lib/popoverAnchor.ts";
  import type { Annotation } from "../lib/types.ts";
  import AnnotationEditor from "./AnnotationEditor.svelte";

  // The inline view/edit/delete popover, anchored to a clicked <mark>. Unlike the
  // transient CommentPopover (create flow), this one persists, so it tracks its
  // anchor as the plan scrolls/resizes and dismisses when the mark leaves view.
  // It hosts the shared AnnotationEditor so edit/delete never forks.
  interface Props {
    annotation: Annotation;
    /** The plan scroll container; the popover follows the mark within it. */
    scrollEl: HTMLElement | undefined;
    onEdit: (id: string, comment: string) => void;
    onDelete: (id: string) => void;
    onDismiss: () => void;
  }
  let { annotation, scrollEl, onEdit, onDelete, onDismiss }: Props = $props();

  let popoverEl = $state<HTMLElement | undefined>();
  let x = $state(0);
  let y = $state(0);
  let placed = $state(false);

  function markEl(): HTMLElement | null {
    return (
      scrollEl?.querySelector(`mark[data-annotation="${annotation.id}"]`) ?? null
    );
  }

  function reposition() {
    const m = markEl();
    if (!m) return; // mid-repaint: keep the last position rather than flicker
    const rect = m.getBoundingClientRect();
    if (scrollEl) {
      const vp = scrollEl.getBoundingClientRect();
      if (!isAnchorVisible(rect, vp)) {
        // Out of view: dismiss only once we've actually shown it. On mount the
        // mark may still be off-screen because focusAnnotation kicked off a
        // smooth scrollIntoView — wait for that scroll to bring it in rather
        // than dismissing before the popover ever appears.
        if (placed) onDismiss();
        return;
      }
    }
    const p = anchorPoint(rect);
    x = p.x;
    y = p.y;
    placed = true;
  }

  // Follow the mark as the plan scrolls or the window resizes (rAF-throttled).
  $effect(() => {
    reposition();
    let raf = 0;
    const onMove = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(reposition);
    };
    scrollEl?.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(raf);
      scrollEl?.removeEventListener("scroll", onMove);
      window.removeEventListener("resize", onMove);
    };
  });

  // Esc and click-away dismiss. A click on another mark or a sidebar card drives
  // its own focus switch (PlanView / the rail card calls onFocusAnnotation), so
  // it must not also dismiss here — and a mouse dismiss must not steal focus back
  // to the old mark (only the keyboard path returns focus, for accessibility).
  $effect(() => {
    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement;
      if (popoverEl?.contains(t)) return;
      if (t.closest?.("mark[data-annotation]")) return;
      if (t.closest?.("[data-annotation-card]")) return;
      onDismiss();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        markEl()?.focus(); // keyboard dismiss returns focus to the mark
        onDismiss();
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  });

  // Land focus in the popover so the keyboard can reach edit/delete; dismiss()
  // returns focus to the mark on close.
  $effect(() => {
    queueMicrotask(() => popoverEl?.focus());
  });
</script>

<div
  class="popover"
  class:placed
  bind:this={popoverEl}
  style="left: {x}px; top: {y}px;"
  role="dialog"
  aria-label="Annotation"
  tabindex="-1"
>
  <p class="quote" title={annotation.quote}>&ldquo;{annotation.quote}&rdquo;</p>
  <AnnotationEditor {annotation} {onEdit} {onDelete} />
</div>

<style>
  .popover {
    position: fixed;
    z-index: 50;
    width: 280px;
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    padding: 0.75rem;
    /* Hidden + slightly small until the first measure lands, so it never paints
       at 0,0; `placed` fades and scales it in at the anchored position. */
    opacity: 0;
    transform: translateX(-50%) translateY(8px) scale(0.97);
    transform-origin: top center;
    transition:
      opacity 0.14s ease-out,
      transform 0.14s ease-out;
  }
  .popover.placed {
    opacity: 1;
    transform: translateX(-50%) translateY(8px) scale(1);
  }
  .popover:focus {
    outline: none;
  }
  .quote {
    font-style: italic;
    font-size: 0.85rem;
    color: var(--ink-soft);
    margin: 0 0 0.5rem;
    border-left: 2px solid var(--accent);
    padding-left: 0.5rem;
    max-height: 3.4em;
    overflow: hidden;
  }
  @media (prefers-reduced-motion: reduce) {
    .popover {
      transition: none;
    }
  }
</style>
