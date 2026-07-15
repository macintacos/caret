<script lang="ts">
  // A line-anchored annotation on the source-view surface. It renders inline in
  // the source view's per-line annotation row (the parent projects it into the
  // library's slot — see annotationSlot.ts), so it sits between the code lines
  // rather than over them. Collapsed it is a compact bordered chip with a clamped
  // preview; expanded it reveals the full comment (rendered markdown) with Edit /
  // Discard tucked top-right. Editing swaps the body for the SAME composer that
  // creates a comment (SourceComposer, mode="edit"), so editing never looks like a
  // second, differently-shaped form. Expand state is UI-only — owned here, per
  // card, so several comments on one line can be open at once (EXC-765); it is
  // seeded from focus but never written to disk and never auto-collapsed when
  // focus moves to a sibling.
  //
  // The chrome is composed from shadcn primitives (EXC-765): a Badge carries the
  // lifecycle indicator and Buttons carry the header toggle and the actions. The
  // expand/collapse is a caret-owned grid-template-rows: 0fr↔1fr height animation
  // rather than a bits-ui Collapsible — the card is unit-tested under happy-dom,
  // where the Collapsible's animation-gated presence machine waits forever for an
  // animationend that a headless DOM never fires; a plain grid transition keeps
  // the content mounted and the tests honest while giving the same smooth height
  // reveal. caret's tight inline layout — the state-hued left rail, compact
  // padding, opacity-only mount reveal — rides the :global(.hook) rules below.
  import { untrack } from "svelte";
  import type { LineAnnotation } from "@core/lib/types";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { commentState } from "../lib/commentState.ts";
  import { renderMarkdown } from "../lib/markdown.ts";
  import ConfirmPopover from "./ConfirmPopover.svelte";
  import Icon from "./Icon.svelte";
  import SourceComposer from "./SourceComposer.svelte";

  interface Props {
    annotation: LineAnnotation;
    /** Whether this is the single focused annotation; seeds expanded state. */
    focused: boolean;
    onFocus: (id: string) => void;
    onEdit: (id: string, comment: string) => void;
    onDelete: (id: string) => void;
  }
  let { annotation, focused, onFocus, onEdit, onDelete }: Props = $props();

  // UI-only expand state, owned per card so several comments on one line can be
  // open at once (EXC-765): focusing or expanding one never collapses a sibling.
  // Seeded from `focused` and nudged open when THIS card becomes the focused one
  // (a navigator reveal), but never auto-collapsed when focus moves elsewhere —
  // the reviewer's own open/close choice stands until they change it.
  // untrack the initial reads: `expanded` seeds from focus once at mount, and
  // `wasFocused` is the previous-value tracker the effect compares against — both
  // want focus's value now, not a reactive dependency on it (the effect owns that).
  let expanded = $state(untrack(() => focused));
  let wasFocused = untrack(() => focused);
  $effect(() => {
    if (focused && !wasFocused) expanded = true;
    wasFocused = focused;
  });

  // Editing reuses SourceComposer (mode="edit"); implies expanded.
  let editing = $state(false);

  // Whether the "are you sure?" confirmation is showing over the Discard button.
  // Deleting a submitted comment is irreversible, so it routes through a confirm
  // (EXC-749) instead of firing on the first click.
  let confirming = $state(false);
  // The Discard button the confirm bubble anchors to, captured on click so the
  // popover left-aligns to it and shifts off any viewport edge — the same
  // viewport-aware path the Request Changes dialog uses, so every discard
  // confirmation behaves the same wherever the reviewer opens it (EXC-765).
  let confirmAnchor = $state<HTMLElement | null>(null);

  const label = $derived(
    annotation.startLine === annotation.endLine
      ? `Line ${annotation.startLine}`
      : `Lines ${annotation.startLine}–${annotation.endLine}`,
  );

  // The saved comment, rendered from markdown to sanitized HTML for the expanded
  // display (see lib/markdown.ts). The stored value stays literal text.
  const renderedComment = $derived(renderMarkdown(annotation.comment));

  // The comment's lifecycle affordance, read from the ReviewStatus-keyed state
  // (absent → a pending working draft). The same dot + label shows collapsed and
  // expanded, so the reviewer reads draft-vs-resolved without opening the card.
  const stateView = $derived(commentState(annotation.state));

  // Clicking the header toggles the card. Opening focuses it (amber highlight +
  // navigator sync); collapsing exits any in-progress edit.
  function toggle() {
    expanded = !expanded;
    if (expanded) onFocus(annotation.id);
    else editing = false;
  }

  // The whole card is the toggle surface, so the entire comment reads as one
  // clickable thing (EXC-765). The chip button stays the keyboard control; this
  // is the pointer convenience layer over it, and it bows out for the three
  // things a click there doesn't mean "toggle": the Edit/Discard actions (their
  // own jobs), a link in the rendered comment (it navigates), and a click that
  // just finished a text selection (the reviewer is copying, not collapsing).
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
    confirming = false;
    onDelete(annotation.id);
  }
