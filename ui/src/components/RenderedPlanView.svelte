<script lang="ts">
  // Rendered-markdown plan surface (EXC-693). Renders the plan as a styled
  // document built from markdown BLOCKS (planBlocks.ts), not one row per source
  // line: prose is joined (a soft-wrapped paragraph is one flowing block), lists,
  // tables, blockquotes and shiki code blocks render properly, while emphasis
  // keeps its markers visible (**bold** shows its asterisks, `x` its backticks).
  //
  // Each top-level block is one comment anchor carrying its exact source range
  // (data-line = start, data-line-end = end). Clicking a block opens a comment on
  // its whole source range; dragging across blocks opens a range from the first
  // block's start to the last block's end — so what's sent to the reviewer stays
  // 1:1 with the source even though the view visually combines lines. A light-DOM
  // peer of diffview/SourceView.svelte: caret owns the rows, no @pierre/diffs
  // shadow grid, and the host renders comment threads / composer / scratch markers
  // inline via the `belowRow` snippet, rendered right after each block. No gutter.
  import type { Snippet } from "svelte";
  import { createLineDrag } from "../lib/diffview/lineDrag.ts";
  import { SCROLL_OFFSET_TOP } from "../lib/diffview/scroll.ts";
  import type { SourceDocument, SourceViewApi } from "../lib/diffview/types.ts";
  import { type Align, type PlanBlock, parsePlan } from "../lib/planBlocks.ts";
  import RenderedCode from "./RenderedCode.svelte";

  interface Props {
    /** The plan document to render (text drives the blocks). */
    doc: SourceDocument;
    /** Content identity (review id + version); a change re-derives the blocks. */
    contentKey: string;
    /** Fires once the container is bound, handing the parent the scroll-to-line
     * API + host (mirrors SourceView so DiffPlanView can drive either surface). */
    onReady?: (api: SourceViewApi) => void;
    /** Opt-in click-to-comment on a single-line block. */
    onLineComment?: (line: number) => void;
    /** Opt-in range comment: a multi-line block click, or a drag across blocks. */
    onLineRangeComment?: (startLine: number, endLine: number) => void;
    /** Reports the live drag range (ascending, expanded to whole blocks), null when it ends. */
    onLineRangePreview?: (range: { startLine: number; endLine: number } | null) => void;
    /** Range to keep highlighted (typically the open composer's range). */
    selectedRange?: { startLine: number; endLine: number } | null;
    /** Rendered inline immediately after the block spanning [startLine, endLine]
     * — the host's comment thread / composer / scratch markers for that block. */
    belowRow?: Snippet<[number, number]>;
  }

  let {
    doc,
    contentKey,
    onReady,
    onLineComment,
    onLineRangeComment,
    onLineRangePreview,
    selectedRange = null,
    belowRow,
  }: Props = $props();

  // Stable enablement flags so the interaction effects wire up ONCE and survive
  // the parent's ~2s poll re-render (which hands fresh inline callback closures).
  // The handlers still call the props by reference, so they see the latest closures.
  const clickEnabled = $derived(onLineComment != null || onLineRangeComment != null);
  const rangeCommentEnabled = $derived(onLineRangeComment != null);

  // Blocks, memoized on plan text (+ contentKey) so an unchanged poll tick keeps
  // the same array reference and skips a re-render.
  let blocksMemo: { key: string; text: string; blocks: PlanBlock[] } | undefined;
  const blocks = $derived.by(() => {
    if (blocksMemo?.text !== doc.text || blocksMemo?.key !== contentKey) {
      blocksMemo = { key: contentKey, text: doc.text, blocks: parsePlan(doc.text) };
    }
    return blocksMemo.blocks;
  });

  // Each top-level block is one anchor: its start line → its full source range.
  // The drag hit-test returns a block's start line; this expands a start↔start
  // range back to whole-block coverage on commit.
  const anchorByStart = $derived.by(() => {
    const map = new Map<number, { startLine: number; endLine: number }>();
    for (const b of blocks) map.set(b.startLine, { startLine: b.startLine, endLine: b.endLine });
    return map;
  });

  // The end line each block "owns" for its belowRow: its own end, extended over the
  // blank lines up to the next block (the last block reaches the end of the plan).
  // Blank-line "space" tokens emit no block, so without this a comment anchored to a
  // gap line — one made in the source view, then viewed here — would match no block
  // and render nowhere. Contiguous, non-overlapping: every source line maps to one.
  const belowEnds = $derived.by(() => {
    const total = doc.text.split("\n").length;
    return blocks.map((b, i) =>
      i + 1 < blocks.length ? (blocks[i + 1]?.startLine ?? b.endLine + 1) - 1 : Math.max(b.endLine, total),
    );
  });

  // Live drag range (during a drag) takes precedence over the composer's
  // selectedRange for the highlight, so the selection band tracks the drag.
  let dragRange = $state<{ startLine: number; endLine: number } | undefined>();
  const highlight = $derived(dragRange ?? selectedRange ?? undefined);
  function isSelected(b: PlanBlock): boolean {
    const h = highlight;
    return h != null && b.startLine <= h.endLine && b.endLine >= h.startLine;
  }

  function alignOf(a: Align | undefined): "left" | "center" | "right" {
    return a === "center" || a === "right" ? a : "left";
  }

  let container = $state<HTMLElement | undefined>();

  // Hand the parent the scroll-to-line API + host once, on mount.
  let notified = false;
  $effect(() => {
    if (container == null || notified) return;
    notified = true;
    const el = container;
    onReady?.({ scrollToLine: (line) => scrollToRow(el, line), host: el });
  });

  function nearestScrollParent(el: HTMLElement): HTMLElement | undefined {
    let node = el.parentElement;
    while (node != null) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return node;
      node = node.parentElement;
    }
    return undefined;
  }

  function prefersReducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // Scroll the block anchored at 1-based `line` to near the top of the scroll
  // container (explicit scrollTop, not scrollIntoView, so the jump lands the same
  // regardless of position — mirrors diffview/scroll.ts for our light-DOM rows).
  function scrollToRow(el: HTMLElement, line: number): boolean {
    const row = el.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (row == null) return false;
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    const scroller = nearestScrollParent(el);
    if (scroller == null) {
      row.scrollIntoView({ block: "start", behavior });
      return true;
    }
    const rowRect = row.getBoundingClientRect();
    const hostRect = scroller.getBoundingClientRect();
    const top = Math.max(0, scroller.scrollTop + (rowRect.top - hostRect.top) - SCROLL_OFFSET_TOP);
    scroller.scrollTo({ top, behavior });
    return true;
  }

  function lineAt(el: Element | null): number | null {
    const row = el?.closest("[data-line]");
    const n = row ? Number(row.getAttribute("data-line")) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  }

  // Expand a start↔start drag range to whole-block coverage (first block's start
  // through the last block's end).
  function expandRange(r: { startLine: number; endLine: number }): { startLine: number; endLine: number } {
    const first = anchorByStart.get(r.startLine);
    const last = anchorByStart.get(r.endLine);
    return { startLine: first?.startLine ?? r.startLine, endLine: last?.endLine ?? r.endLine };
  }

  // Open a comment on a block's range — a single-line block goes through
  // onLineComment, a multi-line block through onLineRangeComment.
  function commentOn(a: { startLine: number; endLine: number }): void {
    if (a.startLine === a.endLine) onLineComment?.(a.startLine);
    else onLineRangeComment?.(a.startLine, a.endLine);
  }

  // Set when a drag commits so the synthetic click that follows a drag-release
  // doesn't ALSO open a single-block comment. Cleared by that click / next frame.
  let dragOccurred = false;

  function handleClick(event: MouseEvent): void {
    if (dragOccurred) {
      dragOccurred = false;
      return;
    }
    const target = event.target as Element | null;
    // Links, checkboxes and other controls own their own click.
    if (target?.closest("a, input, button, label, summary") != null) return;
    const selection = typeof getSelection === "function" ? getSelection() : null;
    if (selection != null && !selection.isCollapsed) return; // active selection, not a comment
    const line = lineAt(target);
    if (line == null) return;
    const anchor = anchorByStart.get(line);
    if (anchor) commentOn(anchor);
  }

  // Click-to-comment via addEventListener (not a template onclick) so the
  // presentational container needs no interactive ARIA role. Gated so a read-only
  // view stays inert.
  $effect(() => {
    const host = container;
    if (host == null || !clickEnabled) return;
    host.addEventListener("click", handleClick);
    return () => host.removeEventListener("click", handleClick);
  });

  // Drag-to-range-comment across blocks. The pure createLineDrag controller decides
  // the range from a light-DOM hit-test; this feeds it pointer events, previews the
  // live (block-expanded) range as a highlight, suppresses the competing native
  // text-selection for a plain drag, and reports commit up. Mirrors SourceView.
  $effect(() => {
    const host = container;
    if (host == null || !rangeCommentEnabled) return;
    const drag = createLineDrag({
      lineFromPoint: (x, y) => lineAt(document.elementFromPoint(x, y)),
      onPreview: (range) => {
        const expanded = range == null ? undefined : expandRange(range);
        dragRange = expanded;
        onLineRangePreview?.(expanded ?? null);
      },
      onCommit: (range) => {
        // Suppress the synthetic click after a drag-release; clear next frame so a
        // drag ending OUTSIDE the container (no following click) can't strand it.
        dragOccurred = true;
        requestAnimationFrame(() => {
          dragOccurred = false;
        });
        const expanded = expandRange(range);
        onLineRangeComment?.(expanded.startLine, expanded.endLine);
      },
    });
    const onMove = (e: PointerEvent) => drag.pointermove(e);
    function suppressSelect(on: boolean): void {
      for (const prop of ["user-select", "-webkit-user-select"]) {
        if (on) host!.style.setProperty(prop, "none");
        else host!.style.removeProperty(prop);
      }
    }
    function endGesture(): void {
      suppressSelect(false);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
    }
    function onUp(e: PointerEvent): void {
      drag.pointerup(e);
      endGesture();
    }
    function onCancel(): void {
      drag.cancel();
      endGesture();
    }
    const onDown = (e: PointerEvent): void => {
      if (!drag.pointerdown(e)) return;
      suppressSelect(true);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
      window.addEventListener("blur", onCancel);
    };
    host.addEventListener("pointerdown", onDown);
    return () => {
      host.removeEventListener("pointerdown", onDown);
      drag.cancel();
      endGesture();
    };
  });
