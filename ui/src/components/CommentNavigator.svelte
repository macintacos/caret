<script lang="ts">
  // The comment navigator: a pinned, searchable index of the plan's inline
  // comments, docked just above the bottom status bar so it stays out of
  // the plan's way. The strip's comment tally is its toggle. Each row jumps the
  // source view to that comment's line and highlights it; the search field filters
  // the list by comment text (never the plan text). It is persistent chrome, not a
  // modal: clicking a row leaves it open so the reviewer can walk the list while the
  // plan scrolls behind it, and it dismisses only on Escape, the close button, or a
  // re-toggle. Mirrors the breadcrumbs bar's filter-then-jump idiom.
  //
  // EXC-792: keyboard-driven too — Shift+C summons it (the status-strip tally
  // advertises the key), j/k walk the rows, Enter reveals a comment while the
  // panel stays open, / focuses the search field, Esc dismisses. While a row holds
  // focus the panel captures the keyboard so the plan's own shortcuts don't fire.
  //
  // EXC-812: at ≤ --w-tight it widens to a full-bleed bottom sheet so the pinned
  // chrome reads as an intentional narrow-width surface instead of a cramped card.
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
  }
  let { open, comments, activeId, onReveal, onClose, showShortcutHints }: Props = $props();

  let query = $state("");
  const visible = $derived(filterComments(comments, query));

  let searchEl = $state<HTMLInputElement | null>(null);
  let asideEl = $state<HTMLElement | null>(null);

  // On open, move focus INTO the list so j/k navigate straight away (EXC-792) —
  // the revealed row if one is shown, else the first row; the search field when
  // the list is empty (nothing to walk, but "/" still reaches search). Runs on
  // the open transition (and when the panel's elements mount); revealing a
  // comment doesn't re-run it, so focus is never yanked mid-navigation. On close,
  // clear the query so it reopens clean and — if the panel had been open — return
  // focus to the tally that summoned it (WAI-ARIA dismissable pattern), so a
  // keyboard close (Esc) doesn't strand focus on document.body. The flag keeps
  // that restore off the initial mount, where open is already false.
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
    const revealed = (asideEl?.querySelector(".nav-item.active") ?? null) as HTMLElement | null;
    (revealed ?? rows()[0] ?? searchEl)?.focus({ preventScroll: true });
  });

  // The row buttons in filtered order — the roving-focus targets for j/k.
  function rows(): HTMLButtonElement[] {
    return asideEl ? ([...asideEl.querySelectorAll(".nav-item")] as HTMLButtonElement[]) : [];
  }
  // Move roving focus by `delta` from the focused row, clamped to the ends. When
  // focus isn't on a row yet (e.g. the close button), either direction enters the
  // list at the top rather than skipping the first row.
  function focusRelative(delta: number): void {
    const list = rows();
    if (list.length === 0) return;
    const cur = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = cur < 0 ? 0 : Math.min(Math.max(cur + delta, 0), list.length - 1);
    list[next]?.focus();
  }

  // Keyboard-drive the open navigator (EXC-792). Escape dismisses wherever focus
  // sits (the panel or the plan behind it — unchanged). While focus is inside the
  // panel: from a row, j/k (or ↑/↓) move the roving focus and "/" jumps to the
  // search field; Enter/Space fall through to the row's native activation, which
  // reveals the comment WITHOUT moving focus, so the plan highlights while the
  // panel stays open. In the search field, Enter hands focus back to the list so
  // j/k resume on the filtered results. The dispatcher treats a focused navigator
  // as an editing context (App.svelte), so the plan's own j/k and the a/r verdict
  // keys stay suppressed while the reviewer walks the list — the panel owns the
  // keyboard, exactly as a text field or the composer does.
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
    aria-label="Comments in this plan"
  >
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

    {#if showShortcutHints}
      <!-- The in-view key legend (EXC-792), rendered as shadcn Kbd caps and gated
           on the shortcut-hints setting like the app's other hints. Shift+C — the
           summon key — rides the status-strip tally that opens the panel, so it is
           taught there rather than repeated inside the open view. -->
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
  /* Viewport-pinned, docked just above the bottom status bar (EXC-787). position:
     fixed keeps it out of the shell grid — a root sibling of .shell — so it never
     disturbs the layout. z-index sits above the plan surface, below the modal
     scrim (100) and safe-mode toast (200). A quiet paper-raised card. The bottom
     offset clears the status bar (its height token plus a small gap). */
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
    animation: nav-open var(--dur-base) var(--ease-out);
  }
  /* At ≤ --w-tight the navigator unpins from the right corner and widens to a
     full-bleed bottom sheet (EXC-812) — it keeps the base bottom offset, clearing
     the status bar, and may sit over the plan surface (intended). The px literal
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

  /* The in-view key legend (EXC-792): a quiet footer band of Kbd caps below the
     list, set off by a hairline like the header. The mono/ink-faint voice keeps
     it a legend, not a control, so amber stays reserved for the active comment. */
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
