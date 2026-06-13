<script lang="ts">
  // Left-hand contents pane for the source-view plan surface. Headings are
  // scanned from the formatted plan source (line-anchored), so navigation jumps
  // the view to a line rather than a slug. Filtering hides non-matching rows by
  // default (trees.software-inspired); the filter input also drives keyboard
  // navigation over the visible rows. Self-gates on shouldShowToc.
  import { filterHeadings, shouldShowToc, type TocHeading } from "../lib/toc.ts";

  interface Props {
    /** Headings extracted from the plan source, in document order. */
    headings: TocHeading[];
    /** Source line of the heading currently in the reading zone, or null. */
    activeLine: number | null;
    /** Jump the view to a heading's 1-based source line. */
    onJump: (line: number) => void;
  }

  let { headings, activeLine, onJump }: Props = $props();

  let query = $state("");
  // Keyboard focus cursor into the visible rows: -1 means "before the first
  // row", so the first ArrowDown lands on row 0. Reset whenever the visible set
  // changes (a new filter), so a stale index can never point past the list.
  let cursor = $state(-1);

  let visible = $derived(filterHeadings(headings, query));

  // Resetting the cursor in an effect keyed on the visible set keeps it valid
  // across filter changes without re-deriving it from query mid-keystroke.
  $effect(() => {
    void visible;
    cursor = -1;
  });

  // Keep the keyboard cursor visible: scroll its row into view when it moves
  // past the pane's fold. block: "nearest" only scrolls when off-screen. The
  // nav is reached from the keystroke's input rather than a binding so the
  // lookup reads the live DOM at the moment the cursor changes.
  function revealCursor(input: EventTarget | null) {
    if (cursor < 0) return;
    const nav = (input as HTMLElement | null)?.closest(".source-toc");
    nav?.querySelectorAll<HTMLElement>(".toc-row")[cursor]?.scrollIntoView({ block: "nearest" });
  }

  function jump(line: number) {
    onJump(line);
  }

  function onKeydown(e: KeyboardEvent) {
    if (visible.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      cursor = Math.min(cursor + 1, visible.length - 1);
      revealCursor(e.currentTarget);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      cursor = Math.max(cursor - 1, 0);
      revealCursor(e.currentTarget);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = visible[cursor === -1 ? 0 : cursor];
      if (row) jump(row.line);
    }
  }
</script>

{#if shouldShowToc(headings)}
  <nav class="source-toc" aria-label="Plan contents">
    <input
      class="toc-filter"
      type="text"
      placeholder="Filter headings…"
      aria-label="Filter headings"
      bind:value={query}
      onkeydown={onKeydown}
    />
    <ul class="toc-list">
      {#each visible as h, i (h.line)}
        <li>
          <button
            type="button"
            class="toc-row lvl-{h.level}"
            class:active={h.line === activeLine}
            class:cursor={i === cursor}
            aria-current={h.line === activeLine ? "location" : undefined}
            onclick={() => jump(h.line)}
          >
            {h.text}
          </button>
        </li>
      {/each}
      {#if visible.length === 0}
        <li class="toc-empty">No matches</li>
      {/if}
    </ul>
  </nav>
{/if}

<style>
  /* An IDE-outline panel in caret's paper palette: a quiet left column that
     reads as code navigation, sharing the diffs surface's monospace voice. */
  .source-toc {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: 15rem;
    padding: 1rem 0.75rem;
    box-sizing: border-box;
    background: var(--paper-raised);
    border-right: 1px solid var(--rule);
    overflow-y: auto;
    min-height: 0;
  }

  .toc-filter {
    flex: 0 0 auto;
    font-family: var(--font-sans);
    font-size: 0.78rem;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: 0.34rem 0.5rem;
    outline: none;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }
  .toc-filter::placeholder {
    color: var(--ink-faint);
  }
  .toc-filter:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-wash);
  }

  .toc-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
  }

  /* Each row is a monospace outline entry; level drives the left indent so the
     heading hierarchy reads at a glance. */
  .toc-row {
    display: block;
    width: 100%;
    text-align: left;
    font-family: "Berkeley Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.76rem;
    line-height: 1.4;
    color: var(--ink-soft);
    background: none;
    border: none;
    border-radius: var(--radius);
    padding: 0.26rem 0.45rem;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }
  .toc-row.lvl-1 {
    padding-left: 0.45rem;
    color: var(--ink);
    font-weight: 600;
  }
  .toc-row.lvl-2 {
    padding-left: 1.1rem;
  }
  .toc-row.lvl-3 {
    padding-left: 1.75rem;
  }
  .toc-row.lvl-4 {
    padding-left: 2.4rem;
  }
  .toc-row.lvl-5,
  .toc-row.lvl-6 {
    padding-left: 3.05rem;
    color: var(--ink-faint);
  }

  .toc-row:hover {
    background: var(--paper-sunk);
    color: var(--ink);
  }
  /* The keyboard cursor is a quiet ring; the active (scroll-tracked) heading
     gets the accent wash + a left bar so the two states never read the same. */
  .toc-row.cursor {
    box-shadow: inset 0 0 0 1px var(--rule-strong);
  }
  .toc-row.active {
    background: var(--accent-wash);
    color: var(--accent);
    font-weight: 600;
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .toc-empty {
    list-style: none;
    font-family: var(--font-sans);
    font-size: 0.74rem;
    color: var(--ink-faint);
    padding: 0.26rem 0.45rem;
  }
</style>
