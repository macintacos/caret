<script lang="ts">
  // Rendered-markdown plan surface (EXC-693). Renders the plan as a "decorated
  // source" view: one row per source line, the markdown syntax markers KEPT but
  // styled (bold is bold, `code` is monospace with a border, ## is heading-sized)
  // and colored so formatted text stands out from neutral prose. Because no
  // characters are removed, rows stay 1:1 with the source, so the per-line comment
  // model carries over: a plain click opens a comment on a line, a drag across
  // rows opens a range comment (via the same pure createLineDrag controller the
  // source view uses). No line-number gutter.
  //
  // This is a peer of diffview/SourceView.svelte, but light-DOM: caret owns the
  // rows, so there is no @pierre/diffs shadow grid and no slot projection. The
  // host renders comment threads / composer / scratch markers inline via the
  // `belowRow` snippet, which this component renders immediately after each row.
  import type { Snippet } from "svelte";
  import { decorateMarkdown, type DecoratedRow } from "../lib/decoratedMarkdown.ts";
  import { createLineDrag } from "../lib/diffview/lineDrag.ts";
  import { SCROLL_OFFSET_TOP } from "../lib/diffview/scroll.ts";
  import type { SourceDocument, SourceViewApi } from "../lib/diffview/types.ts";

  interface Props {
    /** The plan document to render (text drives the decoration). */
    doc: SourceDocument;
    /** Content identity (review id + version); a change re-derives the rows. */
    contentKey: string;
    /** Fires once the container is bound, handing the parent the scroll-to-line
     * API + host (mirrors SourceView so DiffPlanView can drive either surface). */
    onReady?: (api: SourceViewApi) => void;
    /** Opt-in click-to-comment: a plain click on a row opens a comment on it.
     * Skipped on a link click or while text is selected. */
    onLineComment?: (line: number) => void;
    /** Opt-in drag-to-range-comment: a click-drag across rows opens a range
     * comment on release. */
    onLineRangeComment?: (startLine: number, endLine: number) => void;
    /** Reports the live drag range (ascending) on change, null when it ends. */
    onLineRangePreview?: (range: { startLine: number; endLine: number } | null) => void;
    /** Range to keep highlighted (typically the open composer's range). */
    selectedRange?: { startLine: number; endLine: number } | null;
    /** Rendered inline immediately after the row for `line` — the host's comment
     * thread / composer / scratch markers for that line. */
    belowRow?: Snippet<[number]>;
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

  // Stable enablement flags so the interaction effects below wire up ONCE and
  // survive re-renders. The parent passes fresh inline callback closures on every
  // ~2s poll tick; an effect guard that read the raw prop would re-run each tick,
  // and its cleanup would tear down the listeners tracking an in-progress drag
  // (silently losing the range). Mirrors SourceView's rangeCommentingEnabled. The
  // handlers still call the props by reference, so they see the latest closures.
  const lineCommentEnabled = $derived(onLineComment != null);
  const rangeCommentEnabled = $derived(onLineRangeComment != null);

  // Decorated rows, memoized on plan text so an unchanged poll tick (same text,
  // fresh doc literal) keeps the same array reference and skips a re-render.
  // contentKey is read so the memo re-derives when the identity changes even if
  // two versions happened to share text.
  let rowsMemo: { key: string; text: string; rows: DecoratedRow[] } | undefined;
  const rows = $derived.by(() => {
    if (rowsMemo?.text !== doc.text || rowsMemo?.key !== contentKey) {
      rowsMemo = { key: contentKey, text: doc.text, rows: decorateMarkdown(doc.text) };
    }
    return rowsMemo.rows;
  });

  // Live drag range (during a drag) takes precedence over the composer's
  // selectedRange for the row highlight, so the selection band tracks the drag.
  let dragRange = $state<{ startLine: number; endLine: number } | undefined>();
  const highlight = $derived(dragRange ?? selectedRange ?? undefined);
  function inHighlight(line: number): boolean {
    return highlight != null && line >= highlight.startLine && line <= highlight.endLine;
  }

  let container = $state<HTMLElement | undefined>();

  // Hand the parent the scroll-to-line API + host once, on mount. The container is
  // stable for the component's life; `notified` keeps this to a single hand-off
  // even as onReady's identity changes across parent re-renders.
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

  // Scroll the row for 1-based `line` to near the top of the scroll container.
  // Computes an explicit scrollTop (not row.scrollIntoView, which can scroll the
  // page) so the jump lands the same regardless of current position — mirroring
  // diffview/scroll.ts, but for our light-DOM rows.
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
  // doesn't ALSO open a single-line comment. Cleared by that click.
  let dragOccurred = false;

  function handleClick(event: MouseEvent): void {
    if (dragOccurred) {
      dragOccurred = false;
      return;
    }
    const target = event.target as Element | null;
    if (target?.closest("a") != null) return; // link click belongs to the link
    const selection = typeof getSelection === "function" ? getSelection() : null;
    if (selection != null && !selection.isCollapsed) return; // active selection, not a comment
    const line = lineAt(target);
    if (line != null) onLineComment?.(line);
  }

  // Click-to-comment wired via addEventListener (not a template onclick) so the
  // presentational container needs no interactive ARIA role and no a11y lint
  // suppression. Gated on onLineComment so a read-only view stays inert.
  $effect(() => {
    const host = container;
    if (host == null || !lineCommentEnabled) return;
    host.addEventListener("click", handleClick);
    return () => host.removeEventListener("click", handleClick);
  });

  // Drag-to-range-comment. The pure createLineDrag controller decides the range
  // from a light-DOM hit-test; this effect feeds it pointer events, previews the
  // live range as a row highlight, suppresses the competing native text-selection
  // for a plain drag, and reports commit up. Shift+drag never arms (copy
  // escape-hatch). Mirrors SourceView's content-drag wiring, minus the shadow root.
  $effect(() => {
    const host = container;
    if (host == null || !rangeCommentEnabled) return;
    const drag = createLineDrag({
      lineFromPoint: (x, y) => lineAt(document.elementFromPoint(x, y)),
      onPreview: (range) => {
        dragRange = range == null ? undefined : { startLine: range.startLine, endLine: range.endLine };
        onLineRangePreview?.(range);
      },
      onCommit: (range) => {
        // Suppress the synthetic click that follows a drag-release; clear on the
        // next frame (after that click) so a drag that ends OUTSIDE the container,
        // where no click follows, can't strand the flag and eat the next click.
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
</script>

<div class="rendered-plan" bind:this={container}>
  {#each rows as row (row.line)}
    <div
      class="md-row md-{row.kind}"
      class:md-selected={inHighlight(row.line)}
      data-line={row.line}
      data-level={row.level}
    >{@html row.html}</div>
    {@render belowRow?.(row.line)}
  {/each}
</div>

<style>
  .rendered-plan {
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    line-height: 1.7;
    color: var(--ink);
    padding: 1rem clamp(1rem, 3vw, 2.5rem) 40vh;
  }

  /* Each source line is its own row; prose wraps within the row and leading
     indentation is preserved. */
  .md-row {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    scroll-margin-top: 12px;
  }

  /* The composer opens over the highlighted range; tint the covered rows amber
     to match the source view's selection band. */
  .md-selected {
    background: var(--mark);
  }

  /* A blank source line reads as vertical breathing room, not a collapsed row. */
  .md-blank {
    height: 0.9em;
  }

  /* Headings: colored + weighted, markers included, scaled by ATX level. */
  .md-heading {
    color: var(--md-decoration);
    font-family: var(--font-display);
    font-weight: 650;
    line-height: 1.3;
    margin-top: 0.6em;
  }
  .md-heading[data-level="1"] {
    font-size: 1.7em;
  }
  .md-heading[data-level="2"] {
    font-size: 1.4em;
  }
  .md-heading[data-level="3"] {
    font-size: 1.2em;
  }
  .md-heading[data-level="4"],
  .md-heading[data-level="5"],
  .md-heading[data-level="6"] {
    font-size: 1.05em;
  }

  .md-blockquote {
    color: var(--ink-soft);
    border-left: 3px solid var(--rule-strong);
    padding-left: 0.7em;
  }

  .md-hr {
    color: var(--md-decoration);
    opacity: 0.7;
  }

  /* Fenced code: monospace on a sunk surface, delimiters and interior visible. */
  .md-code-open,
  .md-code,
  .md-code-close {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--md-decoration);
    background: var(--paper-sunk);
    line-height: 1.5;
  }
  .md-code-open {
    border-top-left-radius: var(--radius);
    border-top-right-radius: var(--radius);
    padding-top: 0.3em;
  }
  .md-code-close {
    border-bottom-left-radius: var(--radius);
    border-bottom-right-radius: var(--radius);
    padding-bottom: 0.3em;
  }

  /* Inline decoration classes live inside {@html} row content, so they are not
     Svelte-scoped — target them globally, narrowed under .rendered-plan. Each
     keeps its raw delimiters (emitted by decoratedMarkdown) and takes the
     decoration color so the whole token, markers and all, reads as "rendered". */
  :global(.rendered-plan .md-strong) {
    font-weight: 700;
    color: var(--md-decoration);
  }
  :global(.rendered-plan .md-em) {
    font-style: italic;
    color: var(--md-decoration);
  }
  :global(.rendered-plan .md-del) {
    text-decoration: line-through;
    color: var(--md-decoration);
  }
  :global(.rendered-plan .md-code) {
    font-family: var(--font-mono);
    font-size: 0.9em;
    color: var(--md-decoration);
    background: var(--md-code-bg);
    border: 1px solid var(--rule-strong);
    border-radius: 4px;
    padding: 0.05em 0.3em;
  }
  :global(.rendered-plan .md-link) {
    color: var(--md-decoration);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  :global(.rendered-plan .md-marker) {
    color: var(--md-decoration);
  }
</style>
