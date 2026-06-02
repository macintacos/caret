<script lang="ts">
  import type { Annotation } from "../lib/types.ts";
  import { formatFeedback } from "../lib/feedback.ts";

  interface Props {
    annotations: Annotation[];
    onSubmit: (generalComment: string) => void;
    onCancel: () => void;
  }
  let { annotations, onSubmit, onCancel }: Props = $props();

  let general = $state("");
  let textarea = $state<HTMLTextAreaElement | undefined>();

  // Live preview of exactly what the agent will receive.
  let preview = $derived(formatFeedback(annotations, general));
  let inlineCount = $derived(
    annotations.filter((a) => a.comment.trim().length > 0).length,
  );

  $effect(() => {
    textarea?.focus();
  });

  function submit() {
    onSubmit(general.trim());
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") onCancel();
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
  }
</script>

<div
  class="scrim"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onCancel()}
>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label="Request changes"
    tabindex="-1"
    onkeydown={onKey}
  >
    <header>
      <span class="eyebrow">Request changes</span>
      <h2>Send the plan back for revision</h2>
    </header>

    <label class="field">
      <span class="lbl">General comment</span>
      <textarea
        bind:this={textarea}
        bind:value={general}
        rows="4"
        placeholder="Describe the overall changes you want…"
      ></textarea>
    </label>

    <div class="summary mono">
      {inlineCount} inline comment{inlineCount === 1 ? "" : "s"} will be included.
    </div>

    {#if preview}
      <details class="preview">
        <summary>Preview feedback sent to the agent</summary>
        <pre>{preview}</pre>
      </details>
    {/if}

    <footer>
      <button class="ghost" onclick={onCancel}>Cancel</button>
      <button class="deny" onclick={submit} disabled={!preview}>
        Send for revision <span class="kbd">⌘↵</span>
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
  .dialog {
    width: min(560px, 100%);
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    padding: 1.5rem;
    animation: rise 0.18s ease-out;
  }
  header {
    margin-bottom: 1.25rem;
  }
  h2 {
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 1.35rem;
    margin: 0.25rem 0 0;
    color: var(--ink);
  }
  .field {
    display: block;
  }
  .lbl {
    display: block;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin-bottom: 0.4rem;
  }
  textarea {
    width: 100%;
    resize: vertical;
    font-family: var(--font-body);
    font-size: 1rem;
    line-height: 1.5;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: 0.6rem 0.7rem;
  }
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .summary {
    color: var(--ink-faint);
    margin-top: 0.6rem;
  }
  .preview {
    margin-top: 1rem;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper-sunk);
  }
  .preview summary {
    cursor: pointer;
    padding: 0.5rem 0.7rem;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    color: var(--ink-soft);
  }
  .preview pre {
    margin: 0;
    padding: 0.5rem 0.8rem 0.8rem;
    font-family: var(--font-mono);
    font-size: 0.76rem;
    line-height: 1.5;
    white-space: pre-wrap;
    color: var(--ink);
    border-top: 1px solid var(--rule);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 1.5rem;
  }
  .ghost,
  .deny {
    border-radius: var(--radius);
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.5rem 1rem;
  }
  .ghost {
    background: transparent;
    color: var(--ink-soft);
    border: 1px solid var(--rule);
  }
  .ghost:hover {
    color: var(--ink);
  }
  .deny {
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .deny:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .deny:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .kbd {
    font-size: 0.7rem;
    opacity: 0.75;
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
