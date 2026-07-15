<script lang="ts">
  // Inline comment composer for the source-view surface. It renders in the source
  // view's per-line annotation row (the parent projects it into the library's slot
  // — see annotationSlot.ts) at the line or range the reviewer chose from the
  // gutter. Submitting (Comment / Cmd/Ctrl+Enter) creates a line-anchored
  // annotation; Discard (the button or Esc) drops the draft with no residue,
  // confirming first when it holds text; Keep for later stashes it as a
  // resumable scratch. The editing surface is
  // MarkdownEditor (the swappable
  // CodeMirror boundary): it styles markdown as you type, auto-grows, owns the
  // autofocus/preventScroll guard, and reports the chords back here.
  //
  // The chrome is composed from shadcn primitives (EXC-765): a Card-style surface,
  // Buttons for Keep / Discard / Comment (Comment is the one amber primary), and a
  // Kbd for the ⌘↵ hint. The editor stays MarkdownEditor.
  import { untrack } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Card } from "$lib/components/ui/card/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { rangeLabel } from "$lib/diffview/commenting.ts";
  import ConfirmPopover from "@/components/ConfirmPopover.svelte";
  import Icon from "@/components/Icon.svelte";
  import MarkdownEditor from "@/components/MarkdownEditor.svelte";

  interface Props {
    /** First annotated line (1-based, inclusive). */
    startLine: number;
    /** Last annotated line (1-based, inclusive). */
    endLine: number;
    /** Text to pre-fill, restoring a resumed scratch draft. Default "" opens an
     * empty composer for a fresh comment. */
    initial?: string;
    /** "create" (default) is the gutter flow that mints a new annotation:
     * Keep-for-later / Discard / Comment. "edit" reuses the exact same surface to
     * revise a saved comment (EXC-765), swapping only the action row to Cancel /
     * Save — so editing a comment looks identical to writing one, never a bespoke
     * inline form. */
    mode?: "create" | "edit";
    onSubmit: (comment: string) => void;
    /** Discard the draft outright — the Discard/Cancel button and the Esc chord.
     * In "create" this drops the text with no scratch retained; in "edit" it
     * reverts to the saved comment. Either way the host closes the composer. */
    onDiscard: () => void;
    /** Keep the draft for later, handing back the current text so the host retains
     * it as a resumable scratch. The "Keep for later" button; disabled when the
     * box is empty (nothing to keep). "create" only. */
    onKeep?: (text: string) => void;
    /** Report the live text on every edit, so the host can retain it as a scratch
     * if the composer is replaced (a new range opened) without an explicit
     * dismiss. Optional. */
    onInput?: (text: string) => void;
  }
  let {
    startLine,
    endLine,
    initial = "",
    mode = "create",
    onSubmit,
    onDiscard,
    onKeep,
    onInput,
  }: Props = $props();

  // "edit" reuses this whole surface to revise a saved comment: same Card, same
  // MarkdownEditor, same layout — only the action row and the accessible names
  // change, so the reviewer never meets a second, differently-shaped editor.
  const isEdit = $derived(mode === "edit");

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

  // Whether the "are you sure?" confirmation is showing over the Discard button.
  let confirming = $state(false);

  function submit() {
    onSubmit(comment);
  }

  // Dropping a non-empty draft loses typed text with no undo, so it routes
  // through a confirmation (EXC-749). An empty box has nothing to lose, so it
  // discards at once — no nag for the "clicked a line, changed my mind" case.
  // The create-mode Discard button and the create-mode Esc chord enter here.
  function requestDiscard() {
    if (canKeep) confirming = true;
    else onDiscard();
  }

  function confirmDiscard() {
    confirming = false;
    onDiscard();
  }

  // The Esc chord: in "edit" it plainly reverts (Cancel — the saved comment
  // stays, so there is nothing to lose that a confirm would guard); in "create"
  // it routes through the discard confirmation like the Discard button.
  function cancelChord() {
    if (isEdit) onDiscard();
    else requestDiscard();
  }

  function keep() {
    onKeep?.(comment);
  }
</script>

<Card
  class="composer"
  role="dialog"
  aria-label={isEdit ? "Edit comment" : "Add a comment"}
  tabindex={-1}
>
  <p class="label metric">{label}</p>
  <MarkdownEditor
    value={initial}
    placeholder={isEdit ? "" : "What should change here?"}
    ariaLabel={isEdit ? "Edit comment" : "Comment"}
    autofocus
    onInput={(text) => (comment = text)}
    onSubmitChord={submit}
    onCancelChord={cancelChord}
  />
  <div class="row">
    {#if isEdit}
      <!-- Edit mode: revise a saved comment. Cancel reverts (the comment survives,
           so no confirm), Save commits — same amber primary + ⌘↵ hint as Comment. -->
      <Button variant="ghost" class="cancel" onclick={onDiscard}>Cancel</Button>
      <Button class="save" onclick={submit} aria-keyshortcuts="Meta+Enter Control+Enter">
        Save
        <Kbd class="kbd" aria-hidden="true">
          <Icon name="command" size={12} /><Icon name="corner-down-left" size={12} />
        </Kbd>
      </Button>
    {:else}
      <Button variant="ghost" class="keep" onclick={keep} disabled={!canKeep}>Keep for later</Button>
      <span class="discard-wrap">
        <Button
          variant="secondary"
          class="float-chip ghost"
          onclick={requestDiscard}
          aria-keyshortcuts="Escape">Discard</Button
        >
        {#if confirming}
          <ConfirmPopover
            question="Discard this comment?"
            confirmLabel="Discard"
            cancelLabel="Keep editing"
            align="start"
            onConfirm={confirmDiscard}
            onCancel={() => (confirming = false)}
          />
        {/if}
      </span>
      <Button onclick={submit} aria-keyshortcuts="Meta+Enter Control+Enter">
        Comment
        <Kbd class="kbd" aria-hidden="true">
          <Icon name="command" size={12} /><Icon name="corner-down-left" size={12} />
        </Kbd>
      </Button>
    {/if}
  </div>
</Card>

<style>
  /* Inline within the library's annotation row — a Card reshaped to caret's tight
     inline padding and raised shadow (see SourceAnnotationCard's .body). The
     compound [data-slot] selector (0,2,0) outranks the copied Card's utilities. */
  :global([data-slot="card"].composer) {
    display: block;
    max-width: min(46rem, 100%);
    margin: 0.4rem 0 0.55rem;
    padding: 0.7rem 0.75rem 0.6rem;
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
  /* Positioning context for the discard confirmation, so it anchors to the
     button rather than floating (see ConfirmPopover). */
  .discard-wrap {
    position: relative;
    display: inline-flex;
  }
  /* Keep for later is the deliberate "stash for later" opt-in — the quietest
     control in the row, so its ghost Button drops to the faint ink until hovered.
     Discard (neutral float-chip) and Comment (the one amber primary) carry more
     weight, keeping the stash from competing with them. */
  :global([data-slot="button"].keep) {
    color: var(--ink-faint);
  }
  :global([data-slot="button"].keep:hover:not(:disabled)) {
    color: var(--ink-soft);
  }
  /* The ⌘↵ hint on the Comment button: a Kbd stripped of its keycap ground so the
     two glyphs read as a quiet inline shortcut on the amber fill rather than a
     sunk chip fighting it. */
  :global([data-slot="kbd"].kbd) {
    height: auto;
    min-width: 0;
    padding: 0;
    gap: 0.15rem;
    background: transparent;
    color: inherit;
    opacity: 0.85;
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
