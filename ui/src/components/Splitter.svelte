<script lang="ts">
  // ARIA's window splitter on the gap between two panes: a drag along its axis, the arrow
  // keys once it has focus, and a double-click to reset where the pane has an opening size
  // to return to. The host places it over the gap and owns the size; every size asked for
  // is already within the host's bounds.
  interface Props {
    /** The separator's accessible name. */
    label: string;
    /** The way the pointer moves to grow the pane this sizes. Left or right makes a
     * vertical bar, up a horizontal one. */
    grows: "left" | "right" | "up";
    /** The pane's size along that axis, in px, and its bounds. */
    size: number;
    min: number;
    max: number;
    onResize: (px: number) => void;
    onReset?: () => void;
  }
  let { label, grows, size, min, max, onResize, onReset }: Props = $props();

  /** How far one arrow-key press moves the edge. */
  const KEY_STEP_PX = 24;

  const vertical = $derived(grows !== "up");
  const sign = $derived(grows === "right" ? 1 : -1);

  /** The gesture in flight: where along the axis it started, and the size it started at,
   * so the edge follows the pointer's travel rather than snapping under it. */
  let drag = $state<{ from: number; size: number } | undefined>();
  /** Where along the bar the pointer found it, which is where the grip stands. */
  let gripAt = $state<number | undefined>();

  const along = (e: PointerEvent) => (vertical ? e.clientX : e.clientY);
  const bounded = (px: number) => Math.round(Math.min(Math.max(px, min), max));

  function onPointerDown(e: PointerEvent & { currentTarget: HTMLElement }): void {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = { from: along(e), size };
    // Suppressing the drag's text selection suppresses the press's focus too, so take it
    // explicitly: a reader who drags can then fine-tune with the arrow keys. Script focus
    // would otherwise match :focus-visible and leave the grip lit after the drag.
    e.preventDefault();
    e.currentTarget.focus({ focusVisible: false });
  }

  function onPointerMove(e: PointerEvent): void {
    // Held, the grip stays where it was grabbed. Read only while nothing is resizing, so
    // the offset never forces a layout mid-drag.
    if (drag === undefined) {
      gripAt = vertical ? e.offsetY : e.offsetX;
      return;
    }
    onResize(bounded(drag.size + sign * (along(e) - drag.from)));
  }

  // No releasePointerCapture: capture is released implicitly once pointerup or
  // pointercancel fires, and calling it for a pointer that is already gone throws
  // NotFoundError, which would strand the gesture and leave a bare hover dragging.
  function endDrag(): void {
    drag = undefined;
  }

  function onKeyDown(e: KeyboardEvent): void {
    const [forward, back] = vertical ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
    const step = e.key === forward ? KEY_STEP_PX : e.key === back ? -KEY_STEP_PX : 0;
    if (step === 0) return;
    e.preventDefault();
    onResize(bounded(size + sign * step));
  }
</script>

<!-- A focusable separator is ARIA's window splitter: it takes a tab stop and arrow keys,
     and its aria-value* report the split. svelte's a11y check reads `separator` as
     non-interactive whether or not it is focusable, so both warnings are about the
     pattern itself. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="splitter"
  role="separator"
  tabindex="0"
  aria-label={label}
  aria-orientation={vertical ? "vertical" : "horizontal"}
  aria-valuenow={size}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuetext="{Math.round(size)} pixels"
  data-dragging={drag === undefined ? undefined : ""}
  style:--grip-at={gripAt === undefined ? undefined : `${gripAt}px`}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onpointerleave={() => (gripAt = undefined)}
  onkeydown={onKeyDown}
  ondblclick={onReset}
>
  <span class="grip" aria-hidden="true"></span>
</div>

<style>
  /* At rest the gap is the whole visual. Where the pointer finds it, or the keyboard
     focuses it, a grip rises in it under the pointer: the switch's small rubber key, light
     in both schemes, at a key's height. Held, the grip goes down as a pressed key does,
     its side folding away and its shading turning concave. The host sets the bar's box. */
  .splitter {
    position: absolute;
    z-index: 1;
    cursor: col-resize;
    touch-action: none;
  }
  .splitter[aria-orientation="horizontal"] {
    cursor: row-resize;
  }
  .grip {
    --knob-now: var(--knob-face);
    position: absolute;
    top: clamp(1rem, var(--grip-at, 50%), 100% - 1rem);
    left: 50%;
    width: 6px;
    height: 2rem;
    border-radius: 3px;
    translate: -50% -50%;
    /* So the bar stays the pointer's target, and the offset the grip stands at is the
       bar's. */
    pointer-events: none;
    background-color: var(--knob-now);
    background-image: linear-gradient(
      var(--rubber-lift),
      transparent 40%,
      transparent 55%,
      var(--rubber-foot)
    );
    box-shadow:
      inset 0 1px 1px var(--rubber-gloss),
      inset 0 0 0 1px var(--knob-edge),
      0 0 0 transparent,
      0 0 0 transparent;
    opacity: 0;
    transition:
      opacity var(--dur-state) var(--ease-out),
      background-color var(--dur-state) var(--ease-out),
      box-shadow var(--dur-state) var(--ease-out);
  }
  .splitter[aria-orientation="horizontal"] .grip {
    top: 50%;
    left: clamp(1rem, var(--grip-at, 50%), 100% - 1rem);
    width: 2rem;
    height: 6px;
  }
  .splitter:is(:hover, :focus-visible) .grip {
    opacity: 1;
    box-shadow:
      inset 0 1px 1px var(--rubber-gloss),
      inset 0 0 0 1px var(--knob-edge),
      0 1.5px 0 color-mix(in lab, var(--knob-now), black var(--rubber-side)),
      0 2px 3px -1px var(--rubber-cast-near);
  }
  .splitter[data-dragging] .grip {
    --knob-now: var(--knob-face-down);
    opacity: 1;
    background-image: linear-gradient(var(--rubber-foot), transparent 40%);
    box-shadow:
      inset 0 1px 2px var(--rubber-press),
      inset 0 0 0 1px var(--knob-edge),
      0 0 0 transparent,
      0 0 0 transparent;
  }
</style>
