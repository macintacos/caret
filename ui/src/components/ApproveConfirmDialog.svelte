<script lang="ts">
  import { isCancelKey } from "../lib/keys.ts";
  import Icon from "./Icon.svelte";

  interface Props {
    /** Non-blank inline comments pending — always > 0 when this dialog renders. */
    count: number;
    onApproveAnyway: () => void;
    onRequestChanges: () => void;
    onCancel: () => void;
  }
  let { count, onApproveAnyway, onRequestChanges, onCancel }: Props = $props();

  let dialog = $state<HTMLDivElement | undefined>();

  // Focus the dialog so Escape/Enter land here, not on the button left behind it.
  $effect(() => {
    dialog?.focus();
  });

  function onKey(e: KeyboardEvent) {
    if (isCancelKey(e)) onCancel();
    // Plain Enter confirms the primary path. The dialog holds no text input, so a
    // bare Enter is unambiguous; it mirrors the focused primary button's Activate.
    else if (e.key === "Enter") onApproveAnyway();
  }
</script>

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && onCancel()}>
  <div
    class="dialog"
    bind:this={dialog}
    role="dialog"
    aria-modal="true"
    aria-label="Approve with pending comments"
    tabindex="-1"
    onkeydown={onKey}
  >
    <header>
      <span class="eyebrow">Approve</span>
      <h2>Approve without sending your comments?</h2>
    </header>

    <p class="body">
      You have {count} pending comment{count === 1 ? "" : "s"} that won't be sent on approve.
      Approving accepts the plan and leaves them behind.
    </p>

    <footer>
      <button class="ghost" onclick={onCancel}>Cancel</button>
      <button class="to-request" onclick={onRequestChanges}>
        <Icon name="corner-up-left" size={14} />
        Request changes
      </button>
      <button class="approve-anyway" onclick={onApproveAnyway}>
        <Icon name="check" size={14} />
        Approve anyway
      </button>
    </footer>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: color-mix(in srgb, var(--paper-sunk) 70%, rgba(0, 0, 0, 0.4));
    backdrop-filter: blur(3px);
    display: grid;
    place-items: center;
    padding: 2rem;
    animation: fade 0.15s ease-out;
  }
  /* The accent left-bar is the source-view surface's signature for an actionable
     card; the approve-guard dialog carries it too so the modal reads as part of
     the same review vocabulary as RequestChangesDialog. */
  .dialog {
    width: min(460px, 100%);
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    padding: 1.5rem;
    animation: rise 0.18s ease-out;
  }
  .dialog:focus {
    outline: none;
  }
  header {
    margin-bottom: 1rem;
  }
  .eyebrow {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  h2 {
    font-weight: 500;
    /* Display one-off: the dialog title sits above the chrome type scale. */
    font-size: 1.35rem;
    margin: 0.25rem 0 0;
    color: var(--ink);
  }
  .body {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-snug);
    color: var(--ink-soft);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 1.5rem;
  }
  .ghost,
  .to-request,
  .approve-anyway {
    border-radius: var(--radius);
    font-size: var(--text-base);
    font-weight: 600;
    padding: 0.5rem 1rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .ghost {
    background: transparent;
    color: var(--ink-soft);
    border: 1px solid var(--rule);
  }
  .ghost:hover {
    color: var(--ink);
  }
  .to-request {
    background: transparent;
    color: var(--ink-soft);
    border: 1px solid var(--rule);
  }
  .to-request:hover {
    color: var(--ink);
    border-color: var(--rule-strong);
  }
  .approve-anyway {
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
  }
  .approve-anyway:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.99);
    }
  }
</style>
