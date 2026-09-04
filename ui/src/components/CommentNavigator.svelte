<script lang="ts">
  // A pinned, searchable index of the plan's inline comments, docked above the
  // bottom status bar; the status strip's comment tally is its toggle. Each row
  // jumps the source view to that comment's line; the search field filters by
  // comment text, never the plan text. It is persistent chrome, not a modal:
  // clicking a row leaves it open so the reviewer can walk the list while the plan
  // scrolls behind it. Mirrors the breadcrumbs bar's filter-then-jump idiom.
  //
  // Keyboard-driven too (EXC-792). While a row holds focus the panel captures the
  // keyboard so the plan's own shortcuts don't fire.
  import { type CommentIndexEntry, filterComments, highlightMatches } from "$lib/feedback.ts";
  import { Kbd } from "$lib/components/ui/kbd/index.js";

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
    /** Whether the shortcut-hint key caps are shown (EXC-826/EXC-792). When off,
     * the footer key legend hides; the keys themselves still work. */
    showShortcutHints: boolean;
    /** Whether this is the cross-version compare list. Only the empty-state copy
     * reads it — whether a given row reveals is the row's own `linkable`, since a
     * compare list mixes rendered and off-screen versions. */
    compare?: boolean;
    /** Header title, e.g. "Comments in v1–v4" while comparing. Doubles as the
     * panel's aria-label, so it is the landmark's accessible name too. */
    title?: string;
  }
  let {
    open,
    comments,
    activeId,
    onReveal,
    onClose,
    showShortcutHints,
    compare = false,
    title = "Comments",
  }: Props = $props();

  let query = $state("");
  const visible = $derived(filterComments(comments, query));

  let searchEl = $state<HTMLInputElement | null>(null);
  let asideEl = $state<HTMLElement | null>(null);

  // On open, move focus INTO the list so j/k navigate straight away (EXC-792). This
  // runs on the open transition only — revealing a comment doesn't re-run it, so
  // focus is never yanked mid-navigation. On close, focus returns to the tally that
  // summoned it (WAI-ARIA dismissable pattern), so Esc doesn't strand focus on
  // document.body; the flag keeps that restore off the initial mount, where open is
  // already false.
  let hadFocus = false;
  $effect(() => {
    if (!open) {
      if (hadFocus) {
        hadFocus = false;
        (document.querySelector(".comments-toggle") as HTMLElement | null)?.focus({
          preventScroll: true,
        });
      }
      query = "";
      return;
    }
    hadFocus = true;
    const revealed = (asideEl?.querySelector('[data-nav-row][aria-current="true"]') ??
      null) as HTMLElement | null;
    (revealed ?? rows()[0] ?? searchEl)?.focus({ preventScroll: true });
  });

  // The roving-focus targets for j/k. A row that can reveal is a button, one that
  // cannot is a list item, and both carry data-nav-row — the contract this query,
  // the reveal lookup above and the e2e rows() helper bind to, kept off the styling
  // class so a restyle cannot break j/k.
  function rows(): HTMLElement[] {
    return asideEl ? ([...asideEl.querySelectorAll("[data-nav-row]")] as HTMLElement[]) : [];
  }
  // Clamped to the ends. With focus not yet on a row (e.g. the close button),
  // either direction enters the list at the top rather than skipping the first row.
  function focusRelative(delta: number): void {
    const list = rows();
    if (list.length === 0) return;
    const cur = list.indexOf(document.activeElement as HTMLElement);
    const next = cur < 0 ? 0 : Math.min(Math.max(cur + delta, 0), list.length - 1);
    list[next]?.focus();
  }

  // Escape dismisses wherever focus sits; everything else acts only inside the
  // panel. Enter/Space are deliberately absent — they fall through to the row's
  // native activation, which reveals WITHOUT moving focus, so the plan highlights
  // while the panel stays open. The dispatcher treats a focused navigator as an
  // editing context (App.svelte), so the plan's own j/k and the a/r verdict keys
  // stay suppressed while the reviewer walks the list.
  function onWindowKeydown(e: KeyboardEvent): void {
    if (!open) return;
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (!asideEl?.contains(document.activeElement)) return;
    if (document.activeElement === searchEl) {
      if (e.key === "Enter") {
        e.preventDefault();
        rows()[0]?.focus();
      }
      return;
    }
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      focusRelative(1);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      focusRelative(-1);
    } else if (e.key === "/") {
      e.preventDefault();
      searchEl?.focus();
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
  <aside
    bind:this={asideEl}
    id="comment-navigator"
    class="comment-navigator"
    aria-label={title}
  >
    <header class="nav-head">
      <span class="nav-title metric">{title}</span>
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

    {#snippet rowBody(entry: CommentIndexEntry)}
      <span class="nav-item-head">
        <!-- A general entry has no range to name, so "General" takes the reference
             slot — the vocabulary the unsent-comments guard already uses. -->
        <span class="nav-item-ref metric">{entry.general ? "General" : entry.label}</span>
        {#if entry.version != null}<span class="nav-version-tag metric">v{entry.version}</span>{/if}
        <!-- Keyed on the version being absent from the diff, not on the row
             being inert: a general row is inert too, but its version may well be
             on screen — it just has no line to jump to, which "General" says. -->
        {#if entry.version != null && entry.side == null && !entry.general}<span
            class="nav-unlinked-tag">not in diff</span
          >{/if}
        {#if entry.draft}<span class="nav-draft-tag metric">draft</span>{/if}
      </span>
      <!-- Kept on one line so no whitespace text node splits the segments — the
           text is white-space: pre-wrap. -->
      <span class="nav-item-text"
        >{#each highlightMatches(entry.text, query) as seg}{#if seg.match}<mark class="nav-match"
              >{seg.text}</mark
            >{:else}{seg.text}{/if}{/each}</span
      >
    {/snippet}

    {#if visible.length === 0}
      <p class="nav-empty">
        {#if comments.length > 0}
          No comments match your search.
        {:else if compare}
          No comments on these versions.
        {:else}
          No inline comments yet.
        {/if}
      </p>
    {:else}
      <ul class="nav-list" aria-label="Comment list">
        {#each visible as entry (entry.id)}
          {#if !entry.linkable}
            <!-- Nothing on screen to scroll to: a focusable list item, not a
                 button, so j/k still walk the list but nothing advertises a click
                 that goes nowhere. tabindex="-1" keeps it out of the tab order — a
                 nonnegative one is the a11y_no_noninteractive_tabindex anti-pattern
                 — and the list is reached with j/k or Enter from the search. -->
            <li class="nav-item" data-nav-row tabindex="-1">{@render rowBody(entry)}</li>
          {:else}
            <li>
              <button
                type="button"
                class="nav-item"
                data-nav-row
                class:active={entry.id === activeId}
                class:draft={entry.draft}
                aria-current={entry.id === activeId ? "true" : undefined}
                onclick={() => onReveal(entry)}
              >
                {@render rowBody(entry)}
              </button>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}

    {#if showShortcutHints}
      <!-- Shift+C, the summon key, is absent deliberately: it rides the status-strip
           tally that opens the panel, so it is taught there. -->
      <footer class="nav-hints" aria-hidden="true">
        <span class="nav-hint"><Kbd class="kbd-sm">j</Kbd><Kbd class="kbd-sm">k</Kbd> move</span>
        <span class="nav-hint"><Kbd class="kbd-sm">↵</Kbd> reveal</span>
        <span class="nav-hint"><Kbd class="kbd-sm">/</Kbd> search</span>
        <span class="nav-hint"><Kbd class="kbd-sm">Esc</Kbd> close</span>
      </footer>
    {/if}
  </aside>
{/if}

<style>
  /* position: fixed keeps it out of the shell grid — a root sibling of .shell — so
     it never disturbs the layout. z-index sits above the plan surface, below the
     modal scrim (100) and safe-mode toast (200). */
  .comment-navigator {
    position: fixed;
    right: 0.7rem;
    bottom: calc(var(--status-bar-h) + 0.5rem);
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
    animation: nav-open var(--dur-enter) var(--ease-out);
  }
  /* At ≤ --w-tight it unpins and widens to a full-bleed bottom sheet (EXC-812),
     which may sit over the plan surface (intended). The px literal mirrors
     lib/layout.ts's TIGHT_WIDTH_PX (640) minus one — @media can't read the token. */
  @media (max-width: 639px) {
    .comment-navigator {
      left: 0.7rem;
      right: 0.7rem;
      width: auto;
    }
  }
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
  /* No pointer and no hover lift, so nothing promises a click that leads nowhere.
     The focus ring stays, since j/k still moves through these rows. */
  li.nav-item {
    cursor: default;
  }
  li.nav-item:hover {
    background: none;
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
  /* One shared pill, so the pair reads as one statement of provenance ("v2, not in
     diff"). Only the version tag tracks wide — the same tracking on the unlinked
     tag's whole phrase would only make it harder to read. */
  .nav-version-tag,
  .nav-unlinked-tag {
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--ink-faint);
    padding: 0 0.3rem;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
  }
  .nav-version-tag {
    letter-spacing: 0.08em;
  }
  /* Kept neutral so amber stays the navigation cue. */
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
  /* Underlined rather than filled, so it never wears <mark>'s default ground. */
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

  /* A legend, not a control — the quiet voice keeps amber reserved for the active
     comment. */
  .nav-hints {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.6rem;
    padding: 0.45rem 0.7rem;
    border-top: 1px solid var(--rule);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
  }
  .nav-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
</style>
