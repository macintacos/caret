<script lang="ts">
  // Inline comment composer for the source-view surface, anchored at the line a
  // reviewer chose from the gutter. Positioned absolutely at the line's vertical
  // offset within the scroll container; submitting creates a line-anchored
  // annotation, Esc cancels, Cmd/Ctrl+Enter submits. Keyboard-accessible: it
  // grabs focus on open and traps Escape/submit chords on its own subtree.
  import { isCancelKey, isSubmitChord } from "../lib/keys.ts";
  import Icon from "./Icon.svelte";

  interface Props {
    /** First annotated line (1-based, inclusive). */
    startLine: number;
    /** Last annotated line (1-based, inclusive). */
    endLine: number;
    /** Vertical offset (px) of the anchored line within the scroll container. */
    top: number;
    onSubmit: (comment: string) => void;
    onCancel: () => void;
  }
  let { startLine, endLine, top, onSubmit, onCancel }: Props = $props();

  let comment = $state("");
  let textarea = $state<HTMLTextAreaElement | undefined>();

  // Focus the input the moment the composer mounts so a keyboard-only reviewer
  // can type immediately after triggering the gutter `+`.
  $effect(() => {
    textarea?.focus();
  });

  const label = $derived(
    startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`,
  );

  function submit() {
    onSubmit(comment);
  }

  function onKey(e: KeyboardEvent) {
    if (isCancelKey(e)) {
      e.preventDefault();
      onCancel();
    } else if (isSubmitChord(e)) {
      e.preventDefault();
      submit();
    }
  }
</script>

<div
  class="composer"
  style="top: {top}px;"
  role="dialog"
  aria-label="Add a comment"
  tabindex="-1"
  onkeydown={onKey}
>
  <p class="label">{label}</p>
  <textarea
    bind:this={textarea}
    bind:value={comment}
    rows="3"
    placeholder="What should change here?"
    aria-label="Comment"
  ></textarea>
  <div class="row">
    <button class="ghost" type="button" onclick={onCancel}>Cancel</button>
    <button
      class="solid"
      type="button"
      onclick={submit}
      aria-keyshortcuts="Meta+Enter Control+Enter"
    >
      Comment
      <span class="kbd" aria-hidden="true">
        <Icon name="command" size={12} /><Icon name="corner-down-left" size={12} />
      </span>
    </button>
  </div>
</div>

<style>
  .composer {
    position: absolute;
    left: 3.5rem;
    z-index: 40;
    width: 320px;
    max-width: calc(100% - 4rem);
    padding: 0.7rem 0.75rem 0.6rem;
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    animation: pop 0.14s ease-out;
  }
  .label {
    margin: 0 0 0.4rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--ink-soft);
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font-size: 0.88rem;
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
    margin-top: 0.55rem;
  }
  .ghost,
  .solid {
    border-radius: var(--radius);
    font-size: 0.76rem;
    font-weight: 600;
    padding: 0.35rem 0.75rem;
  }
  .ghost {
    background: transparent;
    color: var(--ink-soft);
    border: 1px solid var(--rule);
  }
  .ghost:hover {
    color: var(--ink);
    border-color: var(--rule-strong);
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
      transform: scale(0.97) translateY(2px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
</style>
