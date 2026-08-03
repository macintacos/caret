<script lang="ts">
  // The docking lane for the file preview (EXC-937). A container only: it owns
  // the space the preview occupies beside the plan and the drag that resizes it,
  // and renders whatever the host puts inside. The drag math lives in
  // lib/fileDrawer.ts, so this file is the DOM shell around it — the pointer
  // capture, the keyboard equivalent, and the lane's own chrome.
  import type { Snippet } from "svelte";

  import {
    clampDrawerSize,
    type DrawerEdge,
    drawerSizeFromPointer,
    MIN_DRAWER_PX,
    MIN_PLAN_PX,
  } from "$lib/fileDrawer.ts";

  interface Props {
    /** Which edge of the plan surface the drawer docks to. */
    edge: DrawerEdge;
    /** The lane's current size along the docking axis, in px. */
    size: number;
    /** A resize the drawer is asking for, already clamped. */
    onResize: (px: number) => void;
    /** The preview itself. */
    children: Snippet;
  }
  let { edge, size, onResize, children }: Props = $props();

  /** How far one arrow-key press moves the handle. */
  const KEY_STEP_PX = 24;

  let root = $state<HTMLElement>();
  let dragging = false;

  /** The lane's parent (.diff-surface) — the span the drawer and the plan divide
   * between them, and so what bounds the drag. Read live rather than cached: a
   * window resize between gestures must not hand the clamp a stale bound. */
  function surface(): DOMRect | undefined {
    return root?.parentElement?.getBoundingClientRect();
  }

  function axis(rect: DOMRect | undefined): number {
    return rect ? (edge === "right" ? rect.width : rect.height) : 0;
  }

  /** The separator's upper bound: everything past the plan's minimum column.
   * Depends on `size`, so it re-measures on every drag frame. Floored at the
   * current size so a lane not yet laid out still reports a coherent range
   * rather than a maximum below where the handle already sits. */
  const maxSize = $derived(Math.max(axis(surface()) - MIN_PLAN_PX, size));

  function onPointerDown(e: PointerEvent & { currentTarget: HTMLElement }): void {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging = true;
    // Suppress the text selection the drag would otherwise sweep across the plan.
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const rect = surface();
    if (rect) onResize(drawerSizeFromPointer(edge, e, rect));
  }

  function endDrag(e: PointerEvent & { currentTarget: HTMLElement }): void {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragging = false;
  }

  // The keyboard equivalent of the drag, through the same clamp. The handle sits
  // on the drawer's inner edge, so the key pointing away from the dock grows it.
  function onKeyDown(e: KeyboardEvent): void {
    const [grow, shrink] =
      edge === "right" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const step = e.key === grow ? KEY_STEP_PX : e.key === shrink ? -KEY_STEP_PX : 0;
    if (step === 0) return;
    e.preventDefault();
    onResize(clampDrawerSize(size + step, axis(surface())));
  }
</script>

<aside
  bind:this={root}
  data-file-drawer
  aria-label="File preview"
  class:fd-bottom={edge === "bottom"}
  style:--fd-size="{size}px"
>
  <div class="fd-content">{@render children()}</div>
  <!-- A focusable separator is ARIA's window-splitter: it takes a tab stop and
       arrow keys, and its aria-value* report the split. svelte's a11y check reads
       `separator` as non-interactive whether or not it is focusable, so both
       warnings are about the pattern itself. In runes mode the codes are
       comma-separated on one comment. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="fd-handle"
    role="separator"
    tabindex="0"
    aria-label="Resize file preview"
    aria-orientation={edge === "right" ? "vertical" : "horizontal"}
    aria-valuenow={size}
    aria-valuemin={MIN_DRAWER_PX}
    aria-valuemax={maxSize}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    onkeydown={onKeyDown}
  ></div>
</aside>

<style>
  /* Chrome, not a floating card: no shadow, no radius — the hairline rule on the
     drawer's inner edge is the only seam between the plan and the preview. The
     lane holds its own size (flex: none) and clips, and is the positioning
     context the handle pins against. */
  aside {
    position: relative;
    flex: none;
    display: flex;
    overflow: hidden;
    width: var(--fd-size);
    min-width: 0;
    background: var(--paper);
    border-left: 1px solid var(--rule);
    /* The open wipe: the lane grows from nothing while .diff-plan (flex: 1)
       gives up the space, mirroring the ToC rail's collapse. It animates on
       MOUNT because the drawer is unmounted when closed, so there is no closed
       class to toggle. The global #app reduced-motion rule collapses it. */
    animation: fd-open-right var(--dur-base) var(--ease-out);
  }
  aside.fd-bottom {
    flex-direction: column;
    width: auto;
    height: var(--fd-size);
    min-height: 0;
    border-left: none;
    border-top: 1px solid var(--rule);
    animation-name: fd-open-bottom;
  }
  @keyframes fd-open-right {
    from {
      width: 0;
    }
    to {
      width: var(--fd-size);
    }
  }
  @keyframes fd-open-bottom {
    from {
      height: 0;
    }
    to {
      height: var(--fd-size);
    }
  }

  /* Pinned to the lane's full size on the docking axis so the wipe clips the
     preview rather than squishing it through every frame of the open. The pin
     is the lane's border-box size, so it overshoots the content box by the
     hairline's 1px; overflow: hidden above absorbs it, and buying the pixel back
     would cost a calc() that has to track the border width. */
  .fd-content {
    display: flex;
    flex: 0 0 var(--fd-size);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  /* The lane's one affordance, and at rest it is invisible — the hairline rule
     IS the visual. A 6px band lies against the rule so the pointer finds the
     grab before it finds the edge; hover and keyboard focus thicken the seam
     into --ink-faint, so the affordance appears where the pointer already is.
     The app-wide :focus-visible ring (base.css) is left alone. */
  .fd-handle {
    position: absolute;
    z-index: 1;
    inset: 0 auto 0 0;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
    border-left: 2px solid transparent;
  }
  .fd-bottom .fd-handle {
    inset: 0 0 auto 0;
    width: auto;
    height: 6px;
    cursor: row-resize;
    border-left: none;
    border-top: 2px solid transparent;
  }
  .fd-handle:hover,
  .fd-handle:focus-visible {
    border-color: var(--ink-faint);
  }
</style>
