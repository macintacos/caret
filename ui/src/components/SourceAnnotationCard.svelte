<script lang="ts">
  // A line-anchored annotation on the source-view surface. It renders inline in
  // the source view's per-line annotation row (the parent projects it into the
  // library's slot — see annotationSlot.ts), so it sits between the code lines
  // rather than over them. Collapsed it is a compact chip with a clamped preview;
  // expanded it shows the full comment (rendered markdown) with edit and delete.
  // Editing uses MarkdownEditor (the swappable CodeMirror boundary). Collapse
  // state is UI-only — owned here, seeded from focus, never written to disk.
  import type { LineAnnotation } from "@core/types";
  import { commentState } from "../lib/commentState.ts";
  import { renderMarkdown } from "../lib/markdown.ts";
  import ConfirmPopover from "./ConfirmPopover.svelte";
  import Icon from "./Icon.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";

  interface Props {
    annotation: LineAnnotation;
    /** Whether this is the single focused annotation; seeds the expanded state. */
    focused: boolean;
    onFocus: (id: string) => void;
    onEdit: (id: string, comment: string) => void;
    onDelete: (id: string) => void;
  }
  let { annotation, focused, onFocus, onEdit, onDelete }: Props = $props();

  // UI-only collapse: a manual toggle overrides the focus-driven default until
  // focus changes again. `null` means "follow focus"; a boolean means the
  // reviewer chose. The override resets whenever the focused state flips, so a
  // newly-focused card always opens and a blurred card always closes.
  let override = $state<boolean | null>(null);
  let lastFocused = $state<boolean | undefined>(undefined);
  $effect(() => {
    if (focused === lastFocused) return;
    // Seed silently on the first run; only a genuine focus *change* resets a
    // reviewer's manual collapse choice.
    if (lastFocused !== undefined) override = null;
    lastFocused = focused;
  });
  const expanded = $derived(override ?? focused);

  let editing = $state(false);
  let draft = $state("");

  // Whether the "are you sure?" confirmation is showing over the delete link.
  // Deleting a submitted comment is irreversible, so it routes through a confirm
  // (EXC-749) instead of firing on the first click.
  let confirming = $state(false);

  const label = $derived(
    annotation.startLine === annotation.endLine
      ? `Line ${annotation.startLine}`
      : `Lines ${annotation.startLine}–${annotation.endLine}`,
  );

  // The saved comment, rendered from its markdown source to sanitized HTML for
  // the expanded display (see lib/markdown.ts). Stored value stays literal text.
  const renderedComment = $derived(renderMarkdown(annotation.comment));

  // The comment's lifecycle affordance, read from its ReviewStatus-keyed state
  // (absent → a pending working draft). The same dot+label shows collapsed and
  // expanded, so the reviewer reads draft-vs-resolved without opening the card.
  const stateView = $derived(commentState(annotation.state));

  function focusCard() {
    onFocus(annotation.id);
    // Expand immediately so the click reads as responsive even before the parent
    // re-feeds `focused`; the focus-change effect later resets this to follow focus.
    override = true;
  }

  function startEdit() {
    draft = annotation.comment;
    editing = true;
  }

  function save() {
    // The editor commits on blur, and finishing an edit (save or cancel) unmounts
    // it — firing one more blur. Guarding on `editing` makes that trailing blur a
    // no-op so a chord-save never also fires a second onEdit.
    if (!editing) return;
    editing = false;
    const trimmed = draft.trim();
    if (trimmed !== "" && trimmed !== annotation.comment) onEdit(annotation.id, trimmed);
  }

  // Esc: abandon the edit. Clearing `editing` first makes the trailing
  // commit-on-blur a no-op (see save), so the in-progress draft is discarded.
  function cancelEdit() {
    editing = false;
    draft = annotation.comment;
  }

  function confirmDelete() {
    confirming = false;
    onDelete(annotation.id);
  }
</script>

<div
  class="card"
  class:focused
  data-annotation-card={annotation.id}
  data-state={stateView.status}
