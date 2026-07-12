<script lang="ts">
  import type { IconName } from "../lib/icons.ts";
  import { isCancelKey } from "../lib/keys.ts";
  import Icon from "./Icon.svelte";

  interface Props {
    /** Non-blank pending comments — always > 0 when this dialog renders. */
    count: number;
    /** The lossy action's label, e.g. "Approve" or "Reject". Drives the title,
     * eyebrow, aria-label, and the confirm button's "{action} anyway". */
    action: string;
    /** One-line consequence specific to the action, shown after the count. */
    consequence: string;
    /** Optional glyph for the confirm button (omit for a text-only action). */
    icon?: IconName;
    onConfirm: () => void;
    onRequestChanges: () => void;
    onCancel: () => void;
  }
  let { count, action, consequence, icon, onConfirm, onRequestChanges, onCancel }: Props = $props();

  let dialog = $state<HTMLDivElement | undefined>();

  // Focus the dialog so Escape/Enter land here, not on the button left behind it.
  $effect(() => {
    dialog?.focus();
  });

  function onKey(e: KeyboardEvent) {
    if (isCancelKey(e)) onCancel();
    // Plain Enter confirms the primary path. The dialog holds no text input, so a
    // bare Enter is unambiguous; it mirrors the focused primary button's Activate.
    else if (e.key === "Enter") onConfirm();
  }
</script>

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && onCancel()}>
  <div
    class="dialog"
    bind:this={dialog}
    role="dialog"
    aria-modal="true"
    aria-label="{action} with pending comments"
    tabindex="-1"
    onkeydown={onKey}
  >
    <header>
      <span class="eyebrow">{action}</span>
      <h2>{action} without sending your comments?</h2>
    </header>

    <p class="body">
      You have {count} pending comment{count === 1 ? "" : "s"} that won't be sent. {consequence}
    </p>

    <footer>
      <button class="ghost" onclick={onCancel}>Cancel</button>
      <button class="to-request" onclick={onRequestChanges}>
        <Icon name="corner-up-left" size={14} />
        Request changes
      </button>
      <button class="confirm" onclick={onConfirm}>
        {#if icon}<Icon name={icon} size={14} />{/if}
        {action} anyway
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
    animation: fade var(--dur-fast) var(--ease-out);
  }
  .dialog {
    width: min(460px, 100%);
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    padding: 1.5rem;
    animation: rise var(--dur-base) var(--ease-out);
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
  .confirm {
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
  .confirm {
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
  }
  .confirm:hover {
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
