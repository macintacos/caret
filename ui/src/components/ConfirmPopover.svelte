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
  // ponytail: pops straight down with no collision-flip — a confirm opened on a
  // row hard against the viewport bottom can clip; add flip logic if that surfaces.
  import { isCancelKey } from "../lib/keys.ts";

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
    onConfirm: () => void;
    onCancel: () => void;
  }
  let { question, confirmLabel, cancelLabel = "Cancel", align = "end", onConfirm, onCancel }: Props =
    $props();

  let popover = $state<HTMLDivElement | undefined>();
  let confirmEl = $state<HTMLButtonElement | undefined>();

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
  bind:this={popover}
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
     the composer/card, so --pop-bg lifts it a step lighter to read as its own
     floating layer rather than melting into what it covers. */
  .confirm-popover {
    --pop-bg: color-mix(in srgb, var(--paper-raised), var(--ink) 8%);
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
    animation: pop var(--dur-fast) var(--ease-out);
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
