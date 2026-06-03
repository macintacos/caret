<script lang="ts">
  import type { Annotation } from "../lib/types.ts";

  // The shared comment body: renders the comment as text, edits it in a textarea,
  // and exposes edit/delete. Hosted by both AnnotationCard (sidebar) and
  // AnnotationPopover (inline) so the view/edit/delete logic lives in one place.
  // Action visibility is left to the host: AnnotationCard reveals the footer on
  // hover/active; the popover shows it by default.
  interface Props {
    annotation: Annotation;
    onEdit: (id: string, comment: string) => void;
    onDelete: (id: string) => void;
  }
  let { annotation, onEdit, onDelete }: Props = $props();

  let editing = $state(false);
  let draft = $state("");
  let textarea = $state<HTMLTextAreaElement | undefined>();

  function startEdit() {
    draft = annotation.comment;
    editing = true;
    queueMicrotask(() => textarea?.focus());
  }
  function save() {
    const trimmed = draft.trim();
    editing = false;
    if (trimmed && trimmed !== annotation.comment) onEdit(annotation.id, trimmed);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      editing = false;
      draft = annotation.comment;
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  }
</script>

{#if editing}
  <textarea
    bind:this={textarea}
    bind:value={draft}
    rows="3"
    onkeydown={onKey}
    onblur={save}
  ></textarea>
{:else}
  <p class="comment" ondblclick={startEdit}>{annotation.comment}</p>
{/if}

<footer class="anno-actions">
  <button class="link" onclick={(e) => { e.stopPropagation(); startEdit(); }}>
    edit
  </button>
  <button
    class="link danger"
    onclick={(e) => { e.stopPropagation(); onDelete(annotation.id); }}
  >
    delete
  </button>
</footer>

<style>
  .comment {
    font-size: 0.92rem;
    margin: 0;
    color: var(--ink);
  }
  textarea {
    width: 100%;
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
    font-size: 0.7rem;
    color: var(--ink-faint);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link:hover {
    color: var(--ink);
  }
  .link.danger:hover {
    color: var(--accent);
  }
</style>
