<script lang="ts">
  // A small confirmation that pops out of the button that triggered it (EXC-749),
  // for the destructive, no-undo inline-comment actions: discarding a draft
  // (SourceComposer) and deleting a submitted comment (SourceAnnotationCard).
  // Presentational and parent-owned: the host wraps its trigger in a
  // position:relative element and renders this inside it while its own
  // `confirming` flag is set, so the bubble anchors to the button rather than
  // floating as a centered modal (the wrong feel for a quick in-context yes/no).
  // Esc, an outside click, or the Cancel button back out; the confirm button is
  // focused on mount so Enter completes the action the reviewer already started.
  //
  // Two positioning modes. Without `anchor` (the composer/card) it stays in-flow,
  // absolutely positioned under its trigger's wrapper. With `anchor` (the Request
  // Changes dialog, whose body scrolls) it PORTALS to document.body and positions
  // itself `fixed` against the anchor element, so it escapes the modal body's
  // overflow and clamps inside the viewport — flipping above the trigger when it
  // would run off the bottom, and shifting horizontally off any edge (EXC-762).
  import { isCancelKey } from "$lib/keys.ts";

  interface Props {
    /** The yes/no question, e.g. "Discard this comment?". Also the aria-label. */
    question: string;
    /** The destructive action's verb, e.g. "Discard" / "Delete". */
    confirmLabel: string;
    /** The back-out label; defaults to "Cancel". */
    cancelLabel?: string;
    /** Which horizontal edge to anchor to the trigger: "end" (right, the
     * default — matches the composer's right-aligned row) or "start" (left —
     * matches the card footer's left-aligned links). */
    align?: "start" | "end";
    /** The trigger element to position against. When set, the bubble portals to
     * document.body and positions `fixed` relative to this element with viewport
     * collision handling — the escape hatch for a scrollable/edge-hugging host.
     * When omitted, the bubble stays in-flow under its wrapper (the default). */
    anchor?: HTMLElement;
    onConfirm: () => void;
    onCancel: () => void;
  }
  let {
    question,
    confirmLabel,
    cancelLabel = "Cancel",
    align = "end",
    anchor,
    onConfirm,
    onCancel,
  }: Props = $props();

  let popover = $state<HTMLDivElement | undefined>();
  let confirmEl = $state<HTMLButtonElement | undefined>();

  // Fixed-position coordinates, computed against the anchor in the effect below
  // (anchor mode only). Undefined until measured; the pop keyframe fades in from
  // opacity 0, so the pre-measurement frame at (0,0) never shows.
  let posTop = $state<number>();
  let posLeft = $state<number>();
  let tailLeft = $state<number>();

  const VIEWPORT_MARGIN = 8;
  const ANCHOR_GAP = 8;

  // Moves the bubble out to document.body when anchored, so no ancestor overflow
  // (the scrollable dialog body) can clip it. A no-op in-flow. Svelte removes the
  // node on unmount via destroy.
  function portal(node: HTMLElement) {
    if (anchor) document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  // Position against the anchor: honour `align` as the horizontal preference then
  // clamp into the viewport; sit below the trigger, flipping above when the bubble
  // would overflow the bottom. Runs once the portaled node is measurable.
  $effect(() => {
    if (!anchor || !popover) return;
    const a = anchor.getBoundingClientRect();
    const p = popover.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = align === "end" ? a.right - p.width : a.left;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - p.width - VIEWPORT_MARGIN));

    let top = a.bottom + ANCHOR_GAP;
    if (top + p.height > vh - VIEWPORT_MARGIN) {
      const aboveTop = a.top - ANCHOR_GAP - p.height;
      top = aboveTop >= VIEWPORT_MARGIN ? aboveTop : Math.max(VIEWPORT_MARGIN, vh - p.height - VIEWPORT_MARGIN);
    }

    posLeft = left;
    posTop = top;
    // Point the tail at the trigger's centre, clamped a little inside the bubble.
    tailLeft = Math.max(12, Math.min(a.left + a.width / 2 - left, p.width - 12));
  });

  // A fixed bubble can't track a moving anchor, so any scroll (capture: catches
  // the dialog body's own scroller) or resize backs it out rather than drift.
  $effect(() => {
    if (!anchor) return;
    const close = () => onCancel();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  });

  // Focus the confirm button so the bubble takes focus off the trigger (Esc/Enter
  // land here) and a keyboard reviewer can complete the action they initiated.
  // preventScroll matches the annotation row's other focus moves (the composer's
  // autofocus, slotInto's focus restore): the bubble sits above the trigger and
  // out of flow, so a plain focus() would scroll the diff to it.
  $effect(() => {
    confirmEl?.focus({ preventScroll: true });
  });

  function onKey(e: KeyboardEvent) {
    if (isCancelKey(e)) {
      e.stopPropagation();
      onCancel();
    }
  }

  // A pointerdown anywhere outside the bubble backs out — the light-dismiss a
  // popover is expected to have. The opening click already fired before this
  // mounted, so it never self-dismisses; clicks on the two buttons are inside.
  function onOutside(e: PointerEvent) {
    if (popover && e.target instanceof Node && !popover.contains(e.target)) onCancel();
  }
</script>

<svelte:window onpointerdown={onOutside} />

