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
  import { revealCard } from "$lib/diffview/scroll.ts";
  import type { ReviewContext } from "$lib/editorCompletion.ts";
  import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";
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
    /** The review being commented on, forwarded to the editor so reference
     * completion resolves against it. */
    reviewContext?: ReviewContext;
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
    reviewContext,
  }: Props = $props();

  const isEdit = $derived(mode === "edit");

  // Seed from `initial` once, at mount: a resumed scratch mounts a fresh composer
  // with the restored text, and the reviewer edits the local copy from there.
  // untrack makes the one-time seed explicit so a later `initial` change does not
  // clobber in-progress edits. MarkdownEditor keeps this in sync via onInput.
  let comment = $state(untrack(() => initial));

  // Fires immediately with the seeded value too (Svelte effects run on mount),
  // not just later edits — see the onInput prop doc for why the host wants this.
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

  // The composer surface, focused when the first Escape blurs the editor so the
  // card can catch the second Escape (see the two-stage Escape below).
  let cardEl = $state<HTMLElement | null>(null);

  // The composer opens in the annotation row BELOW its anchor line, so a comment
  // started near the bottom of the plan can leave the card — often the whole
  // Comment / Keep / Discard row — off screen. This scrolls the plan the minimum
  // amount that brings the card fully into view, once MarkdownEditor has built
  // its editor and the height is final. The only reactive read is cardEl, which
  // changes once at mount, so it is a one-shot: the view does not chase the box
  // as it grows while the reviewer types. Both parents that mount this component
  // — the gutter/shortcut composer and the edit-mode one — inherit it from here.
  $effect(() => {
    if (cardEl == null) return;
    return revealCard(cardEl);
  });

  function submit() {
    onSubmit(comment);
  }

  function keep() {
    onKeep?.(comment);
  }

  // Two-stage Escape: the first Escape, fired from the focused editor, blurs the
  // field into this card WITHOUT dismissing — so a stray keypress can't nuke work
  // in progress. Focus lands on the card (tabindex -1), whose keydown catches the
  // SECOND Escape and commits the way clicking away would: an edit saves its
  // changes, a new draft is kept for later (never silently discarded). Two
  // presses to leave, never one.
  function blurToCard() {
    cardEl?.focus({ preventScroll: true });
  }
  function dismiss() {
    if (isEdit) submit();
    else keep();
  }
  // Only when the card ITSELF holds focus (the second Escape) do we dismiss — an
  // Escape bubbling up from the still-focused editor (the first press) carries the
  // editor as its target, not the card, and must be ignored here.
  function onCardKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && e.target === e.currentTarget) dismiss();
  }
</script>

<!-- One Discard button, rendered down whichever branch below applies: as the
     confirmation's trigger (where it takes bits-ui's props) or on its own. Declared
     out here rather than inside the Card, since a snippet inside a component's tags
     is passed to that component as a prop. -->
{#snippet discardButton(props: Record<string, unknown>)}
  <Button {...props} variant="secondary" class="float-chip ghost">Discard</Button>
{/snippet}

<Card
  bind:ref={cardEl}
  class="composer"
  role="dialog"
  aria-label={isEdit ? "Edit comment" : "Add a comment"}
  tabindex={-1}
  onkeydown={onCardKeydown}
>
  <p class="label metric">{label}</p>
  <MarkdownEditor
    value={initial}
    placeholder={isEdit ? "" : "What should change here?"}
    ariaLabel={isEdit ? "Edit comment" : "Comment"}
    {reviewContext}
    autofocus
    onInput={(text) => (comment = text)}
    onSubmitChord={submit}
    onCancelChord={blurToCard}
  />
  <div class="row">
    {#if isEdit}
      <!-- Edit mode: revise a saved comment. Cancel reverts (the comment survives,
           so no confirm), Save commits — same amber primary + ⌘↵ hint as Comment. -->
      <Button variant="ghost" class="cancel" onclick={onDiscard}>Cancel</Button>
      <Button class="save" onclick={submit} aria-keyshortcuts={ariaKeyshortcutsFor("editor.submit")}>
        Save
        <Kbd aria-hidden="true">
          <Icon name="command" size={12} /><Icon name="corner-down-left" size={12} />
        </Kbd>
      </Button>
    {:else}
      <Button variant="ghost" class="keep" onclick={keep} disabled={!canKeep}>Keep for later</Button>
      <!-- Dropping a non-empty draft loses typed text with no undo, so it routes
           through a confirmation (EXC-749). An empty box has nothing to lose, so it
           discards at once — no nag for the "clicked a line, changed my mind" case.
           The rule lives in the branch rather than inside the click handler because
           Popover.Trigger opens unconditionally: the empty case never gets a
           trigger at all. -->
      {#if canKeep}
        <ConfirmPopover
          question="Discard this comment?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onConfirm={onDiscard}
          trigger={discardButton}
        />
      {:else}
        {@render discardButton({ onclick: onDiscard })}
      {/if}
      <Button onclick={submit} aria-keyshortcuts={ariaKeyshortcutsFor("editor.submit")}>
        Comment
        <Kbd aria-hidden="true">
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
    animation: reveal var(--dur-micro) var(--ease-out);
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
  @keyframes reveal {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
