<script lang="ts">
  // A small confirmation that pops out of the button that triggered it (EXC-749),
  // for the destructive, no-undo inline-comment actions: discarding a draft
  // (SourceComposer), deleting a submitted comment (SourceAnnotationCard), and
  // discarding either from the Request Changes dialog.
  //
  // Built on the vendored `popover` (EXC-1110), so bits-ui and Floating UI own the
  // geometry: portalling out of any scrollable ancestor, anchoring to the trigger,
  // flipping above it when it would run off the bottom, shifting off a viewport
  // edge, Escape, and outside-click. Neither of those dismissals calls onConfirm —
  // backing out of a destructive prompt can only ever cancel.
  //
  // Floating UI's autoUpdate TRACKS the anchor through a scroll, where the previous
  // hand-rolled version closed on any scroll or resize. That was a limitation, not a
  // preference: a `fixed` bubble measured once could not follow a moving anchor, so
  // it backed out rather than drift. Tracking is the better answer for a prompt the
  // reviewer just opened — dismissing it because they nudged the wheel throws away
  // the intent they expressed and is behaviour no other caret popover has.
  //
  // The trigger arrives as a snippet, so the popover owns its own open state and the
  // hosts no longer carry a `confirming` flag, a captured anchor element, or a
  // position:relative wrapper. It is also what makes focus restoration free: bits-ui
  // tracks the trigger node and hands focus back to it on dismiss.
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
      // focus, so a keyboard reviewer can complete the action they initiated with a
      // bare Enter. preventScroll matches the annotation row's other focus moves
      // (the composer's autofocus, slotInto's focus restore): the bubble sits out of
      // flow, so a plain focus() would scroll the diff to it. Suppressed only once
      // there is a button to hand focus to — preventing the default with nothing to
      // receive it strands focus on the body, which loses Escape-to-close.
      if (confirmEl === null) return;
      e.preventDefault();
      confirmEl.focus({ preventScroll: true });
    }}
  >
    <p class="question">{question}</p>
    <div class="actions">
      <Popover.Close class="cancel">{cancelLabel}</Popover.Close>
      <!-- Deliberately NOT a Popover.Close, unlike Cancel. Popover.Close handles
           Enter/Space itself and calls preventDefault, so the native click never
           fires and an onclick on it is silently skipped on keyboard activation —
           the bubble would close without confirming, which on a destructive guard
           reads to the reviewer as a completed action. A plain button keeps Enter,
           Space and the pointer on one path. -->
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
     the vendored Popover.Content's own Tailwind utilities, which is what lets the
     panel drop w-72 and the popover surface for caret's own.

     It sits over the same --paper-raised surface as the composer/card, so --pop-bg
     takes the chip fill — the same step lighter the topbar's chips ride — to read as
     its own floating layer rather than melting into what it covers. */
  :global(.confirm-popover) {
    --pop-bg: var(--chip);
    /* Pin the sans stack explicitly: the bubble is portalled to the body — outside
       #app and the diff view's slotted content — so it can't rely on inheriting a
       font-family from either. Without this it fell back to the UA serif in the
       Request Changes dialog while the in-flow bubbles read sans, so the three
       looked like different popups (EXC-765). */
    font-family: var(--font-sans);
    width: max-content;
    max-width: 15rem;
    gap: 0;
    padding: 0.6rem 0.7rem 0.55rem;
    background: var(--pop-bg);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    /* The arrival and departure, REFINED rather than replaced (the EXC-1107 lesson
       PlanToc records at length): Popover.Content already carries tw-animate-css's
       animate-in / animate-out keyed on data-[state=…], and bits-ui's portal
       presence waits on the animationend those keyframes fire — so an `animation`
       shorthand of caret's own would replace them and strand the bubble in the DOM
       on close. Only the two custom properties the utility reads are overridden, so
       the keyframes and the animationend survive untouched.
       The micro tier, not the surface tier the 20rem ToC panel takes: a popover this
       small pops rather than rises, which is the tier its own motion has always had.
       Reduced motion is not handled here — the single global rule in app.css reaches
       it through the [data-slot] anchor and collapses the duration rather than
       removing the keyframes, which is what keeps the animationend firing. */
    --tw-duration: var(--dur-micro);
    --tw-ease: var(--ease-out);
  }
  :global(.confirm-popover[data-state="closed"]) {
    --tw-duration: var(--dur-exit);
    --tw-ease: var(--ease-in);
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
     wearing the bubble's own fill + border, showing only the two sides that face the
     trigger. It sits at the aligned edge, matching align="start".
     Floating UI can shift the panel horizontally off a viewport edge, which decouples
     the tail from the trigger's centre — no worse than before, where the whole tail
     was dropped the moment the bubble was clamped. */
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
