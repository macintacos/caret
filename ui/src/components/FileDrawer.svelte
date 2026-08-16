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
    maxDrawerSize,
    MIN_DRAWER_PX,
  } from "$lib/fileDrawer.ts";

  interface Props {
    /** Which edge of the plan surface the drawer docks to. */
    edge: DrawerEdge;
    /** The lane's current size along the docking axis, in px. */
    size: number;
    /** The docking axis the lane and the plan divide between them, in px — what
     * bounds a resize. Passed in rather than measured here, so the component needs
     * no knowledge of what it is mounted inside and the bound tracks a window
     * resize without this file reading layout. */
    available: number;
    /** A resize the drawer is asking for, already clamped. */
    onResize: (px: number) => void;
    /** Whether the lane is playing its closing wipe. The host keeps the drawer
     * mounted for that beat and unmounts it when the wipe ends, so the pane
     * slides shut with the excerpt still in it rather than vanishing. */
    closing?: boolean;
    /** The preview itself. */
    children: Snippet;
  }
  let { edge, size, available, onResize, closing = false, children }: Props = $props();

  /** How far one arrow-key press moves the handle. */
  const KEY_STEP_PX = 24;

  let root = $state<HTMLElement>();
  /** The in-flight gesture: the lane's outer edge as the press found it, plus how
   * far the grab sat from that edge — so the lane follows the pointer's movement
   * instead of snapping its edge under the cursor. Measured once per gesture; the
   * outer edge is the surface's own and cannot move while a drag is in progress. */
  let drag: { outer: DOMRect; offset: number } | undefined;

  /** The separator's upper bound, taken from the clamp's own bound so the range
   * assistive tech is told can't drift from the range actually enforced. */
  const maxSize = $derived(maxDrawerSize(available));

  function onPointerDown(e: PointerEvent & { currentTarget: HTMLElement }): void {
    const outer = root?.getBoundingClientRect();
    if (outer === undefined) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = {
      outer,
      offset: (edge === "right" ? outer.right - e.clientX : outer.bottom - e.clientY) - size,
    };
    // Suppress the text selection the drag would otherwise sweep across the plan —
    // the one thing this has left to do.
    e.preventDefault();
    // …including the focus the press would have given the handle, so take that
    // explicitly: a reader who drags can then fine-tune with the arrow keys.
    e.currentTarget.focus();
  }

  function onPointerMove(e: PointerEvent): void {
    if (drag === undefined) return;
    const shifted =
      edge === "right"
        ? { clientX: e.clientX + drag.offset, clientY: e.clientY }
        : { clientX: e.clientX, clientY: e.clientY + drag.offset };
    onResize(drawerSizeFromPointer(edge, shifted, drag.outer, available));
  }

  // No releasePointerCapture: capture is released implicitly once pointerup or
  // pointercancel fires, and calling it for a pointer that is already gone throws
  // NotFoundError — which would strand the gesture and leave a bare hover
  // dragging the lane.
  function endDrag(): void {
    drag = undefined;
  }

  // The keyboard equivalent of the drag, through the same clamp. The handle sits
  // on the drawer's inner edge, so the key pointing away from the dock grows it.
  function onKeyDown(e: KeyboardEvent): void {
    const [grow, shrink] =
      edge === "right" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const step = e.key === grow ? KEY_STEP_PX : e.key === shrink ? -KEY_STEP_PX : 0;
    if (step === 0) return;
    e.preventDefault();
    onResize(clampDrawerSize(size + step, available));
  }
</script>

<aside
  bind:this={root}
  data-file-drawer
  aria-label="File preview"
  class:fd-bottom={edge === "bottom"}
  class:fd-closing={closing}
  style:--fd-size="{size}px"
>
  <div class="fd-content">{@render children()}</div>
  <!-- A focusable separator is ARIA's window-splitter: it takes a tab stop and
       arrow keys, and its aria-value* report the split. svelte's a11y check reads
       `separator` as non-interactive whether or not it is focusable, so both
       warnings are about the pattern itself. -->
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
    aria-valuetext="{Math.round(size)} pixels"
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
    /* The open wipe: the lane grows from nothing while .diff-plan (flex: 1) gives
       up the space. It animates on MOUNT because the drawer is unmounted when
       closed, so there is no closed class to toggle. Re-docking swaps
       animation-name below, which restarts the wipe — so an open drawer crossing
       the breakpoint wipes in from its new edge rather than jumping there. The
       global #app reduced-motion rule collapses all of it. */
    animation: fd-open-right var(--dur-enter) var(--ease-out);
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

  /* The close wipe: the same travel on the same dimension, run the other way, so
     the pane reads as one object sliding shut rather than a second effect. It
     takes --dur-exit against the open's --dur-enter, and the paired --ease-in, the
     exit curve — a pane leaving accelerates away, where an entering one decelerates
     into place. The lane once kept the open's duration to stop the collapse reading
     as a snap; the surface tier now carries that itself — --dur-exit is a shorter
     entrance rather than a micro-interaction, so the pane still slides shut.
     `forwards` holds the collapsed frame until the host unmounts, so the lane
     cannot flash back to full width in the gap. Higher specificity than the
     rules above, so it wins for whichever edge is docked. */
  aside.fd-closing {
    animation: fd-close-right var(--dur-exit) var(--ease-in) forwards;
    /* The pane is leaving — its handle is no longer a thing to grab. */
    pointer-events: none;
  }
  aside.fd-bottom.fd-closing {
    animation-name: fd-close-bottom;
  }
  @keyframes fd-close-right {
    from {
      width: var(--fd-size);
    }
    to {
      width: 0;
    }
  }
  @keyframes fd-close-bottom {
    from {
      height: var(--fd-size);
    }
    to {
      height: 0;
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
