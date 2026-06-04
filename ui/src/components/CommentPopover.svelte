<script lang="ts">
  // Floating "Comment" button anchored near a fresh text selection. Clicking it
  // opens an inline textarea; submitting emits the comment up to App.
  import Icon from "./Icon.svelte";

  interface Props {
    /** Viewport coordinates (from the selection's bounding rect). */
    x: number;
    y: number;
    quote: string;
    onConfirm: (comment: string) => void;
    onDismiss: () => void;
  }
  let { x, y, quote, onConfirm, onDismiss }: Props = $props();

  let editing = $state(false);
  let comment = $state("");
  let textarea = $state<HTMLTextAreaElement | undefined>();

  function open() {
    editing = true;
    queueMicrotask(() => textarea?.focus());
  }

  function submit() {
    const trimmed = comment.trim();
    if (trimmed) onConfirm(trimmed);
    else onDismiss();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }
</script>

<div
  class="popover"
  class:open={editing}
  style="left: {x}px; top: {y}px;"
  role="dialog"
  aria-label="Add a comment"
  tabindex="-1"
  onkeydown={onKey}
>
  {#if !editing}
    <button class="trigger" onclick={open}>
      <span class="caret">^</span> Comment
    </button>
  {:else}
    <div class="card">
      <p class="quote" title={quote}>&ldquo;{quote}&rdquo;</p>
      <textarea
        bind:this={textarea}
        bind:value={comment}
        placeholder="What should change here?"
        rows="3"
      ></textarea>
      <div class="row">
        <button class="ghost" onclick={onDismiss}>Cancel</button>
        <button class="solid" onclick={submit} aria-keyshortcuts="Meta+Enter Control+Enter">
          Comment
          <span class="kbd" aria-hidden="true">
            <Icon name="command" size={12} /><Icon name="corner-down-left" size={12} />
          </span>
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .popover {
    position: fixed;
    z-index: 50;
    transform: translateX(-50%) translateY(8px);
  }
  .trigger {
    background: var(--ink);
    color: var(--paper);
    border: none;
    border-radius: 99px;
    padding: 0.4rem 0.9rem;
    font-size: 0.78rem;
    font-weight: 600;
    box-shadow: var(--shadow-card);
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    animation: pop 0.14s ease-out;
  }
  .trigger:hover {
    background: var(--accent);
  }
  .caret {
    /* The ^ brand glyph keeps mono now that buttons default to sans. */
    font-family: var(--font-mono);
    color: var(--accent-bright);
    font-weight: 700;
  }
  .trigger:hover .caret {
    color: var(--accent-ink);
  }
  .card {
    width: 280px;
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    padding: 0.75rem;
    animation: pop 0.14s ease-out;
  }
  .quote {
    font-style: italic;
    font-size: 0.85rem;
    color: var(--ink-soft);
    margin: 0 0 0.5rem;
    border-left: 2px solid var(--accent);
    padding-left: 0.5rem;
    max-height: 3.4em;
    overflow: hidden;
  }
  textarea {
    width: 100%;
    resize: vertical;
    font-size: 0.9rem;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: 0.45rem 0.55rem;
  }
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .row {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .ghost,
  .solid {
    border-radius: var(--radius);
    font-size: 0.76rem;
    font-weight: 600;
    padding: 0.35rem 0.7rem;
  }
  .ghost {
    background: transparent;
    color: var(--ink-soft);
    border: 1px solid var(--rule);
  }
  .ghost:hover {
    color: var(--ink);
  }
  .solid {
    background: var(--accent);
    color: var(--accent-ink);
    border: 1px solid var(--accent);
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .solid:hover {
    background: var(--accent-bright);
  }
  .kbd {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    opacity: 0.8;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(2px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
</style>