</script>

<!-- The card-wide click is a pointer affordance; the chip <button> below is the
     keyboard-accessible control (aria-expanded, Enter/Space), so this needs no
     key handler of its own. In runes mode svelte-ignore codes are comma-separated
     (a space stops parsing), so both codes need the comma to take effect. -->
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
    <!-- Editing IS the composer: same Card, same editor, only Save/Cancel differ
         (EXC-765). No card chrome around it, so it reads exactly like creating. -->
    <SourceComposer
      mode="edit"
      startLine={annotation.startLine}
      endLine={annotation.endLine}
      initial={annotation.comment}
      onSubmit={saveEdit}
      onDiscard={cancelEdit}
    />
  {:else}
    <div class="head">
      <!-- The whole header line toggles the card; the chevron rotates with the
           open state. Collapsed it carries the one-line preview; expanded the
           preview drops and Edit / Discard tuck in at the right. -->
      <Button
        variant="ghost"
        class="chip"
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse comment" : "Expand comment"}
      >
        <Icon name="chevron-down" size={12} />
        <span class="ref">{label}</span>
        <Badge variant="outline" class="state state-{stateView.tone}">
          <span class="dot" aria-hidden="true"></span>{stateView.label}
        </Badge>
        {#if !expanded}
          <span class="preview">{annotation.comment}</span>
        {/if}
      </Button>
      {#if expanded}
        <div class="actions">
          <Button variant="ghost" size="sm" class="edit" onclick={startEdit}>Edit</Button>
          <span class="discard-wrap">
            <Button
              variant="ghost"
              size="sm"
              class="danger"
              onclick={(e) => {
                confirmAnchor = e.currentTarget as HTMLElement;
                confirming = true;
              }}>Discard</Button
            >
            {#if confirming}
              <ConfirmPopover
                question="Discard this comment?"
                confirmLabel="Discard"
                align="start"
                anchor={confirmAnchor ?? undefined}
                onConfirm={confirmDelete}
                onCancel={() => (confirming = false)}
              />
            {/if}
          </span>
        </div>
      {/if}
    </div>
    <!-- The comment body, revealed by a grid-template-rows height animation (see
         .body-wrap below). It stays mounted collapsed (height 0), so the animation
         has something to grow, and aria-hidden keeps the clamped copy out of the
         a11y tree while collapsed (the header preview carries it then). -->
    <div class="body-wrap" aria-hidden={!expanded}>
      <div class="body">
        <!-- renderedComment is sanitized HTML from renderMarkdown (see lib/markdown.ts). -->
        <div class="comment">{@html renderedComment}</div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* The card surface, inline within the library's annotation row — a contained,
     left-aligned block capped so the comment reads as a block under its line, not
     a full-bleed band. A subtle border + raised paper make a collapsed comment
     stand out from the plan surface (EXC-765); the state hue drives the left rail
     and the status dot. Vertical margin gives it air between the code lines. */
  .card {
    max-width: min(46rem, 100%);
    margin: 0.4rem 0 0.55rem;
    border: 1px solid var(--rule);
    border-left: 3px solid var(--state-accent);
    border-radius: var(--radius-lg);
    background: var(--paper-raised);
    /* Unresolved comments (pending/rejected) stay caret amber so an in-progress
       comment reads brand-active; terminal states drop to a quieter settled hue
       (--ok green for accepted, neutral ink for expired) so a resolved comment
       recedes. */
    --state-accent: var(--accent);
    /* A one-shot opacity reveal when the card first appears — a saved comment
       settling into the document (EXC-765). Opacity only: the card mounts inside
       the library-reserved annotation row, so a transform that grew or shifted
       its box would change the row's measured height and fight the preventScroll
       guard. The global reduced-motion rule in app.css collapses it. */
    animation: reveal var(--dur-fast) var(--ease-out);
    /* The hover lift (below) eases in and out rather than snapping. */
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .card[data-state="approved"] {
    --state-accent: var(--ok);
  }
  .card[data-state="expired"] {
    --state-accent: var(--ink-faint);
  }
  /* The focused (navigated) card lifts a hair — a raised shadow plus a brighter
     rule ring — so the comment the reviewer jumped to reads as the current one.
     The state-hued left rail is re-asserted so the ring never overwrites it (the
     current card should keep, not lose, its status cue). */
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
  /* The whole card toggles, so it advertises itself as clickable: a pointer
     cursor and a subtle background lift on hover (EXC-765). The chip stays
     transparent (its `background: none` outranks the ghost hover utilities), so
     the lift reads across the whole surface, not just the header. Editing hands
     the surface to the composer, which owns its own interactions — it opts out. */
  .card:not(.editing) {
    cursor: pointer;
  }
  .card:not(.editing):hover {
    background: var(--chip);
  }

  /* The always-visible header line: the toggle trigger (grows) plus the per-card
     Edit / Discard actions (expanded only), vertically centered so a taller
     action button and the one-line trigger read as one row. */
  .head {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.15rem 0.3rem 0.15rem 0;
  }
  /* The trigger: a ghost Button reset to a plain, left-aligned summary line — a
     rotating chevron, the line ref, the state chip, and (when collapsed) a clamped
     one-line preview. It grows to fill the head so the whole line is clickable, and
     stays full height so the click target spans the row. The compound [data-slot]
     selector (0,2,0) outranks the copied button's utilities. */
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
  /* The disclosure chevron: rotated by the open state — down (▼) when open, right
     (▶) when collapsed — so it reads as a standard disclosure. */
  :global([data-slot="button"].chip .icon) {
    flex: none;
    color: var(--ink-faint);
    transition: transform var(--dur-fast) var(--ease-out);
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
  .preview {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--text-base);
    color: var(--ink-soft);
  }
  /* Per-comment state affordance: an outline Badge carrying a small colored dot
     plus a quiet label. The dot carries the hue (state-driven, via the inherited
     --state-accent); the label stays neutral so the indicator reads as chrome,
     not a second accent. Shown collapsed and expanded. */
  :global([data-slot="badge"].state) {
    flex: none;
    gap: 0.3rem;
    padding: 0.05rem 0.4rem;
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--ink-faint);
    line-height: var(--leading-none);
  }
  .dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: var(--state-accent);
  }

  /* The per-card actions, tucked into the top-right of an expanded card (EXC-765):
     a quiet Edit and a red Discard, both small ghost buttons so they read as
     secondary to the comment itself. */
  .actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.1rem;
  }
  :global([data-slot="button"].edit),
  :global([data-slot="button"].danger) {
    height: auto;
    padding: 0.2rem 0.45rem;
    font-size: var(--text-xs);
  }
  /* Discard is the one destructive action; it takes caret's danger red on hover so
     the consequence reads before the click, resting quiet the rest of the time. */
  :global([data-slot="button"].danger) {
    color: var(--ink-faint);
  }
  :global([data-slot="button"].danger:hover) {
    color: var(--danger);
  }
  /* Anchors the Discard confirmation to its button (see ConfirmPopover). */
  .discard-wrap {
    position: relative;
    display: inline-flex;
  }

  /* The expand/collapse reveal: a grid-template-rows: 0fr -> 1fr height animation.
     The row's measured height legitimately changes on expand/collapse (the library
     re-measures its reserved annotation row and the bracket overlay's ResizeObserver
     tracks it), but nothing transforms, so a code line below never gets a
     transform-driven jump. The inner .body clips its overflow so the content can
     collapse to nothing. The single global reduced-motion rule in app.css
     neutralizes the transition. */
  .body-wrap {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows var(--dur-base) var(--ease-out);
  }
  .card.expanded .body-wrap {
    grid-template-rows: 1fr;
  }
  .body {
    overflow: hidden;
    min-height: 0;
    padding: 0 0.5rem;
  }
  .card.expanded .body {
    /* The bottom breathing room folds in only while open, so a collapsed card's
       grid row truly measures 0 and the chip sits flush. */
    padding-bottom: 0.5rem;
  }

  /* The saved comment, rendered from markdown (renderMarkdown -> sanitized HTML).
     The child element rules are :global because the markup is injected via
     {@html} and Svelte's scoping can't see into it. Tokens only (hex/var). */
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
    text-decoration: underline;
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
  .comment :global(li) {
    margin: 0.1em 0;
  }
  .comment :global(blockquote) {
    margin: 0 0 0.5em;
    padding-left: 0.7em;
    border-left: 2px solid var(--rule-strong);
    color: var(--ink-soft);
  }
  /* Headings in a short comment lean on weight, not size, for hierarchy; h1 gets
     the one step up the scale offers. Tokens only — the type-scale test forbids
     raw font-size literals in component styles. */
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

  /* The card's mount reveal (see .card above): opacity only, never transform, so a
     newly-saved card fades into the library-reserved annotation row without shifting
     its measured height. The single global reduced-motion rule in app.css collapses
     it to a static frame when the OS asks. */
  @keyframes reveal {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
