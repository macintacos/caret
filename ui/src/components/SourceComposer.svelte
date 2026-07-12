<script lang="ts">
  // Inline comment composer for the source-view surface. It renders in the source
  // view's per-line annotation row (the parent projects it into the library's slot
  // — see annotationSlot.ts) at the line or range the reviewer chose from the
  // gutter. Submitting (Comment / Cmd/Ctrl+Enter) creates a line-anchored
  // annotation; Discard (the button or Esc) drops the draft with no residue;
  // Keep for later stashes it as a resumable scratch. The editing surface is
  // MarkdownEditor (the swappable
  // CodeMirror boundary): it styles markdown as you type, auto-grows, owns the
  // autofocus/preventScroll guard, and reports the chords back here.
  import { untrack } from "svelte";
  import { rangeLabel } from "../lib/diffview/commenting.ts";
  import Icon from "./Icon.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";

  interface Props {
    /** First annotated line (1-based, inclusive). */
    startLine: number;
    /** Last annotated line (1-based, inclusive). */
    endLine: number;
    /** Text to pre-fill, restoring a resumed scratch draft. Default "" opens an
     * empty composer for a fresh comment. */
    initial?: string;
    onSubmit: (comment: string) => void;
    /** Discard the draft outright — the Discard button and the Esc chord. Drops
     * the text with no scratch retained, so the host closes the composer and
     * leaves no "Resume" marker. */
    onDiscard: () => void;
    /** Keep the draft for later, handing back the current text so the host retains
     * it as a resumable scratch. The "Keep for later" button; disabled when the
     * box is empty (nothing to keep). */
    onKeep: (text: string) => void;
    /** Report the live text on every edit, so the host can retain it as a scratch
     * if the composer is replaced (a new range opened) without an explicit
     * dismiss. Optional. */
    onInput?: (text: string) => void;
  }
  let { startLine, endLine, initial = "", onSubmit, onDiscard, onKeep, onInput }: Props =
    $props();

  // Seed from `initial` once, at mount: a resumed scratch mounts a fresh composer
  // with the restored text, and the reviewer edits the local copy from there.
  // untrack makes the one-time seed explicit so a later `initial` change does not
  // clobber in-progress edits. MarkdownEditor keeps this in sync via onInput.
  let comment = $state(untrack(() => initial));

  // Surface the seed and every edit to the host so it always holds the live text:
  // if the reviewer opens a different range without dismissing first, the host
  // retains this text as a scratch rather than losing it.
  $effect(() => {
    onInput?.(comment);
  });

  // Shared with the live drag readout (see DiffPlanView) so the preview while
  // dragging and this post-release label always read the same range.
  const label = $derived(rangeLabel(startLine, endLine));

  // "Keep for later" only makes sense with something to keep: an empty box has
  // nothing to stash (an empty keep and a discard behave identically), so the
  // button stays disabled until the reviewer has typed.
  const canKeep = $derived(comment.trim() !== "");

  function submit() {
    onSubmit(comment);
  }

  function discard() {
    onDiscard();
  }

  function keep() {
    onKeep(comment);
  }
</script>

<div class="composer" role="dialog" aria-label="Add a comment" tabindex="-1">
  <p class="label metric">{label}</p>
  <MarkdownEditor
    value={initial}
    placeholder="What should change here?"
    ariaLabel="Comment"
    autofocus
    onInput={(text) => (comment = text)}
    onSubmitChord={submit}
    onCancelChord={discard}
  />
  <div class="row">
    <button class="keep" type="button" onclick={keep} disabled={!canKeep}>Keep for later</button>
    <button class="ghost" type="button" onclick={discard} aria-keyshortcuts="Escape">Discard</button>
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
  .row {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
    margin-top: 0.55rem;
  }
  .keep,
  .ghost,
  .solid {
    border-radius: var(--radius);
    font-size: var(--text-sm);
    font-weight: 600;
    padding: 0.35rem 0.75rem;
  }
  /* Tertiary: the deliberate "stash for later" opt-in. Borderless and faint so it
     never competes with the ghost Discard or the solid Comment — the quietest
     control in the row. */
  .keep {
    background: transparent;
    color: var(--ink-faint);
    border: 1px solid transparent;
  }
  .keep:hover:not(:disabled) {
    color: var(--ink-soft);
  }
  .keep:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
