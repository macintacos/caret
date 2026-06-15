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
    font-size: var(--text-sm);
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: 0.34rem 0.5rem;
    outline: none;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
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
     heading hierarchy reads at a glance. position: relative anchors the per-level
     indent guide (the ::before below) to the row box. */
  .toc-row {
    position: relative;
    display: block;
    width: 100%;
    text-align: left;
    font-family: "Berkeley Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: var(--text-sm);
    line-height: var(--leading-tight);
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
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  /* The indent guide: a quiet 1px hairline standing in the indent gutter of every
     nested row, so depth reads as structure (the Trees idiom) rather than as bare
     whitespace. Drawn with --rule, the same hairline that rules the rest of the
     chrome. Each level's guide sits 0.4rem left of where its text begins, so the
     ramp of guides steps right with depth into a visible ladder. The guide spans
     the row's full height (inset 0) and is click-through; lvl-1 is a top-level row
     and draws none. The padding ramp below is unchanged, so left-to-right indent
     ordering is preserved — the guide augments the padding, it doesn't replace it. */
  .toc-row.lvl-2::before,
  .toc-row.lvl-3::before,
  .toc-row.lvl-4::before,
  .toc-row.lvl-5::before,
  .toc-row.lvl-6::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--rule);
    pointer-events: none;
  }
  .toc-row.lvl-1 {
    padding-left: 0.45rem;
    color: var(--ink);
    font-weight: 600;
  }
  .toc-row.lvl-2 {
    padding-left: 1.1rem;
  }
  .toc-row.lvl-2::before {
    left: 0.7rem;
  }
  .toc-row.lvl-3 {
    padding-left: 1.75rem;
  }
  .toc-row.lvl-3::before {
    left: 1.35rem;
  }
  .toc-row.lvl-4 {
    padding-left: 2.4rem;
  }
  .toc-row.lvl-4::before {
    left: 2rem;
  }
  .toc-row.lvl-5,
  .toc-row.lvl-6 {
    padding-left: 3.05rem;
    color: var(--ink-faint);
  }
  .toc-row.lvl-5::before,
  .toc-row.lvl-6::before {
    left: 2.65rem;
  }

  /* The three interaction states bind to the chrome's interaction tokens: hover
     lifts the row onto the sunk surface, the keyboard cursor is a quiet
     --rule-strong ring, and the scroll-tracked active heading takes the accent
     wash. The cursor (ring) and active (wash) are deliberately kept visually
     distinct so the "where my keyboard focus is" and "where I am in the
     document" signals never collapse into one state. */
  .toc-row:hover {
    background: var(--paper-sunk);
    color: var(--ink);
  }
  .toc-row.cursor {
    box-shadow: inset 0 0 0 1px var(--rule-strong);
  }
  /* The active row is the "you are here" moment, and it is caret amber on purpose:
     --accent-wash and --accent both resolve to the brand amber the tool is named
     for, so this row stays brand-tied even if the generic interaction tokens above
     are ever neutralized to a hue-less grey. The amber tie is load-bearing, not
     incidental — keep this row pointed at the accent/brand token, never at a
     neutral interaction token. */
  .toc-row.active {
    background: var(--accent-wash);
    color: var(--accent);
    font-weight: 600;
  }

  .toc-empty {
    list-style: none;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--ink-faint);
    padding: 0.26rem 0.45rem;
  }
</style>
