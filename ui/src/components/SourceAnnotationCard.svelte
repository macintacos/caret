<script lang="ts">
  // A line-anchored annotation on the source-view surface, rendered inline in the
  // per-line annotation row the parent projects into the library's slot
  // (annotationSlot.ts), so it sits between the code lines rather than over them.
  // Editing swaps the body for the SAME composer that creates a comment
  // (SourceComposer, mode="edit"), never a second, differently-shaped form.
  //
  // Expand state is UI-only, owned per card so several comments on one line can be
  // open at once (EXC-765). It seeds from focus but is never written to disk and
  // never auto-collapsed when focus moves to a sibling.
  //
  // The expand/collapse is a caret-owned grid-template-rows: 0fr↔1fr animation
  // rather than a bits-ui Collapsible: the card is unit-tested under happy-dom,
  // where the Collapsible's animation-gated presence machine waits forever for an
  // animationend a headless DOM never fires.
  import { untrack } from "svelte";
  import type { LineAnnotation } from "@core/lib/types";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { commentState } from "$lib/commentState.ts";
  import type { ReviewContext } from "$lib/editorCompletion.ts";
  import { renderMarkdown } from "$lib/markdown.ts";
  import ConfirmPopover from "@/components/ConfirmPopover.svelte";
  import Icon from "@/components/Icon.svelte";
  import SourceComposer from "@/components/SourceComposer.svelte";

  interface Props {
    annotation: LineAnnotation;
    /** Whether this is the single focused annotation; seeds expanded state. */
    focused: boolean;
    onFocus: (id: string) => void;
    onEdit: (id: string, comment: string) => void;
    onDelete: (id: string) => void;
    /** The review being commented on, forwarded to the edit-mode composer. */
    reviewContext?: ReviewContext;
  }
  let { annotation, focused, onFocus, onEdit, onDelete, reviewContext }: Props = $props();

  // Nudged open when THIS card becomes the focused one (a navigator reveal). Both
  // initial reads are untracked: they want focus's value now, not a reactive
  // dependency on it — the effect below owns that.
  let expanded = $state(untrack(() => focused));
  let wasFocused = untrack(() => focused);
  $effect(() => {
    if (focused && !wasFocused) expanded = true;
    wasFocused = focused;
  });

  // Editing reuses SourceComposer (mode="edit"); implies expanded.
  let editing = $state(false);


  const label = $derived(
    annotation.startLine === annotation.endLine
      ? `Line ${annotation.startLine}`
      : `Lines ${annotation.startLine}–${annotation.endLine}`,
  );

  // Rendered to sanitized HTML for display; the stored value stays literal text.
  const renderedComment = $derived(renderMarkdown(annotation.comment));

  // The same dot + label shows collapsed and expanded, so draft-vs-resolved reads
  // without opening the card.
  const stateView = $derived(commentState(annotation.state));

  function toggle() {
    expanded = !expanded;
    if (expanded) onFocus(annotation.id);
    else editing = false;
  }

  // The whole card is the toggle surface (EXC-765) — the pointer layer over the
  // chip button, which stays the keyboard control. It bows out for the three clicks
  // that don't mean "toggle": the actions, a link in the rendered comment, and one
  // that just finished a text selection (the reviewer is copying, not collapsing).
  function handleCardClick(e: MouseEvent) {
    if (editing) return;
    const target = e.target as Element | null;
    if (target?.closest(".actions") || target?.closest("a")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    toggle();
  }

  function startEdit() {
    editing = true;
    expanded = true;
  }
  function saveEdit(text: string) {
    // Don't persist a blank or unchanged edit — a no-op save is a cancel.
    const next = text.trim();
    if (next !== "" && next !== annotation.comment) onEdit(annotation.id, next);
    editing = false;
  }
  function cancelEdit() {
    editing = false;
  }

  function confirmDelete() {
    onDelete(annotation.id);
  }
</script>

<!-- The chip <button> below is the keyboard-accessible control (aria-expanded,
     Enter/Space), so the card-wide click needs no key handler of its own. In runes
     mode svelte-ignore codes are comma-separated — a space stops parsing. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="card"
  class:focused
  class:editing
  class:expanded
  data-annotation-card={annotation.id}
  data-state={stateView.status}
  onclick={handleCardClick}
>
  {#if editing}
    <!-- Editing IS the composer, with no card chrome around it, so it reads exactly
         like creating (EXC-765). -->
    <SourceComposer
      mode="edit"
      startLine={annotation.startLine}
      endLine={annotation.endLine}
      initial={annotation.comment}
      {reviewContext}
      onSubmit={saveEdit}
      onDiscard={cancelEdit}
    />
  {:else}
    <div class="head">
      <Button
        variant="ghost"
        class="chip"
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse comment" : "Expand comment"}
      >
        <Icon name="chevron-down" size={12} />
        <span class="ref">{label}</span>
        <Badge variant="outline" class="quiet-badge state state-{stateView.tone}">
          <span class="dot" aria-hidden="true"></span>{stateView.label}
        </Badge>
        {#if !expanded}
          <span class="clamp-line preview">{annotation.comment}</span>
        {/if}
      </Button>
      <div class="actions">
        <Button variant="ghost" size="sm" class="edit" onclick={startEdit}>Edit</Button>
        <!-- Deleting a submitted comment is irreversible, so it routes through a
             confirmation (EXC-749) instead of firing on the first click. -->
        <ConfirmPopover
          question="Discard this comment?"
          confirmLabel="Discard"
          onConfirm={confirmDelete}
        >
          {#snippet trigger(props)}
            <Button {...props} variant="ghost" size="sm" class="danger" aria-label="Discard comment">
              <Icon name="trash-2" size={14} />
            </Button>
          {/snippet}
        </ConfirmPopover>
      </div>
    </div>
    <!-- Stays mounted while collapsed (height 0) so the .body-wrap animation has
         something to grow; aria-hidden then keeps this copy out of the a11y tree,
         where the header preview carries the text instead. -->
    <div class="body-wrap" aria-hidden={!expanded}>
      <div class="body">
        <!-- renderedComment is sanitized HTML from renderMarkdown (see lib/markdown.ts). -->
        <div class="comment">{@html renderedComment}</div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Capped so the comment reads as a block under its line, not a full-bleed band. */
  .card {
    max-width: min(46rem, 100%);
    margin: 0.4rem 0 0.55rem;
    border: 1px solid var(--rule);
    border-left: 3px solid var(--state-accent);
    border-radius: var(--radius-lg);
    background: var(--paper-raised);
    /* Unresolved comments stay caret amber so they read brand-active; the terminal
       states below drop to quieter settled hues. */
    --state-accent: var(--accent);
    /* Opacity only: the card mounts inside the library-reserved annotation row, so
       a transform that grew or shifted its box would change the row's measured
       height and fight the preventScroll guard. */
    animation: reveal var(--dur-micro) var(--ease-out);
    transition: background-color var(--dur-micro) var(--ease-out);
  }
  .card[data-state="approved"] {
    --state-accent: var(--ok);
  }
  .card[data-state="expired"] {
    --state-accent: var(--ink-faint);
  }
  /* The state-hued left rail is re-asserted so the focus ring never overwrites it —
     the current card should keep, not lose, its status cue. */
  .card.focused {
    border-color: var(--rule-strong);
    border-left-color: var(--state-accent);
    box-shadow: var(--shadow-card);
  }
  /* While editing the card is just the composer, which owns its own surface — so
     the card drops its border/paper/box and lets the composer be the sole frame. */
  .card.editing {
    margin: 0;
    max-width: none;
    border: 0;
    border-radius: 0;
    background: none;
    box-shadow: none;
  }
  /* The chip stays transparent (its `background: none` outranks the ghost hover
     utilities) so the lift reads across the whole surface, not just the header.
     Editing hands the surface to the composer, so it opts out. */
  .card:not(.editing) {
    cursor: pointer;
  }
  .card:not(.editing):hover {
    background: var(--chip);
  }

  /* Centered so a taller action button and the one-line trigger read as one row. */
  .head {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.15rem 0.3rem 0.15rem 0;
  }
  /* Grows to fill the head so the whole line is a click target. The compound
     [data-slot] selector (0,2,0) outranks the copied button's utilities. */
  :global([data-slot="button"].chip) {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.5rem;
    flex: 1 1 auto;
    height: auto;
    min-width: 0;
    padding: 0.35rem 0.4rem 0.35rem 0.5rem;
    background: none;
    text-align: start;
    font-weight: 400;
    color: inherit;
  }
  :global([data-slot="button"].chip .icon) {
    flex: none;
    color: var(--ink-faint);
    transition: transform var(--dur-micro) var(--ease-out);
  }
  :global([data-slot="button"].chip[aria-expanded="false"] .icon) {
    transform: rotate(-90deg);
  }
  .ref {
    flex: none;
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--ink-soft);
  }
  /* The dot carries the state hue via the inherited --state-accent; the label stays
     neutral so the indicator reads as chrome, not a second accent. */
  :global([data-slot="badge"].state) {
    gap: 0.3rem;
  }
  .dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: var(--state-accent);
  }

  .actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.1rem;
  }
  /* Keyed on the ELEMENT, not `data-slot`. A Button writes its own
     `data-slot="button"` before `{...restProps}`, so on a Button that is also a
     bits-ui trigger the trigger's slot value wins and `[data-slot="button"].x` stops
     matching — silently. Discard is a Popover.Trigger; Edit takes the same form so
     it cannot break the day it grows a menu. */
  :global(button.edit),
  :global(button.danger) {
    height: auto;
    padding: 0.2rem 0.45rem;
    font-size: var(--text-xs);
  }
  /* The one destructive action: quiet until hovered, then danger red, so the
     consequence reads before the click. */
  :global(button.danger) {
    padding: 0.25rem 0.3rem;
    color: var(--ink-faint);
  }
  :global(button.danger:hover) {
    color: var(--danger);
  }
  /* A wobble previewing the destructive action. The keyframes are declared -global-
     so the name still resolves from inside the :global() hover selector — Svelte only
     rewrites animation names for component-scoped rules. --dur-enter rather than
     --dur-micro because four rotation steps across 120ms are ~30ms each, which reads
     as jitter rather than a wobble. */
  :global(button.danger:hover .icon) {
    animation: trash-shake var(--dur-enter) var(--ease-out);
  }
  @keyframes -global-trash-shake {
    0%,
    100% {
      transform: rotate(0deg);
    }
    25% {
      transform: rotate(-8deg);
    }
    50% {
      transform: rotate(6deg);
    }
    75% {
      transform: rotate(-4deg);
    }
  }
  /* A grid-template-rows: 0fr -> 1fr height animation. The row's measured height
     legitimately changes on expand/collapse and the library re-measures, but nothing
     transforms, so a code line below never gets a transform-driven jump.

     The two arms carry their own timing rather than one `transition` on the base
     rule: opening is a surface arriving, closing the same surface leaving. Which
     rule is in force when the class flips is what selects the arm. */
  .body-wrap {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows var(--dur-exit) var(--ease-in);
  }
  .card.expanded .body-wrap {
    grid-template-rows: 1fr;
    transition: grid-template-rows var(--dur-enter) var(--ease-out);
  }
  .body {
    overflow: hidden;
    min-height: 0;
    padding: 0 0.6rem 0 0.9rem;
  }
  .card.expanded .body {
    /* Folds in only while open, so a collapsed card's grid row truly measures 0. */
    padding-bottom: 0.5rem;
  }

  /* The child rules are :global because the markup is injected via {@html} and
     Svelte's scoping can't see into it. */
  .comment {
    font-size: var(--text-md);
    margin: 0;
    color: var(--ink);
    line-height: var(--leading-snug);
  }
  .comment :global(> :first-child) {
    margin-top: 0;
  }
  .comment :global(> :last-child) {
    margin-bottom: 0;
  }
  .comment :global(p) {
    margin: 0 0 0.5em;
  }
  .comment :global(a) {
    color: var(--accent);
    text-decoration: underline dotted;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
  .comment :global(a:hover) {
    color: var(--accent-bright);
    text-decoration-style: solid;
  }
  .comment :global(strong) {
    font-weight: 700;
  }
  .comment :global(em) {
    font-style: italic;
  }
  .comment :global(code) {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    background: var(--paper-sunk);
    padding: 0.05em 0.3em;
    border-radius: 3px;
  }
  .comment :global(pre) {
    margin: 0 0 0.5em;
    padding: 0.5rem 0.6rem;
    background: var(--paper-sunk);
    border-radius: var(--radius);
    overflow-x: auto;
  }
  .comment :global(pre code) {
    padding: 0;
    font-size: var(--text-sm);
    background: none;
  }
  .comment :global(ul),
  .comment :global(ol) {
    margin: 0 0 0.5em;
    padding-left: 1.3em;
  }
  /* Tailwind Preflight resets lists to list-style: none, dropping the markers. They
     sit in the padding-left reserved above. */
  .comment :global(ul) {
    list-style: disc;
  }
  .comment :global(ol) {
    list-style: decimal;
  }
  .comment :global(li) {
    margin: 0.1em 0;
  }
  .comment :global(blockquote) {
    margin: 0 0 0.5em;
    padding-left: 0.7em;
    border-left: 2px solid var(--rule-strong);
    color: var(--ink-soft);
  }
  /* Headings in a short comment lean on weight, not size. Tokens only — the
     type-scale test forbids raw font-size literals in component styles. */
  .comment :global(h1),
  .comment :global(h2),
  .comment :global(h3),
  .comment :global(h4),
  .comment :global(h5),
  .comment :global(h6) {
    margin: 0.3em 0 0.4em;
    font-size: var(--text-md);
    font-weight: 700;
    line-height: var(--leading-tight);
  }
  .comment :global(h1) {
    font-size: var(--text-lg);
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