>
  {#if expanded}
    <div class="body">
      <header>
        <span class="head">
          <span class="ref">{label}</span>
          <span class="state state-{stateView.tone}">
            <span class="dot" aria-hidden="true"></span>{stateView.label}
          </span>
        </span>
        <button
          class="collapse"
          type="button"
          aria-label="Collapse comment"
          onclick={() => (override = false)}
        >
          <Icon name="chevron-down" size={14} />
        </button>
      </header>
      {#if editing}
        <MarkdownEditor
          value={draft}
          ariaLabel="Edit comment"
          autofocus
          onInput={(text) => (draft = text)}
          onSubmitChord={save}
          onCancelChord={cancelEdit}
        />
        <footer>
          <button class="link save" type="button" onclick={save}>save</button>
          <button class="link cancel" type="button" onclick={cancelEdit}>cancel</button>
        </footer>
      {:else}
        <!-- renderedComment is sanitized HTML from renderMarkdown (see lib/markdown.ts). -->
        <div class="comment">{@html renderedComment}</div>
        <footer>
          <button class="link edit" type="button" onclick={startEdit}>edit</button>
          <span class="delete-wrap">
            <button
              class="link danger"
              type="button"
              onclick={(e) => {
                e.stopPropagation();
                confirming = true;
              }}>delete</button
            >
            {#if confirming}
              <ConfirmPopover
                question="Delete this comment?"
                confirmLabel="Delete"
                align="start"
                onConfirm={confirmDelete}
                onCancel={() => (confirming = false)}
              />
            {/if}
          </span>
        </footer>
      {/if}
    </div>
  {:else}
    <button class="chip" type="button" onclick={focusCard}>
      <span class="ref">{label}</span>
      <span class="state state-{stateView.tone}">
        <span class="dot" aria-hidden="true"></span>{stateView.label}
      </span>
      <span class="preview">{annotation.comment}</span>
    </button>
  {/if}
</div>

<style>
  /* Inline within the library's annotation row — a contained card, left-aligned
     and capped so a comment reads as a block under its line, not a full-bleed
     band. Vertical margin gives it air between the surrounding code lines. */
  .card {
    max-width: min(46rem, 100%);
    margin: 0.4rem 0 0.55rem;
    /* The state hue drives the left rail and the status dot. Unresolved comments
       (pending/rejected) stay caret amber so an in-progress comment reads brand-
       active; the terminal states drop to a quieter settled hue (--ok green for
       accepted, neutral ink for expired) so a resolved comment recedes. */
    --state-accent: var(--accent);
  }
  .card[data-state="approved"] {
    --state-accent: var(--ok);
  }
  .card[data-state="expired"] {
    --state-accent: var(--ink-faint);
  }
  /* The chip: a compact, monospace line tag with a clamped one-line preview. */
  .chip {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    width: 100%;
    text-align: left;
    padding: 0.3rem 0.55rem;
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-left: 3px solid var(--state-accent);
    border-radius: var(--radius);
    cursor: pointer;
    transition: border-color var(--dur-fast) var(--ease-out);
    /* Collapse (body -> chip) fades the newly-mounted chip in. See @keyframes
       reveal: opacity only, so the swap reads as a considered reveal and the
       annotation row's height is never driven by a transform. */
    animation: reveal var(--dur-fast) var(--ease-out);
  }
  .chip:hover {
    border-color: var(--rule-strong);
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
  .body {
    padding: 0.6rem 0.7rem 0.55rem;
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    /* Expand (chip -> body) fades the newly-mounted body in. Matches the chip's
       reveal so expand and collapse share one motion, and matches the inline
       composer's open. */
    animation: reveal var(--dur-fast) var(--ease-out);
  }
  .card.focused .body {
    border-left-color: var(--state-accent);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.4rem;
  }
  /* The expanded header's left cluster: the line ref and the state chip side by
     side, so state reads at the top of an open card without crowding the collapse
     control on the right. */
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .ref {
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--ink-soft);
    flex: none;
  }
  /* The per-comment state affordance: a small colored dot plus a quiet label. The
     dot carries the hue (state-driven); the label stays neutral so the indicator
     reads as chrome, not a second accent. Shown collapsed and expanded alike. */
  .state {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex: none;
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--ink-faint);
    line-height: var(--leading-none);
  }
  .dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--state-accent);
  }
  .collapse {
    display: inline-flex;
    padding: 0.1rem;
    color: var(--ink-faint);
    background: none;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .collapse:hover {
    color: var(--ink);
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
  footer {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.4rem;
  }
  /* Positioning context for the delete confirmation, so it anchors to the link
     rather than floating (see ConfirmPopover). */
  .delete-wrap {
    position: relative;
    display: inline-flex;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    font-size: var(--text-sm);
    color: var(--ink-soft);
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out);
  }
  .link:hover {
    color: var(--ink);
  }
  .link.danger:hover {
    color: var(--accent);
  }
  /* One motion for the chip<->body swap. Because expand/collapse is an {#if}
     swap between two different subtrees, a bare transition can't bridge them;
     the entering subtree fades in instead. Opacity only — never a transform —
     so the card never changes the library-reserved annotation row's measured
     height and never jumps the scroll container. The single global
     reduced-motion rule in app.css collapses it to a static frame when the OS
     asks. */
  @keyframes reveal {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
