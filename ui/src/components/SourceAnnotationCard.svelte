<script lang="ts">
  // A line-anchored annotation on the source-view surface. It renders inline in
  // the source view's per-line annotation row (the parent projects it into the
  // library's slot — see annotationSlot.ts), so it sits between the code lines
  // rather than over them. Collapsed it is a compact chip with a clamped preview;
  // expanded it shows the full comment with edit and delete. Collapse state is
  // UI-only — owned here, seeded from focus, never written to disk.
  import type { LineAnnotation } from "@core/types";
  import { isCancelKey, isSubmitChord } from "../lib/keys.ts";
  import Icon from "./Icon.svelte";

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
  let textarea = $state<HTMLTextAreaElement | undefined>();

  const label = $derived(
    annotation.startLine === annotation.endLine
      ? `Line ${annotation.startLine}`
      : `Lines ${annotation.startLine}–${annotation.endLine}`,
  );

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
    const trimmed = draft.trim();
    editing = false;
    if (trimmed !== "" && trimmed !== annotation.comment) onEdit(annotation.id, trimmed);
  }

  function onKey(e: KeyboardEvent) {
    if (isCancelKey(e)) {
      e.preventDefault();
      editing = false;
      draft = annotation.comment;
    } else if (isSubmitChord(e)) {
      e.preventDefault();
      save();
    }
  }

  $effect(() => {
    if (editing) textarea?.focus();
  });
</script>

<div class="card" class:focused data-annotation-card={annotation.id}>
  {#if expanded}
    <div class="body">
      <header>
        <span class="ref">{label}</span>
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
        <textarea
          bind:this={textarea}
          bind:value={draft}
          rows="3"
          aria-label="Edit comment"
          onkeydown={onKey}
          onblur={save}
        ></textarea>
      {:else}
        <p class="comment">{annotation.comment}</p>
        <footer>
          <button class="link edit" type="button" onclick={startEdit}>edit</button>
          <button
            class="link danger"
            type="button"
            onclick={(e) => {
              e.stopPropagation();
              onDelete(annotation.id);
            }}>delete</button
          >
        </footer>
      {/if}
    </div>
  {:else}
    <button class="chip" type="button" onclick={focusCard}>
      <span class="ref">{label}</span>
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
    border-left: 3px solid var(--accent);
    border-radius: var(--radius);
    cursor: pointer;
    transition: border-color 0.12s;
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
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .body {
    padding: 0.6rem 0.7rem 0.55rem;
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
  }
  .card.focused .body {
    border-left-color: var(--accent);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.4rem;
  }
  .ref {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--ink-soft);
    flex: none;
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
  .comment {
    font-size: 0.92rem;
    margin: 0;
    color: var(--ink);
    white-space: pre-wrap;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font-size: 0.9rem;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    padding: 0.4rem 0.5rem;
  }
  textarea:focus {
    outline: none;
  }
  footer {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.4rem;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.78rem;
    color: var(--ink-soft);
    cursor: pointer;
    transition: color 0.15s;
  }
  .link:hover {
    color: var(--ink);
  }
  .link.danger:hover {
    color: var(--accent);
  }
</style>
