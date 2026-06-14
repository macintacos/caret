<script lang="ts">
  // Inline comment composer for the source-view surface. It renders in the source
  // view's per-line annotation row (the parent projects it into the library's slot
  // — see annotationSlot.ts) at the line or range the reviewer chose from the
  // gutter. Submitting creates a line-anchored annotation, Esc cancels,
  // Cmd/Ctrl+Enter submits. Keyboard-accessible: it grabs focus on open and traps
  // Escape/submit chords on its own subtree.
  import { rangeLabel } from "../lib/diffview/commenting.ts";
  import { isCancelKey, isSubmitChord } from "../lib/keys.ts";
  import Icon from "./Icon.svelte";

  interface Props {
    /** First annotated line (1-based, inclusive). */
    startLine: number;
    /** Last annotated line (1-based, inclusive). */
    endLine: number;
    onSubmit: (comment: string) => void;
    onCancel: () => void;
  }
  let { startLine, endLine, onSubmit, onCancel }: Props = $props();

  let comment = $state("");
  let textarea = $state<HTMLTextAreaElement | undefined>();

  // Focus the input the moment the composer mounts so a keyboard-only reviewer
  // can type immediately after triggering the gutter `+`. preventScroll is
  // essential: the composer opens inline at the line the reviewer just clicked
  // (already in view), and the library reserves its annotation row in the same
  // tick. A plain focus() fires the browser's native scroll-into-view against
  // that mid-rerender layout and lands the scroll container at the document
  // bottom — the "clicking a line jumps the page" bug. We never need focus to
  // scroll here, so we suppress it.
  $effect(() => {
    textarea?.focus({ preventScroll: true });
  });

  // Shared with the live drag readout (see DiffPlanView) so the preview while
  // dragging and this post-release label always read the same range.
  const label = $derived(rangeLabel(startLine, endLine));

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

<div class="composer" role="dialog" aria-label="Add a comment" tabindex="-1" onkeydown={onKey}>
  <p class="label metric">{label}</p>
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
  /* Inline within the library's annotation row — see SourceAnnotationCard's .card. */
  .composer {
    max-width: min(46rem, 100%);
    margin: 0.4rem 0 0.55rem;
    padding: 0.7rem 0.75rem 0.6rem;
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    /* One-shot reveal on the fast tier. Opacity only: the composer opens inside
       the library-reserved annotation row, so a transform that grew or shifted
       its box would change the row's measured height mid-reveal and fight the
       preventScroll guard. Fading in keeps the row's height static and reads as
       the same considered reveal as the annotation card's expand. The global
       reduced-motion rule in app.css collapses it to a static frame when the OS
       asks. */
    animation: reveal var(--dur-fast) var(--ease-out);
  }
  .label {
    margin: 0 0 0.4rem;
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--ink-soft);
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font-size: var(--text-md);
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
    font-size: var(--text-sm);
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
  @keyframes reveal {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
