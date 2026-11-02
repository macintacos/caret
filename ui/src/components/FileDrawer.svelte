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
    /** Whether the lane is closing: out of the layout, sliding past its edge. The
     * host keeps the drawer mounted for that beat and unmounts it once it has gone,
     * so the pane slides away with the excerpt still in it rather than vanishing. */
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
  const maxSize = $derived(maxDrawerSize(available, edge));

  function onPointerDown(e: PointerEvent & { currentTarget: HTMLElement }): void {
    const outer = root?.getBoundingClientRect();
    if (outer === undefined) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = {
      outer,
      offset: (edge === "right" ? outer.right - e.clientX : outer.bottom - e.clientY) - size,
    };
    // Suppress the text selection the drag would otherwise sweep across the plan.
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
    onResize(clampDrawerSize(size + step, available, edge));
  }
</script>

<!-- Three things FolderTree reads off this element to place the folder card clear
     of the lane, all deliberate contract rather than incidental markup:
     the edge rides the attribute's VALUE rather than only its presence (EXC-1129,
     and every `[data-file-drawer]` selector still matches); `--fd-size` is the
     lane's SETTLED size, which is what the card measures against while the lane is
     still sliding in (EXC-1137); and the closing flag rides a data attribute
     beside them rather than the `fd-closing` style class, so the card is reading a
     stated contract and not a CSS hook that could be renamed for style reasons. A
     lane sliding out is a lane on its way out, and the card treats it as no lane at
     all. -->
<aside
  bind:this={root}
  data-file-drawer={edge}
  data-file-drawer-closing={closing ? "" : undefined}
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
  /* A second pane set into the window's body beside the plan, not a floating card:
     the lane's inner --pane-gap is bare body, the seam between the two panes and the
     band the resize handle lies in. The lane holds its own size (flex: none) and clips,
     and is the positioning context the handle pins against. It runs 1px into the
     surface's padding below, so its pane's lip shows under the clip. */
  aside {
    position: relative;
    flex: none;
    display: flex;
    overflow: hidden;
    width: var(--fd-size);
    min-width: 0;
    padding: 0 0 1px var(--pane-gap);
    margin-bottom: -1px;
    /* The lane mounts at its full size, the plan giving up the room at once, and
       slides in from the edge it docks to (lib/layoutSlide.ts sets where it starts
       and on what duration). A pane entering takes --dur-pane; it leaves faster, on
       --dur-state. A re-dock across the breakpoint snaps. The global #app
       reduced-motion rule collapses all of it. */
    transition: transform var(--slide-dur, var(--dur-pane)) var(--ease-out);
  }
  aside.fd-bottom {
    flex-direction: column;
    width: auto;
    height: var(--fd-size);
    min-height: 0;
    padding: var(--pane-gap) 0 1px;
  }

  /* Closing, the lane leaves the layout where it stands, so the plan takes its room
     back in one pass, and slides out past its edge: the open run backwards, so the
     pane reads as one object. Higher specificity than the rules above, so it wins for
     whichever edge is docked. */
  aside.fd-closing {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    margin-bottom: 0;
    transform: translateX(100%);
    transition-duration: var(--dur-state);
    /* The pane is leaving — its handle is no longer a thing to grab. */
    pointer-events: none;
  }
  aside.fd-bottom.fd-closing {
    top: auto;
    left: 0;
    transform: translateY(100%);
  }

  /* The pane itself, pinned to the lane's full size on the docking axis, so a lane the
     plan squeezes clips the preview rather than squishing it. */
  .fd-content {
    position: relative;
    display: flex;
    flex: 0 0 calc(var(--fd-size) - var(--pane-gap));
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--pane-radius);
    background: var(--paper);
    box-shadow: var(--pane-lip);
  }
  /* Docked below, the lip's 1px of padding is on the docking axis too. */
  .fd-bottom .fd-content {
    flex-basis: calc(var(--fd-size) - var(--pane-gap) - 1px);
  }
  /* The plan pane's recess, over the preview, which paints its own surfaces. */
  .fd-content::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    box-shadow: var(--pane-recess);
  }

  /* The lane's one affordance, and at rest it is invisible — the gap between the
     panes IS the visual. The handle fills that gap, so the pointer finds the grab
     between the two panes; hover and keyboard focus draw a 2px seam down its middle
     in --ink-faint, so the affordance appears where the pointer already is. */
  .fd-handle {
    position: absolute;
    z-index: 1;
    inset: 0 auto 0 0;
    width: var(--pane-gap);
    cursor: col-resize;
    touch-action: none;
    border-inline: 2px solid transparent;
    background-clip: content-box;
  }
  .fd-bottom .fd-handle {
    inset: 0 0 auto 0;
    width: auto;
    height: var(--pane-gap);
    cursor: row-resize;
    border-inline: none;
    border-block: 2px solid transparent;
  }
  .fd-handle:hover,
  .fd-handle:focus-visible {
    background-color: var(--ink-faint);
  }
</style>
