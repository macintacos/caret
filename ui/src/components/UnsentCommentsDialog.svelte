<script lang="ts">
  import type { PendingItem } from "../lib/feedback.ts";
  import type { IconName } from "../lib/icons.ts";
  import { isCancelKey } from "../lib/keys.ts";
  import Icon from "./Icon.svelte";

  interface Props {
    /** The unsent feedback a plain confirm would leave behind — the general-comment
     * draft, committed inline comments, and unsent scratches — each a short anchor
     * label plus its text. When empty the dialog is a plain "are you sure?" confirm
     * (Reject always confirms, EXC-685); when non-empty it previews the items and
     * guards them from being silently dropped. */
    items: PendingItem[];
    /** The verdict's label, e.g. "Approve" or "Reject". Drives the title,
     * eyebrow, aria-label, and the confirm button. */
    action: string;
    /** One-line sentence describing what the verdict does, always shown. */
    consequence: string;
    /** Optional glyph for the confirm button (omit for a text-only action). */
    icon?: IconName;
    onConfirm: () => void;
    onRequestChanges: () => void;
    onCancel: () => void;
  }
  let { items, action, consequence, icon, onConfirm, onRequestChanges, onCancel }: Props = $props();

  let dialog = $state<HTMLDivElement | undefined>();
  // With queued comments the dialog previews them and guards against dropping
  // them; with none it's a bare confirmation. The count drives the "won't be
  // sent" warning; the label, the Request-changes divert, and the "anyway"
  // wording all key off whether any are pending.
  let count = $derived(items.length);
  let hasComments = $derived(count > 0);
  let label = $derived(hasComments ? `${action} with pending comments` : `${action} this plan`);

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
    aria-label={label}
    tabindex="-1"
    onkeydown={onKey}
  >
    <header>
      <span class="eyebrow">{action}</span>
      <h2>{action} this plan?</h2>
    </header>

    <p class="body">
      {consequence}
      {#if hasComments}
        You have {count} pending comment{count === 1 ? "" : "s"} that won't be sent.
      {/if}
    </p>

    {#if hasComments}
      <!-- A preview of exactly what a plain confirm would leave behind, so the
           reviewer sees their unsent work before deciding. Each row pairs a short
           anchor (the general note, a line reference, or an unsent draft's range)
           with the comment text, clamped so a long comment stays a scan-line. -->
      <ul class="comments" aria-label="Your unsent comments">
        {#each items as item, i (i)}
          <li class="comment">
            <span class="anchor metric">{item.label}</span>
            <span class="text">{item.text}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <footer>
      <button class="ghost" onclick={onCancel}>Cancel</button>
      {#if hasComments}
        <button class="to-request" onclick={onRequestChanges}>
          <Icon name="corner-up-left" size={14} />
          Request changes
        </button>
      {/if}
      <button class="confirm" onclick={onConfirm}>
        {#if icon}<Icon name={icon} size={14} />{/if}
        {hasComments ? `${action} anyway` : action}
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
  /* Preview of the unsent feedback: a quiet sunk container in the same idiom as
     the RequestChangesDialog preview — no accent (reserved for actions), muted
     ink, hairline row dividers — reading as "here's what you'd leave behind"
     rather than a call to action. Height-capped and scrollable so a long queue
     never grows the dialog past the viewport. */
  .comments {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0.1rem 0.6rem;
    max-height: 8.5rem;
    overflow-y: auto;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper-sunk);
  }
  .comment {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
    padding: 0.5rem 0;
  }
  .comment + .comment {
    border-top: 1px solid var(--rule);
  }
  /* The anchor lead: "General", "Line 7", "Lines 4–6" — the tabular metric face
     the rest of the review's line references use, sized down and fixed-width so
     the comment column aligns down the list. */
  .anchor {
    flex: none;
    min-width: 3.5rem;
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--ink-faint);
  }
  .text {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    color: var(--ink-soft);
    /* Clamp a long comment to two lines here — the full text is one click away in
       Request changes; the preview only needs it recognizable. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: pre-wrap;
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
