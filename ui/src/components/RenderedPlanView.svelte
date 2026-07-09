<script lang="ts">
  // Rendered-markdown plan surface (EXC-693). Renders the plan as a styled
  // document built from markdown BLOCKS (planBlocks.ts), not one row per source
  // line: prose is joined (a soft-wrapped paragraph is one flowing block), lists,
  // tables, blockquotes and shiki code blocks render properly, while emphasis
  // keeps its markers visible (**bold** shows its asterisks, `x` its backticks).
  //
  // Interaction is by DISPLAY line — the line the reader actually sees. Because a
  // joined paragraph packs soft-wrapped source lines into flowing prose, a display
  // line can carry parts of two source lines (and a source line can wrap across two
  // display lines). Hovering or clicking a display line lights up that whole row and
  // maps it back to the source line(s) it covers (visualRows.ts groups the per-line
  // [data-line] rects into display rows), so the highlight matches what the eye calls
  // "the line" while the range handed to the reviewer stays correct — the user never
  // has to hunt for the right slice of text. The highlight is a full-width overlay
  // band painted behind the prose (spans can't express a whole-row band cleanly when
  // a source line is a mid-paragraph slice). A light-DOM peer of SourceView.svelte:
  // caret owns the rows, no @pierre/diffs shadow grid, and the host renders comment
  // threads / composer / scratch markers inline via the `belowRow` snippet, rendered
  // right after each block. No gutter.
  import type { Snippet } from "svelte";
  import { createLineDrag } from "../lib/diffview/lineDrag.ts";
  import { SCROLL_OFFSET_TOP } from "../lib/diffview/scroll.ts";
  import type { SourceDocument, SourceViewApi } from "../lib/diffview/types.ts";
  import {
    closeRowGaps,
    groupVisualRows,
    type LineRect,
    rowAtY,
    rowsIntersecting,
    type VisualRow,
  } from "../lib/diffview/visualRows.ts";
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
  // Absolutely-positioned overlay layers holding the full-width highlight bands: one
  // for the persistent selection, one for the transient hover. Bound to the template
  // elements; the interaction effects paint band children into them imperatively.
  let selectLayer = $state<HTMLElement | undefined>();
  let hoverLayer = $state<HTMLElement | undefined>();

  // The largest vertical gap (px) between two display rows we treat as still one
  // continuous run of lines — closed so hovering never falls into the thin leading
  // between wrapped lines. Block margins holding inline comment threads are larger
  // and stay open, so those regions aren't attributed to a line.
  const ROW_GAP_SNAP = 14;

  // Read the plan's display rows from the live layout: gather each source line's
  // rectangles, group them into display lines, and close the small inter-line gaps.
  // Geometry-based, so it yields real rows only under a browser layout (happy-dom has
  // none, and returns empty rows — the click path then falls back to the target).
  function computeRows(host: HTMLElement): VisualRow[] {
    const rects: LineRect[] = [];
    for (const el of host.querySelectorAll("[data-line]")) {
      const n = Number(el.getAttribute("data-line"));
      if (!Number.isFinite(n)) continue;
      for (const r of el.getClientRects()) {
        if (r.width <= 0 && r.height <= 0) continue;
        rects.push({ line: n, top: r.top, bottom: r.bottom });
      }
    }
    return closeRowGaps(groupVisualRows(rects), ROW_GAP_SNAP);
  }

  // Lay `rows` out as full-width highlight bands inside `layer` (host-relative), so a
  // hover move or selection change just repositions existing nodes rather than
  // churning the DOM. Bands span the column width via CSS (left/right: 0).
  function layoutBands(layer: HTMLElement, host: HTMLElement, rows: VisualRow[]): void {
    const hostTop = host.getBoundingClientRect().top;
    while (layer.childElementCount < rows.length) {
      const band = document.createElement("div");
      band.className = "md-row-hl";
      layer.appendChild(band);
    }
    while (layer.childElementCount > rows.length) layer.lastElementChild?.remove();
    rows.forEach((row, i) => {
      const band = layer.children[i] as HTMLElement | undefined;
      if (band == null) return;
      band.style.top = `${row.top - hostTop}px`;
      band.style.height = `${row.bottom - row.top}px`;
    });
  }

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

  // Open a comment for an ascending source range, collapsing a single line to the
  // single-line callback (both funnel to the same composer in the parent).
  function emitRange(a: number, b: number): void {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (lo === hi && onLineComment != null) onLineComment(lo);
    else onLineRangeComment?.(lo, hi);
  }

  // Set when a drag commits so the synthetic click that follows a drag-release
  // doesn't ALSO open a single-line comment. Cleared by that click / next frame.
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
    const host = container;
    if (host == null) return;
    // Comment on the DISPLAY line under the pointer: the whole visual row, mapped
    // back to the source line(s) it covers — so clicking a joined row comments both.
    const row = rowAtY(computeRows(host), event.clientY);
    const first = row?.lines[0];
    const last = row?.lines[row.lines.length - 1];
    if (row != null && row.bottom > row.top && first != null && last != null) {
      emitRange(first, last);
      return;
    }
    // No browser layout (unit tests dispatch a click on a [data-line]) → single line.
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

  // Drag-to-range-comment across display rows. The pure createLineDrag controller
  // only needs a monotonic integer per point to form a range, so we feed it the
  // DISPLAY-row index (rows snapshotted at press time — layout is stable through a
  // drag) and map that index span back to the source line(s) those rows cover. This
  // previews the live source range as a highlight, suppresses the competing native
  // text-selection for a plain drag, and reports commit up. Mirrors SourceView.
  $effect(() => {
    const host = container;
    if (host == null || !rangeCommentEnabled) return;
    let rows: VisualRow[] = [];
    const sourceRange = (idxA: number, idxB: number): { startLine: number; endLine: number } => {
      const lines = rows.slice(Math.min(idxA, idxB), Math.max(idxA, idxB) + 1).flatMap((r) => r.lines);
      return { startLine: Math.min(...lines), endLine: Math.max(...lines) };
    };
    const drag = createLineDrag({
      lineFromPoint: (_x, y) => {
        const i = rows.findIndex((r) => y >= r.top && y <= r.bottom);
        return i >= 0 ? i : null;
      },
      onPreview: (range) => {
        const r = range == null ? undefined : sourceRange(range.startLine, range.endLine);
        dragRange = r;
        onLineRangePreview?.(r ?? null);
      },
      onCommit: (range) => {
        // Suppress the synthetic click after a drag-release; clear next frame so a
        // drag ending OUTSIDE the container (no following click) can't strand it.
        dragOccurred = true;
        requestAnimationFrame(() => {
          dragOccurred = false;
        });
        const r = sourceRange(range.startLine, range.endLine);
        onLineRangeComment?.(r.startLine, r.endLine);
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
      rows = computeRows(host); // snapshot the display rows before arming the gesture
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

  // Hover highlight: paint a single full-width band over the DISPLAY row under the
  // pointer, so the whole visual line lights up (not a slice), even where two source
  // lines share a row. rAF-coalesced so a move burst is one probe.
  $effect(() => {
    const host = container;
    const layer = hoverLayer;
    if (host == null || layer == null) return;
    let raf = 0;
    let y = 0;
    const probe = (): void => {
      raf = 0;
      const row = rowAtY(computeRows(host), y);
      layoutBands(layer, host, row != null ? [row] : []);
    };
    const onMove = (e: PointerEvent): void => {
      y = e.clientY;
      if (raf === 0) raf = requestAnimationFrame(probe);
    };
    const onLeave = (): void => {
      cancelAnimationFrame(raf);
      raf = 0;
      layoutBands(layer, host, []);
    };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      layoutBands(layer, host, []);
    };
  });

  // Selection band: paint full-width bands over every display row carrying a line in
  // the open composer's / live-drag range. Re-runs on the range and on a block
  // re-render (a poll tick repaints the line elements), and keeps itself in sync with
  // reflow (a width change re-wraps the prose, moving the rows) via a ResizeObserver.
  $effect(() => {
    const host = container;
    const layer = selectLayer;
    if (host == null || layer == null) return;
    void blocks; // repaint after a re-render swaps the line elements
    const h = highlight;
    const paint = (): void =>
      layoutBands(layer, host, h == null ? [] : rowsIntersecting(computeRows(host), h.startLine, h.endLine));
    paint();
    if (h == null) return;
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(paint) : null;
    ro?.observe(host);
    window.addEventListener("resize", paint);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", paint);
    };
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
  <!-- Highlight overlays behind the prose: selection first, hover above it. Both are
       pointer-transparent and their bands are painted imperatively (see layoutBands). -->
  <div class="md-hl-layer md-hl-select" bind:this={selectLayer} aria-hidden="true"></div>
  <div class="md-hl-layer md-hl-hover" bind:this={hoverLayer} aria-hidden="true"></div>
  {#each blocks as block, i (block.startLine)}
    <div class="md-block md-{block.kind}">
      {@render blockContent(block)}
    </div>
    {@render belowRow?.(block.startLine, belowEnds[i] ?? block.endLine)}
  {/each}
</div>

<style>
  .rendered-plan {
    position: relative; /* containing block for the highlight overlay layers */
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    line-height: 1.7;
    color: var(--ink);
    /* Cap the document to a readable measure and left-align it against the
       contents pane. The source grid scrolls its long lines, but rendered prose
       wraps, so without a cap it would sprawl the full viewport width; 900px
       keeps line length comfortable. box-sizing is border-box (app.css reset),
       so the cap includes the padding. */
    --plan-pad-x: clamp(1.4rem, 3vw, 2.5rem);
    max-width: 900px;
    padding: 1rem var(--plan-pad-x) 40vh;
  }

  /* Blocks are structural only: the [data-line] elements inside them carry the
     source-line geometry the display-row hit-test reads (see computeRows), and the
     highlight is painted as an overlay band — not a background on the block. */
  .md-block {
    position: relative;
    margin: 0.35rem 0;
  }
  /* Headings open a new section, so give them clear room above — more than the
     default block gap — to space the document out. The first block sits flush
     against the top padding, so it keeps no extra top margin. */
  .rendered-plan > .md-heading {
    margin-top: 1.6rem;
  }
  .rendered-plan > .md-block:first-child {
    margin-top: 0;
  }

  /* Line elements are the hit/scroll targets; keep a little scroll margin so a
     scrolled-to line clears the top edge. The highlight itself is the overlay band
     below, not a background on the line. */
  :global(.rendered-plan [data-line]) {
    scroll-margin-top: 12px;
  }

  /* Full-width highlight overlays behind the prose. Each layer fills the column; its
     bands are absolutely positioned display-row rectangles painted by layoutBands.
     Pointer-transparent so they never intercept a click, and placed before the block
     content in the DOM so the positioned blocks paint their text above the bands. */
  .md-hl-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  :global(.rendered-plan .md-row-hl) {
    position: absolute;
    /* Match the content width (inset by the column padding) so the band aligns with
       the block content and is fully covered by opaque panels (code, table headers)
       — no highlight edges peeking out past them into the padding. */
    left: var(--plan-pad-x);
    right: var(--plan-pad-x);
    border-radius: 6px;
  }
  /* Selection: the amber mark the source view uses. Hover: the stronger active mark,
     so the hovered row reads clearly (not a faint tint) and stands apart. */
  :global(.rendered-plan .md-hl-select .md-row-hl) {
    background: var(--mark);
  }
  :global(.rendered-plan .md-hl-hover .md-row-hl) {
    background: var(--mark-active);
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