</script>

<!-- Recursive block renderer. blockContent renders a block's inner markup (used
     both for top-level blocks and, recursively, for the children of blockquotes
     and list items); only top-level blocks are wrapped as anchors below. -->
{#snippet blockContent(block: PlanBlock)}
  {#if block.kind === "paragraph"}
    <p class="md-p">{@html block.html}</p>
  {:else if block.kind === "heading"}
    <div class="md-h" data-level={block.level}>{@html block.html}</div>
  {:else if block.kind === "code"}
    <RenderedCode lang={block.lang} text={block.text} />
  {:else if block.kind === "blockquote"}
    <blockquote class="md-quote">
      {#each block.children as child, i (i)}{@render blockContent(child)}{/each}
    </blockquote>
  {:else if block.kind === "list"}
    {#if block.ordered}
      <ol class="md-ol" start={block.start ?? 1}>
        {#each block.items as item, i (i)}{@render listItem(item)}{/each}
      </ol>
    {:else}
      <ul class="md-ul">
        {#each block.items as item, i (i)}{@render listItem(item)}{/each}
      </ul>
    {/if}
  {:else if block.kind === "table"}
    <div class="md-table-wrap">
      <table class="md-tbl">
        <thead>
          <tr>
            {#each block.header as cell, i (i)}
              <th style:text-align={alignOf(block.align[i])}>{@html cell}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each block.rows as row, r (r)}
            <tr>
              {#each row as cell, c (c)}
                <td style:text-align={alignOf(block.align[c])}>{@html cell}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if block.kind === "hr"}
    <hr class="md-rule" />
  {:else if block.kind === "footnote"}
    <div class="md-fn-def-row"><sup class="md-fn-def">{block.label}</sup> {@html block.html}</div>
  {/if}
{/snippet}

{#snippet listItem(item: import("../lib/planBlocks.ts").PlanListItem)}
  <li class="md-item" class:md-task={item.task}>
    {#if item.task}<input class="md-check" type="checkbox" checked={item.checked} disabled />{/if}
    {#if item.html != null}<span class="md-li-text">{@html item.html}</span>{/if}
    {#each item.children as child, i (i)}{@render blockContent(child)}{/each}
  </li>
{/snippet}

<div class="rendered-plan" bind:this={container}>
  {#each blocks as block, i (block.startLine)}
    <div
      class="md-block md-{block.kind}"
      class:md-selected={isSelected(block)}
      data-line={block.startLine}
      data-line-end={block.endLine}
    >
      <span class="md-plus" aria-hidden="true"></span>
      {@render blockContent(block)}
    </div>
    {@render belowRow?.(block.startLine, belowEnds[i] ?? block.endLine)}
  {/each}
</div>

<style>
  .rendered-plan {
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    line-height: 1.7;
    color: var(--ink);
    padding: 1rem clamp(1.4rem, 3vw, 2.5rem) 40vh;
  }

  /* Each top-level block is one comment anchor. A hover background + a left "+"
     mirror the source view's line affordance so it's clear a click comments here;
     the covered rows tint amber (the source view's selection band) while selected. */
  .md-block {
    position: relative;
    margin: 0.35rem -0.6rem;
    padding: 0.15rem 0.6rem 0.15rem 1.5rem;
    border-radius: var(--radius);
    scroll-margin-top: 12px;
  }
  .md-block:hover {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .md-selected,
  .md-selected:hover {
    background: var(--mark);
  }
  .md-plus {
    position: absolute;
    left: 0.35rem;
    top: 0.2rem;
    width: 1rem;
    height: 1.2rem;
    display: grid;
    place-items: center;
    color: var(--accent);
    font-weight: 700;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .md-plus::before {
    content: "+";
  }
  .md-block:hover .md-plus {
    opacity: 0.7;
  }

  /* Prose: a single newline is a soft continuation — white-space:normal collapses
     it so a soft-wrapped paragraph reads as one flowing line. */
  .md-p {
    margin: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  /* Headings: amber (matching the source view's markdown heading color), the ##
     marker kept visible, scaled by level — smaller than a document H1 so the plan
     reads as a compact review surface. */
  .md-h {
    color: var(--accent);
    font-family: var(--font-display);
    font-weight: 650;
    line-height: 1.3;
  }
  .md-h[data-level="1"] {
    font-size: 1.4em;
  }
  .md-h[data-level="2"] {
    font-size: 1.25em;
  }
  .md-h[data-level="3"] {
    font-size: 1.1em;
  }
  .md-h[data-level="4"],
  .md-h[data-level="5"],
  .md-h[data-level="6"] {
    font-size: 1em;
  }

  .md-quote {
    margin: 0;
    border-left: 3px solid var(--rule-strong);
    padding-left: 0.85rem;
    color: var(--ink-soft);
  }
  .md-quote .md-quote {
    margin-top: 0.3rem;
  }

  .md-ul,
  .md-ol {
    margin: 0;
    padding-left: 1.4rem;
  }
  .md-item {
    margin: 0.12rem 0;
  }
  .md-item .md-ul,
  .md-item .md-ol {
    margin-top: 0.12rem;
  }
  /* Task-list items drop the bullet for a real checkbox, aligned with the text. */
  .md-task {
    list-style: none;
    margin-left: -1.4rem;
    padding-left: 0;
    display: flex;
    gap: 0.45rem;
    align-items: baseline;
  }
  .md-check {
    margin: 0;
    accent-color: var(--accent);
  }

  .md-table-wrap {
    overflow-x: auto;
    margin: 0.35rem 0;
  }
  .md-tbl {
    border-collapse: collapse;
    font-size: 0.95em;
  }
  .md-tbl th,
  .md-tbl td {
    border: 1px solid var(--rule-strong);
    padding: 0.3rem 0.6rem;
  }
  .md-tbl th {
    background: var(--paper-sunk);
    font-weight: 650;
  }

  .md-rule {
    border: none;
    border-top: 1px solid var(--rule-strong);
    margin: 0.7rem 0;
  }

  .md-fn-def-row {
    font-size: 0.9em;
    color: var(--ink-soft);
  }
  .md-fn-def {
    color: var(--accent-bright);
    font-weight: 650;
    margin-right: 0.3rem;
  }

  /* Inline decoration classes live inside {@html}, so they aren't Svelte-scoped —
     target them globally, narrowed under .rendered-plan. Each keeps its raw
     delimiters (from decoratedInline) and takes a palette-fitting tint so
     formatted text stands out while prose stays neutral --ink. */
  :global(.rendered-plan .md-strong) {
    font-weight: 700;
    color: var(--accent);
  }
  :global(.rendered-plan .md-em) {
    font-style: italic;
    color: var(--accent-bright);
  }
  :global(.rendered-plan .md-del) {
    text-decoration: line-through;
    color: var(--ink-faint);
  }
  :global(.rendered-plan .md-codespan) {
    font-family: var(--font-mono);
    font-size: 0.9em;
    color: var(--accent-bright);
    background: var(--accent-wash);
    border: 1px solid var(--rule-strong);
    border-radius: 4px;
    padding: 0.05em 0.3em;
  }
  :global(.rendered-plan .md-link) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  :global(.rendered-plan .md-marker) {
    color: var(--accent);
  }
  :global(.rendered-plan .md-fn-ref) {
    color: var(--accent-bright);
    font-weight: 650;
    font-size: 0.85em;
  }
</style>
