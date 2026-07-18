<script lang="ts">
  // The comment navigator: a pinned, searchable index of the plan's inline
  // comments, docked just above the status strip (bottom-right) so it stays out of
  // the plan's way. The strip's comment tally is its toggle. Each row jumps the
  // source view to that comment's line and highlights it; the search field filters
  // the list by comment text (never the plan text). It is persistent chrome, not a
  // modal: clicking a row leaves it open so the reviewer can walk the list while the
  // plan scrolls behind it, and it dismisses only on Escape, the close button, or a
  // re-toggle. Mirrors the SourceToc contents pane's filter-then-jump idiom.
  //
  // EXC-812: at ≤ --w-tight it widens to a full-bleed bottom sheet so the pinned
  // chrome reads as an intentional narrow-width surface instead of a cramped card.
  import { type CommentIndexEntry, filterComments, highlightMatches } from "$lib/feedback.ts";

  interface Props {
    /** Whether the navigator is shown. The status strip's tally button toggles it. */
    open: boolean;
    /** The plan's inline comments, in document order (see commentIndex). */
    comments: CommentIndexEntry[];
    /** The comment currently focused in the source view, highlighted in the list. */
    activeId: string | null;
    /** Reveal a comment: scroll the plan to its line and highlight its card. */
    onReveal: (entry: CommentIndexEntry) => void;
    /** Close the navigator (Escape or the close button). */
    onClose: () => void;
  }
  let { open, comments, activeId, onReveal, onClose }: Props = $props();

  let query = $state("");
  const visible = $derived(filterComments(comments, query));

  // Focus the search field when the navigator opens so the reviewer can filter
  // straight away; clear the query on close so it reopens clean.
  let searchEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (open) searchEl?.focus({ preventScroll: true });
    else query = "";
  });

  // Escape dismisses the open navigator, wherever focus sits (the panel or the
  // plan behind it). A window listener gated on `open` keeps it inert when closed
  // and avoids a keyboard handler on the non-interactive panel element.
  function onWindowKeydown(e: KeyboardEvent) {
    if (open && e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
  <aside id="comment-navigator" class="comment-navigator" aria-label="Comments in this plan">
    <header class="nav-head">
      <span class="nav-title metric">Comments</span>
      <span class="nav-count metric">{comments.length}</span>
      <button type="button" class="nav-close" aria-label="Close comments" onclick={onClose}>
        <span aria-hidden="true">&times;</span>
      </button>
    </header>

    <div class="nav-search">
      <input
        bind:this={searchEl}
        class="nav-input metric"
        type="text"
        placeholder="Search comments…"
        aria-label="Search comments"
        bind:value={query}
      />
    </div>

    {#if visible.length === 0}
      <p class="nav-empty">
        {comments.length === 0 ? "No inline comments yet." : "No comments match your search."}
      </p>
    {:else}
      <ul class="nav-list" aria-label="Comment list">
        {#each visible as entry (entry.id)}
          <li>
            <button
              type="button"
              class="nav-item"
              class:active={entry.id === activeId}
              class:draft={entry.draft}
              aria-current={entry.id === activeId ? "true" : undefined}
              onclick={() => onReveal(entry)}
            >
              <span class="nav-item-head">
                <span class="nav-item-ref metric">{entry.label}</span>
                {#if entry.draft}<span class="nav-draft-tag metric">draft</span>{/if}
              </span>
              <!-- Underline the run(s) matching the live search query. Kept on one
                   line so no whitespace text node splits the segments (the text is
                   white-space: pre-wrap). -->
              <span class="nav-item-text"
                >{#each highlightMatches(entry.text, query) as seg}{#if seg.match}<mark
                      class="nav-match">{seg.text}</mark
                    >{:else}{seg.text}{/if}{/each}</span
              >
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
{/if}

<style>
  /* Viewport-pinned, docked just above the status strip (bottom-right). position:
     fixed keeps it out of the shell grid — a root sibling of .shell like the strip
     itself — so it never disturbs the layout or the fixed Toc rail's containing
     block. z-index sits above the strip (40) and Toc rail (30), below the modal
     scrim (100) and safe-mode toast (200). A quiet paper-raised card: the strip's
     own vocabulary, grown into a small panel. */
  .comment-navigator {
    position: fixed;
    right: 0.7rem;
    bottom: 2.9rem;
    z-index: 45;
    display: flex;
    flex-direction: column;
    width: min(21rem, calc(100vw - 1.4rem));
    max-height: min(60vh, 24rem);
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    overflow: hidden;
    animation: nav-open var(--dur-base) var(--ease-out);
  }
  /* At ≤ --w-tight the navigator unpins from the right corner and widens to a
     full-bleed bottom sheet (EXC-812) — it stays at bottom: 2.9rem, clearing the
     VersionBadge row, and may sit over the ToC rail (intended). The px literal
     mirrors lib/layout.ts's TIGHT_WIDTH_PX (640) minus one — @media can't read the
     --w-* token. Wide widths keep the right-docked 21rem card. */
  @media (max-width: 639px) {
    .comment-navigator {
      left: 0.7rem;
      right: 0.7rem;
      width: auto;
    }
  }
  /* One-shot rise-and-fade on open; neutralized by the global #app reduced-motion
     rule. Opacity + a small translate only — no layout thrash. */
  @keyframes nav-open {
    from {
      opacity: 0;
      transform: translateY(0.4rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .nav-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.55rem 0.7rem 0.45rem;
    border-bottom: 1px solid var(--rule);
  }
  /* Eyebrow-quiet title, matching the thread container's tally voice. */
  .nav-title {
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .nav-count {
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--ink-soft);
  }
  .nav-close {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    padding: 0;
    font-size: var(--text-base);
    line-height: 1;
    color: var(--ink-faint);
    background: none;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .nav-close:hover {
    color: var(--ink);
  }
  .nav-close:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }

  .nav-search {
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--rule);
  }
  .nav-input {
    width: 100%;
    padding: 0.35rem 0.5rem;
    font-size: var(--text-sm);
    color: var(--ink);
    background: var(--paper-sunk);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
  }
  .nav-input::placeholder {
    color: var(--ink-faint);
  }
  .nav-input:focus-visible {
    outline: none;
    border-color: var(--ring);
  }

  .nav-list {
    list-style: none;
    margin: 0;
    padding: 0.3rem;
    overflow-y: auto;
  }
  /* Each row: an anchor lead (the line reference, tabular via .metric) plus a
     two-line clamp of the comment text — a scan-line, the full comment one jump
     away in the plan. A left rule marks the active (revealed) comment in amber,
     the same brand cue the focused card carries in the plan. */
  .nav-item {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    width: 100%;
    text-align: left;
    padding: 0.4rem 0.5rem;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .nav-item:hover {
    background: var(--paper-sunk);
  }
  /* A draft (an unsent composer scratch) reads as provisional: a dashed left rule +
     a "draft" tag, distinct from a committed comment's solid frame. */
  .nav-item.draft {
    border-left-style: dashed;
    border-left-color: var(--rule-strong);
  }
  /* Active (revealed) wins the left rule in amber — the brand cue the focused card
     carries in the plan — even for a draft, whose tag still marks it provisional. */
  .nav-item.active {
    background: var(--paper-sunk);
    border-left: 2px solid var(--accent);
  }
  .nav-item:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  /* The row's lead line: the range reference and, for a draft, its tag. */
  .nav-item-head {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }
  .nav-item-ref {
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--ink-faint);
  }
  /* The draft tag: a quiet uppercase pill marking an unsent scratch as provisional,
     kept neutral so amber stays the navigation cue. */
  .nav-draft-tag {
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-faint);
    padding: 0 0.3rem;
    border: 1px dashed var(--rule-strong);
    border-radius: var(--radius);
  }
  .nav-item-text {
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    color: var(--ink-soft);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: pre-wrap;
  }
  /* The live search match: underlined and lifted to full ink so the matched
     substring stands out as the reviewer types, without the <mark> default fill. */
  .nav-match {
    background: none;
    color: var(--ink);
    font-weight: 600;
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 2px;
  }

  .nav-empty {
    margin: 0;
    padding: 1.1rem 0.7rem;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--ink-faint);
  }
</style>