<div
  class="confirm-popover align-{align}"
  class:portaled={anchor}
  bind:this={popover}
  use:portal
  style:position={anchor ? "fixed" : null}
  style:top={anchor && posTop !== undefined ? `${posTop}px` : null}
  style:left={anchor && posLeft !== undefined ? `${posLeft}px` : null}
  style:--tail-left={anchor && tailLeft !== undefined ? `${tailLeft}px` : null}
  role="alertdialog"
  aria-label={question}
  tabindex="-1"
  onkeydown={onKey}
>
  <p class="question">{question}</p>
  <div class="actions">
    <button class="cancel" type="button" onclick={onCancel}>{cancelLabel}</button>
    <button class="confirm" type="button" bind:this={confirmEl} onclick={onConfirm}>
      {confirmLabel}
    </button>
  </div>
  <span class="tail" aria-hidden="true"></span>
</div>

<style>
  /* Anchored to the trigger's position:relative wrapper, floating just BELOW the
     button and out of flow (so it never grows the library-reserved annotation
     row — the height constraint SourceComposer's reveal note calls out). Below,
     not above, keeps the thing being dropped — the draft, the comment — visible
     while the reviewer decides. It sits over the same --paper-raised surface as
     the composer/card, so --pop-bg takes the chip fill — the same step lighter the
     topbar's chips ride — to read as its own floating layer rather than melting
     into what it covers. */
  .confirm-popover {
    --pop-bg: var(--chip);
    /* Pin the sans stack explicitly: in anchor mode the bubble portals to
       document.body — outside #app and the diff view's slotted content — so it
       can't rely on inheriting a font-family from either. Without this it fell
       back to the UA serif in the Request Changes dialog while the in-flow
       card/composer bubbles read sans, so the three looked like different popups
       (EXC-765). One font here keeps every discard confirmation identical. */
    font-family: var(--font-sans);
    position: absolute;
    top: calc(100% + 0.5rem);
    z-index: 20;
    width: max-content;
    max-width: 15rem;
    padding: 0.6rem 0.7rem 0.55rem;
    background: var(--pop-bg);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    /* One-shot pop, matching the chrome's ≤200ms one-shot vocabulary. Being
       out of flow, a small lift is safe here (unlike the composer's in-flow
       reveal). The global reduced-motion rule in app.css collapses it. */
    animation: pop var(--dur-micro) var(--ease-out);
    transform-origin: top var(--pop-origin, right);
  }
  .align-end {
    right: 0;
    --pop-origin: right;
  }
  .align-start {
    left: 0;
    --pop-origin: left;
  }
  /* Portaled (anchor mode): fixed coords come from inline styles set in the
     effect, so neutralize the in-flow align offsets and pin the transform origin
     to the top (it can flip either side after clamping). Portaled to document.body,
     it sits OUTSIDE the dialog's stacking context, so its in-flow z-index (20) now
     lands under the dialog overlay (z-50) and the backdrop would eat the confirm
     click — lift it above the whole dialog layer. */
  .confirm-popover.portaled {
    right: auto;
    z-index: 60;
    /* bits-ui's dialog scroll-lock sets pointer-events:none on <body>, which this
       portaled child inherits — without re-enabling it, every click falls through
       to the backdrop and the confirm buttons are dead. The dialog content does
       the same for itself. */
    pointer-events: auto;
    --pop-origin: center;
  }
  /* The tail's "pops out of the button" cue only reads when the bubble sits
     directly under its trigger. Once portaled + clamped it can land anywhere, so
     drop the tail rather than let it point at nothing. */
  .confirm-popover.portaled .tail {
    display: none;
  }
  .confirm-popover:focus {
    outline: none;
  }
  .question {
    margin: 0 0 0.5rem;
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: var(--leading-snug);
    color: var(--ink);
    white-space: nowrap;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .cancel,
  .confirm {
    border-radius: var(--radius);
    font-size: var(--text-sm);
    font-weight: 600;
    padding: 0.3rem 0.7rem;
    cursor: pointer;
  }
  /* Quiet back-out — never competes with the destructive confirm. */
  .cancel {
    background: transparent;
    color: var(--ink-soft);
    border: 1px solid var(--rule);
  }
  .cancel:hover {
    color: var(--ink);
    border-color: var(--rule-strong);
  }
  /* The destructive completion, in caret's danger red so "yes" reads as the
     irreversible act it is. */
  .confirm {
    background: var(--danger);
    color: var(--accent-ink);
    border: 1px solid var(--danger);
  }
  .confirm:hover {
    filter: brightness(1.08);
  }
  /* The tail that makes it read as popping *out of* the button, sitting at the
     anchored edge and pointing up at the trigger above it. A rotated square
     wearing the bubble's own fill + border shows only its two upper sides. */
  .tail {
    position: absolute;
    bottom: 100%;
    width: 0.55rem;
    height: 0.55rem;
    margin-bottom: -0.3rem;
    background: var(--pop-bg);
    border-left: 1px solid var(--rule-strong);
    border-top: 1px solid var(--rule-strong);
    transform: rotate(45deg);
  }
  .align-end .tail {
    right: 1rem;
  }
  .align-start .tail {
    left: 1rem;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.97);
    }
  }
</style>
