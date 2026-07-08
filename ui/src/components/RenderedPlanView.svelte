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
    if (line != null) onLineComment?.(line);
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
        dragRange = range ?? undefined;
        onLineRangePreview?.(range ?? null);
      },
      onCommit: (range) => {
        // Suppress the synthetic click after a drag-release; clear next frame so a
        // drag ending OUTSIDE the container (no following click) can't strand it.
        dragOccurred = true;
        requestAnimationFrame(() => {
          dragOccurred = false;
        });
        onLineRangeComment?.(range.startLine, range.endLine);
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

  // Per-line hover highlight (mirrors the source view's line hover). Tag only the
  // INNERMOST [data-line] under the pointer with `is-hovered`, so a nested item or
  // a line inside a joined paragraph lights up alone rather than its whole block.
  // Imperative because the line elements live inside {@html} (prose, code) where a
  // Svelte class binding can't reach; rAF-coalesced so a move burst is one probe.
  $effect(() => {
    const host = container;
    if (host == null) return;
    let hovered: Element | null = null;
    let raf = 0;
    let x = 0;
    let y = 0;
    const apply = (el: Element | null): void => {
      if (el === hovered) return;
      hovered?.classList.remove("is-hovered");
      el?.classList.add("is-hovered");
      hovered = el;
    };
    const probe = (): void => {
      raf = 0;
      const line = document.elementFromPoint(x, y)?.closest("[data-line]") ?? null;
      apply(line != null && host.contains(line) ? line : null);
    };
    const onMove = (e: PointerEvent): void => {
      x = e.clientX;
      y = e.clientY;
      if (raf === 0) raf = requestAnimationFrame(probe);
    };
    const onLeave = (): void => {
      cancelAnimationFrame(raf);
      raf = 0;
      apply(null);
    };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      apply(null);
    };
  });

  // Per-line selection band: mark every [data-line] whose line falls in the open
  // composer's / live-drag range with `is-selected`. Re-runs on the range and on
  // a block re-render (a poll tick paints fresh line elements that need re-marking).
  $effect(() => {
    const host = container;
    if (host == null) return;
    void blocks; // re-mark after a re-render swaps the line elements
    const h = highlight;
    for (const el of host.querySelectorAll<HTMLElement>("[data-line]")) {
      const n = Number(el.getAttribute("data-line"));
      el.classList.toggle("is-selected", h != null && n >= h.startLine && n <= h.endLine);
    }
  });
</script>

<!-- Recursive block renderer. blockContent renders a block's inner markup (used
     both for top-level blocks and, recursively, for the children of blockquotes
     and list items); only top-level blocks are wrapped as anchors below. -->
{#snippet blockContent(block: PlanBlock)}
  {#if block.kind === "paragraph"}
    <!-- One data-line span per source line: the view flows them into a paragraph
         (a space rejoins the soft wraps), but each is its own hover/click target. -->
    <p class="md-p">{#each block.lines as seg, i (seg.line)}{#if i > 0}{" "}{/if}<span
          class="md-line"
          data-line={seg.line}>{@html seg.html}</span>{/each}</p>
  {:else if block.kind === "heading"}
    <div class="md-h md-line" data-line={block.startLine} data-level={block.level}>
      {@html block.html}
    </div>
  {:else if block.kind === "code"}
    <RenderedCode lang={block.lang} text={block.text} firstLine={block.startLine + 1} />
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
          <tr class="md-line" data-line={block.headerLine}>
            {#each block.header as cell, i (i)}
              <th style:text-align={alignOf(block.align[i])}>{@html cell}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each block.rows as row, r (r)}
            <tr class="md-line" data-line={block.rowLines[r] ?? block.startLine}>
              {#each row as cell, c (c)}
                <td style:text-align={alignOf(block.align[c])}>{@html cell}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if block.kind === "hr"}
    <hr class="md-rule md-line" data-line={block.startLine} />
  {:else if block.kind === "footnote"}
    <div class="md-fn-def-row md-line" data-line={block.startLine}>
      <sup class="md-fn-def">{block.label}</sup> {@html block.html}
    </div>
  {/if}
{/snippet}

{#snippet listItem(item: import("../lib/planBlocks.ts").PlanListItem)}
  <li class="md-item" class:md-task={item.task}>
    <!-- The item's leading text is one data-line target per source line (a wrapped
         bullet's continuation is its own target); the checkbox precedes them and
         nested children carry their own targets, so hovering never lights the whole
         sub-list. -->
    {#if item.task}<input class="md-check" type="checkbox" checked={item.checked} disabled />{/if}
    {#each item.lines as seg, i (seg.line)}{#if i > 0}{" "}{/if}<span
        class="md-line"
        data-line={seg.line}>{@html seg.html}</span>{/each}
    {#each item.children as child, i (i)}{@render blockContent(child)}{/each}
  </li>
{/snippet}

<div class="rendered-plan" bind:this={container}>
  {#each blocks as block, i (block.startLine)}
    <div class="md-block md-{block.kind}">
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
    /* Cap the document to a readable measure and left-align it against the
       contents pane. The source grid scrolls its long lines, but rendered prose
       wraps, so without a cap it would sprawl the full viewport width; 900px
       keeps line length comfortable. box-sizing is border-box (app.css reset),
       so the cap includes the padding. */
    max-width: 900px;
    padding: 1rem clamp(1.4rem, 3vw, 2.5rem) 40vh;
  }

  /* Blocks are structural only: the per-source-line elements inside them are the
     hover / click / drag targets (see [data-line] below), so the interaction is
     line-level like the source view rather than one anchor per whole block. */
  .md-block {
    position: relative;
    margin: 0.35rem 0;
  }

  /* Per-source-line hover + selection. The hover effect tags the innermost
     [data-line] under the pointer with is-hovered; the selection effect tags the
     open composer's / live drag's covered lines with is-selected (the amber band
     the source view uses). Global because most line elements live inside {@html}
     — prose spans, shiki code lines — beyond Svelte's scoping. */
  :global(.rendered-plan [data-line]) {
    border-radius: 4px;
    scroll-margin-top: 12px;
  }
  :global(.rendered-plan [data-line].is-hovered) {
    background: color-mix(in srgb, var(--ink) 7%, transparent);
  }
  :global(.rendered-plan [data-line].is-selected) {
    background: var(--mark);
  }
  /* Inline line spans (prose, code) clone the highlight box across a soft wrap so
     a wrapped source line reads as rounded runs, not one ragged slab. */
  :global(.rendered-plan span[data-line]) {
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  /* Prose: a single newline is a soft continuation — white-space:normal collapses
     it (and the space between segments) so a soft-wrapped paragraph reads as one
     flowing line. */
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
  /* Task-list items drop the bullet for a real checkbox that precedes the text.
     Kept inline (not flex) so a wrapped bullet's line segments flow and wrap as
     normal text, each its own hover/click target. */
  .md-task {
    list-style: none;
    margin-left: -1.4rem;
    padding-left: 0;
  }
  .md-check {
    margin: 0 0.45rem 0 0;
    vertical-align: baseline;
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
