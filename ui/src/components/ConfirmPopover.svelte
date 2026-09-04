<script lang="ts">
  // A small confirmation that pops out of the button that triggered it (EXC-749),
  // for the destructive, no-undo inline-comment actions.
  //
  // Built on the vendored `popover` (EXC-1110), so bits-ui and Floating UI own the
  // geometry: portalling out of any scrollable ancestor, anchoring to the trigger,
  // flipping, shifting off a viewport edge, Escape, and outside-click. Neither
  // dismissal calls onConfirm — backing out of a destructive prompt can only cancel.
  //
  // A scroll TRACKS the anchor (Floating UI's autoUpdate) rather than dismissing the
  // bubble, which is the deliberate call for a destructive prompt: dropping one
  // because the reviewer nudged the wheel throws away the intent they just expressed.
  // No other caret popover behaves that way.
  //
  // The trigger arrives as a snippet, so the popover owns its own open state — the
  // hosts carry no `confirming` flag, no captured anchor element, and no
  // position:relative wrapper — and bits-ui hands focus back to it on dismiss.
  import type { Snippet } from "svelte";

  import * as Popover from "$lib/components/ui/popover/index.js";

  interface Props {
    /** The yes/no question, e.g. "Discard this comment?". Also the aria-label. */
    question: string;
    /** The destructive action's verb, e.g. "Discard" / "Delete". */
    confirmLabel: string;
    /** The back-out label; defaults to "Cancel". */
    cancelLabel?: string;
    /** The control that opens the confirmation. Receives bits-ui's trigger props —
     * spread them onto the host's own button so it stays the host's control, with
     * the popover's aria-expanded / aria-controls wiring on top. */
    trigger: Snippet<[Record<string, unknown>]>;
    onConfirm: () => void;
  }
  let { question, confirmLabel, cancelLabel = "Cancel", trigger, onConfirm }: Props = $props();

  let open = $state(false);
  let confirmEl = $state<HTMLButtonElement | null>(null);
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      {@render trigger(props)}
    {/snippet}
  </Popover.Trigger>
  <!-- align="start" because every host anchors to a left-aligned action; sideOffset
       matches the 0.5rem gap the bubble has always sat at. -->
  <Popover.Content
    class="confirm-popover"
    align="start"
    sideOffset={8}
    role="alertdialog"
    aria-label={question}
    onOpenAutoFocus={(e) => {
      // Focus the confirm button rather than the panel bits-ui would otherwise
      // focus, so a keyboard reviewer completes the action with a bare Enter.
      // preventScroll because the bubble sits out of flow and a plain focus() would
      // scroll the diff to it. Suppressed only once there is a button to hand focus
      // to — preventing the default with nothing to receive it strands focus on the
      // body, which loses Escape-to-close.
      if (confirmEl === null) return;
      e.preventDefault();
      confirmEl.focus({ preventScroll: true });
    }}
  >
    <p class="question">{question}</p>
    <div class="actions">
      <Popover.Close class="cancel">{cancelLabel}</Popover.Close>
      <!-- Deliberately NOT a Popover.Close, unlike Cancel: it handles Enter/Space
           itself and calls preventDefault, so the native click never fires and an
           onclick on it is silently skipped on keyboard activation — the bubble would
           close without confirming, which reads as a completed action. A plain button
           keeps Enter, Space and the pointer on one path. -->
      <button
        class="confirm"
        type="button"
        bind:this={confirmEl}
        onclick={() => {
          open = false;
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
    </div>
    <span class="tail" aria-hidden="true"></span>
  </Popover.Content>
</Popover.Root>

<style>
  /* The bubble renders outside this component's style scope — bits-ui teleports it
     to the body — so every rule here is :global and anchored on .confirm-popover,
     the same shape PlanToc uses for .plan-toc-panel. Being unlayered, they also beat
     the vendored Popover.Content's own Tailwind utilities, which is what lets it drop
     w-72 and swap the vendored popover surface for caret's own.

     It sits over the same --paper-raised surface as the composer/card, so --pop-bg
     takes the chip fill to read as its own floating layer rather than melting into
     what it covers.

     The --tw-* pair below retimes the vendored animation rather than replacing it
     (svelte-rules.md § Motion principles carries the worked example). The tier here
     is micro, taken SYMMETRICALLY — one rule, no closed-state arm — because a popover
     this small pops rather than rises, and --dur-exit would make it leave SLOWER than
     it arrives. Both of base.css's default arms sit at specificity zero, so this
     single rule governs open and closed alike. */
  :global(.confirm-popover) {
    --pop-bg: var(--chip);
    /* Pin the sans stack explicitly: the bubble is portalled to the body — outside
       #app and the diff view's slotted content — so it inherits no font-family.
       Without this it fell back to the UA serif in the Request Changes dialog while
       the in-flow bubbles read sans (EXC-765). */
    font-family: var(--font-sans);
    width: max-content;
    max-width: 15rem;
    gap: 0;
    padding: 0.6rem 0.7rem 0.55rem;
    background: var(--pop-bg);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    --tw-duration: var(--dur-micro);
    --tw-ease: var(--ease-out);
  }
  :global(.confirm-popover .question) {
    margin: 0 0 0.5rem;
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: var(--leading-snug);
    color: var(--ink);
    white-space: nowrap;
  }
  :global(.confirm-popover .actions) {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  :global(.confirm-popover .cancel),
  :global(.confirm-popover .confirm) {
    border-radius: var(--radius);
    font-size: var(--text-sm);
    font-weight: 600;
    padding: 0.3rem 0.7rem;
    cursor: pointer;
  }
  /* Quiet back-out — never competes with the destructive confirm. */
  :global(.confirm-popover .cancel) {
    background: transparent;
    color: var(--ink-soft);
    border: 1px solid var(--rule);
  }
  :global(.confirm-popover .cancel:hover) {
    color: var(--ink);
    border-color: var(--rule-strong);
  }
  /* The destructive completion, in caret's danger red so "yes" reads as the
     irreversible act it is. */
  :global(.confirm-popover .confirm) {
    background: var(--danger);
    color: var(--accent-ink);
    border: 1px solid var(--danger);
  }
  :global(.confirm-popover .confirm:hover) {
    filter: brightness(1.08);
  }
  /* The tail that makes it read as popping *out of* the button: a rotated square
     wearing the bubble's own fill + border, at the aligned edge to match
     align="start".
     Known ceiling: Floating UI can shift the panel horizontally to clear a viewport
     edge and the tail does not follow, so against an edge it stops pointing exactly
     at the trigger. Accepted rather than fixed — tracking the shift means bits-ui's
     Popover.Arrow, which the shadcn registry's popover tree does not ship, so
     vendoring one is exactly the local addition a re-sync drops silently. */
  :global(.confirm-popover .tail) {
    position: absolute;
    left: 1rem;
    bottom: 100%;
    width: 0.55rem;
    height: 0.55rem;
    margin-bottom: -0.3rem;
    background: var(--pop-bg);
    border-left: 1px solid var(--rule-strong);
    border-top: 1px solid var(--rule-strong);
    transform: rotate(45deg);
  }
  /* Flipped above the trigger (no room below): the tail moves to the bottom edge and
     shows its two lower sides so it still points AT the button. */
  :global(.confirm-popover[data-side="top"] .tail) {
    top: 100%;
    bottom: auto;
    margin-top: -0.3rem;
    margin-bottom: 0;
    border-left: none;
    border-top: none;
    border-right: 1px solid var(--rule-strong);
    border-bottom: 1px solid var(--rule-strong);
  }
</style>
