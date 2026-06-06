<script lang="ts">
  import type { Annotation } from "@core/types";
  import { isCancelKey, isSubmitChord } from "../lib/keys.ts";

  interface Props {
    annotation: Annotation;
    /** Tier-3 annotations whose anchor could not be re-resolved. */
    orphaned?: boolean;
    active?: boolean;
    /** Vertical offset (px) to align the card near its highlighted span. */
    top?: number;
    onFocus: (id: string) => void;
    onEdit: (id: string, comment: string) => void;
    onDelete: (id: string) => void;
  }
  let {
    annotation,
    orphaned = false,
    active = false,
    top,
    onFocus,
    onEdit,
    onDelete,
  }: Props = $props();

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
    if (isCancelKey(e)) {
      editing = false;
      draft = annotation.comment;
    } else if (isSubmitChord(e)) {
      e.preventDefault();
      save();
    }
  }
</script>

<div
  class="card"
  class:active
  class:orphaned
  style={top != null ? `transform: translateY(${top}px);` : ""}
  data-annotation-card={annotation.id}
  onclick={() => onFocus(annotation.id)}
  onkeydown={(e) => e.key === "Enter" && onFocus(annotation.id)}
  tabindex="0"
  role="button"
>
  <header>
    <span class="rail" aria-hidden="true"></span>
    {#if orphaned}
      <span class="badge" title="The plan changed; this comment lost its anchor"
        >detached</span
      >
    {/if}
    <blockquote class="quote">{annotation.quote}</blockquote>
  </header>

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

  <footer>
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
</div>

<style>
  .card {
    position: relative;
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    padding: 0.7rem 0.8rem 0.55rem 0.95rem;
    margin-bottom: 0.75rem;
    box-shadow: 0 1px 2px rgba(33, 28, 24, 0.04);
    transition:
      border-color 0.15s,
      box-shadow 0.15s,
      transform 0.2s ease;
    cursor: pointer;
  }
  .card:hover {
    border-color: var(--rule-strong);
  }
  .card.active {
    border-color: var(--accent);
    box-shadow: var(--shadow-card);
  }
  .card.orphaned {
    background: var(--paper-sunk);
    border-style: dashed;
  }
  .rail {
    position: absolute;
    left: 0;
    top: 0.6rem;
    bottom: 0.6rem;
    width: 3px;
    border-radius: 99px;
    background: var(--accent);
  }
  .card.orphaned .rail {
    background: var(--ink-faint);
  }
  header {
    position: relative;
  }
  .badge {
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-soft);
    background: var(--mark-orphan);
    border-radius: 99px;
    padding: 0.05rem 0.4rem;
    float: right;
  }
  .quote {
    font-style: italic;
    font-size: 0.82rem;
    color: var(--ink-soft);
    margin: 0 0 0.4rem;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
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
    opacity: 0;
    transition: opacity 0.15s;
  }
  .card:hover footer,
  .card.active footer {
    opacity: 1;
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
