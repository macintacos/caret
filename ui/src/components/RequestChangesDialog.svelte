<script lang="ts">
  import type { Annotation } from "@core/types";
  import { formatFeedback, pendingInlineCount, pendingLineCount } from "../lib/feedback.ts";
  import { isCancelKey, isSubmitChord } from "../lib/keys.ts";
  import Icon from "./Icon.svelte";

  interface Props {
    annotations: Annotation[];
    // The general comment is lifted into App.svelte (autosaved per review), so
    // it survives the dialog unmounting on Cancel/Escape/scrim. The dialog is a
    // controlled view over the parent's value.
    generalComment: string;
    // The active review's current plan text, so the preview quotes a
    // line-anchored annotation's source lines exactly as the agent will see them.
    planText: string;
    onGeneralCommentInput: (value: string) => void;
    onSubmit: (generalComment: string) => void;
    onCancel: () => void;
  }
  let { annotations, generalComment, planText, onGeneralCommentInput, onSubmit, onCancel }: Props =
    $props();

  let textarea = $state<HTMLTextAreaElement | undefined>();

  // Live preview of exactly what the agent will receive.
  let preview = $derived(formatFeedback(annotations, generalComment, planText));
  let inlineCount = $derived(pendingInlineCount(annotations));
  // Distinct source locations the pending comments anchor to; only worth showing
  // when it's smaller than the comment count (several comments share a line),
  // otherwise "N comments on N lines" just restates the count.
  let lineCount = $derived(pendingLineCount(annotations));
  // The dialog has nothing to send: no inline comments and a blank general note.
  // Shows a nudge instead of a hollow "0 comments" tally.
  let empty = $derived(inlineCount === 0 && generalComment.trim().length === 0);
  // The inline-comment tally, collapsing the redundant "on M lines" when each
  // comment sits on its own location.
  let countSummary = $derived(
    lineCount > 0 && lineCount < inlineCount
      ? `${inlineCount} comments on ${lineCount} line${lineCount === 1 ? "" : "s"} will be included.`
      : `${inlineCount} comment${inlineCount === 1 ? "" : "s"} will be included.`,
  );

  $effect(() => {
    textarea?.focus();
  });

  function submit() {
    onSubmit(generalComment.trim());
  }
  function onKey(e: KeyboardEvent) {
    if (isCancelKey(e)) onCancel();
    else if (isSubmitChord(e)) submit();
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
        value={generalComment}
        oninput={(e) => onGeneralCommentInput(e.currentTarget.value)}
        rows="4"
        placeholder="Describe the overall changes you want…"
      ></textarea>
    </label>

    <div class="summary" class:empty>
      {#if empty}
        No comments yet — add inline comments or a general note to send.
      {:else}
        {countSummary}
      {/if}
    </div>

    {#if preview}
      <details class="preview">
        <summary>Preview feedback sent to the agent</summary>
        <pre>{preview}</pre>
      </details>
    {/if}

    <footer>
      <button class="ghost" onclick={onCancel}>Cancel</button>
      <button
        class="deny"
        onclick={submit}
        disabled={!preview}
        aria-keyshortcuts="Meta+Enter Control+Enter"
      >
        Send for revision
        <span class="kbd" aria-hidden="true">
          <Icon name="command" size={12} /><Icon name="corner-down-left" size={12} />
        </span>
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
    /* Scrim fade on the fast tier; the dialog rises a step slower (--dur-base).
       The global reduced-motion rule in app.css collapses both to a static
       frame when the OS asks. */
    animation: fade var(--dur-fast) var(--ease-out);
  }
  /* The accent left-bar is the source-view surface's signature for an actionable
     card (composer, annotation); the request-changes dialog carries it too so the
     modal reads as part of the same review vocabulary. */
  .dialog {
    width: min(560px, 100%);
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    padding: 1.5rem;
    animation: rise var(--dur-base) var(--ease-out);
  }
  header {
    margin-bottom: 1.25rem;
  }
  h2 {
    font-weight: 500;
    /* Display one-off: the dialog title sits above the chrome type scale. */
    font-size: 1.35rem;
    margin: 0.25rem 0 0;
    color: var(--ink);
  }
  .field {
    display: block;
  }
  .lbl {
    display: block;
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin-bottom: 0.4rem;
  }
  textarea {
    width: 100%;
    resize: vertical;
    font-size: var(--text-lg);
    line-height: var(--leading-snug);
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: 0.6rem 0.7rem;
  }
  /* The accent + accent-wash ring matches the source-view ToC filter's focus
     affordance, so every text input in the app focuses the same way. */
  textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-wash);
  }
  .summary {
    /* Matches the .mono atom's size (--text-sm) but stays in the sans face — this
       is a count summary, not code, so it takes the size without the mono font. */
    font-size: var(--text-sm);
    color: var(--ink-faint);
    margin-top: 0.6rem;
  }
  /* The empty-state nudge reads as guidance, not a tally — italic to set it apart
     from the count summary without spending a stronger ink or the accent. */
  .summary.empty {
    font-style: italic;
    color: var(--ink-soft);
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
    font-size: var(--text-xs);
    color: var(--ink-soft);
  }
  .preview pre {
    margin: 0;
    padding: 0.5rem 0.8rem 0.8rem;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
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
    font-size: var(--text-base);
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
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
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
