<script lang="ts">
  // Source-view plan surface: renders the active plan version's stored text as
  // line-numbered markdown source through the diffview SourceView wrapper, with
  // a left-hand filterable contents pane and a line gutter for creating comments.
  // The contents pane jumps the source view to a heading's line. Hovering a line
  // shows the built-in gutter `+`; clicking it opens an inline composer at the
  // selected line or range, and submitting creates a line-anchored
  // {startLine, endLine} annotation in the autosave working copy. Saved comments
  // and the open composer render inline in the library's per-line annotation rows
  // (see annotationSlot.ts): the wrapper is fed one line annotation per anchored
  // line so the library reserves the row, and the card/composer DOM is projected
  // into that row's slot, so a comment sits between the code lines instead of
  // floating over them. The wrapper owns the @pierre/diffs lifecycle and preserves
  // the view instance across re-renders when the contentKey is unchanged, so
  // scroll survives the 2s poll re-delivering the same version.
  //
  // When the review has multiple stored versions, a compare control lets the
  // reviewer diff any two of them (base vs. target) through the SourceDiffView
  // wrapper, switching the split/unified layout at runtime. The contents pane,
  // gutter, and annotations belong to the single-version view only — compare mode
  // is a clean read-only diff with none of them.
  import SourceView from "../lib/diffview/SourceView.svelte";
  import SourceDiffView from "../lib/diffview/SourceDiffView.svelte";
  import {
    groupAnnotationsByLine,
    slotInto,
    toLineAnnotations,
  } from "../lib/diffview/annotationSlot.ts";
  import { type BracketSpan, bracketLayer } from "../lib/diffview/bracket.ts";
  import { createSourceCommenting, normalizeRange, rangeLabel } from "../lib/diffview/commenting.ts";
  import { dismissDragHint, isDragHintDismissed } from "../lib/diffview/dragHint.ts";
  import { buildLinkLayer } from "../lib/diffview/links.ts";
  import { readDiffStyle, writeDiffStyle } from "../lib/diffStylePref.ts";
  import { readDiffIndicators, writeDiffIndicators } from "../lib/diffIndicatorsPref.ts";
  import {
    type Overflow,
    readDisableLineNumbers,
    readOverflow,
    writeDisableLineNumbers,
    writeOverflow,
  } from "../lib/diffReaderPref.ts";
  import { type CompareStore, createCompare } from "../state/compare.svelte.ts";
  import VersionComparePicker from "./VersionComparePicker.svelte";
  import ReaderAffordances from "./ReaderAffordances.svelte";
  import type { SourceViewGutter } from "../lib/diffview/options.ts";
  import type { SourceViewApi, SourceViewOptions } from "../lib/diffview/types.ts";
  import { activeHeadingLine, extractHeadings } from "../lib/toc.ts";
  import {
    type Annotation,
    type ClientReview,
    isLegacyAnnotation,
    isLineAnnotation,
  } from "@core/types";
  import SourceComposer from "./SourceComposer.svelte";
  import SourceAnnotationThread from "./SourceAnnotationThread.svelte";
  import LegacyAnnotationList from "./LegacyAnnotationList.svelte";
  import SourceToc from "./SourceToc.svelte";

  interface Props {
    /** The review whose current plan version is rendered. */
    review: ClientReview;
    /** Persist a gutter-created line-anchored annotation. */
    onCreateLineAnnotation: (anchor: {
      startLine: number;
      endLine: number;
      comment: string;
    }) => void;
    /** The working-copy annotations to display over the source. */
    annotations: Annotation[];
    /** The single focused annotation id (drives expand + highlight), or null. */
    focusedAnnotation: string | null;
    onEditAnnotation: (id: string, comment: string) => void;
    onDeleteAnnotation: (id: string) => void;
    onFocusAnnotation: (id: string) => void;
  }

  let {
    review,
    onCreateLineAnnotation,
    annotations,
    focusedAnnotation,
    onEditAnnotation,
    onDeleteAnnotation,
    onFocusAnnotation,
  }: Props = $props();

  // Line-anchored annotations render inline in the source view's per-line
  // annotation rows; legacy (selection-anchored) annotations have no line and
  // list read-only below the view. Both narrow from the same on-disk union.
  const lineAnnotations = $derived(annotations.filter(isLineAnnotation));
  const legacyAnnotations = $derived(annotations.filter(isLegacyAnnotation));

  // The comments on each anchor line, grouped into one thread per line. The
  // library reserves a single annotation row per line, so several comments on a
  // line render as one ordered thread within that row (see SourceAnnotationThread)
  // rather than as separate nodes contending for the same slot. Ordered by line;
  // each thread keeps its comments in working-copy order.
  const lineThreads = $derived(groupAnnotationsByLine(lineAnnotations, (a) => a.endLine));

  // Compare state: the component owns the reactive store (runes live here) and
  // the factory mutates it; the layout-preference read/write are injected so the
  // factory stays pure. Annotation display is never wired here. The version/style
  // fields are placeholders — the init effect below sets the real default pair
  // and persisted layout as soon as the active review is established.
  let compareStore = $state<CompareStore>({
    comparing: false,
    baseVersion: 0,
    targetVersion: 0,
    diffStyle: "split",
    diffIndicators: "bars",
  });
  const compare = createCompare(compareStore, {
    readPref: readDiffStyle,
    writePref: writeDiffStyle,
    readIndicatorsPref: readDiffIndicators,
    writeIndicatorsPref: writeDiffIndicators,
  });

  // Seed the default pair + persisted layout when the active review changes, and
  // reconcile the selected pair on every version-set change (a poll tick adding
  // a revision, or a switch to a different review).
  let lastReviewId: string | undefined;
  $effect(() => {
    if (review.id !== lastReviewId) {
      lastReviewId = review.id;
      compare.init(review.versions);
    } else {
      compare.syncVersions(review.versions);
    }
  });

  const canCompare = $derived(compare.canCompare(review.versions));
  const showDiff = $derived(canCompare && compareStore.comparing);

  // Reader affordances applied to both the single-version source view and the
  // compare diff: wrap long lines instead of scrolling them, and hide the
  // line-number gutter. Seeded from the persisted preference and written through
  // on toggle so the choice survives a reload. They are independent of contentKey,
  // so a change updates the view in place (the lifecycle's setOptions path) rather
  // than recreating it — scroll is preserved.
  let overflow = $state<Overflow>(readOverflow());
  let disableLineNumbers = $state(readDisableLineNumbers());
  function setOverflow(value: Overflow): void {
    overflow = value;
    writeOverflow(value);
  }
  function setDisableLineNumbers(value: boolean): void {
    disableLineNumbers = value;
    writeDisableLineNumbers(value);
  }
  const readerOptions = $derived<SourceViewOptions>({ overflow, disableLineNumbers });

  // Identity of the rendered content: the wrapper recreates its instance only
  // when this changes, so a poll tick that re-delivers the same version updates
  // in place (scroll preserved) while a new version recreates the view.
  const contentKey = $derived(`${review.id}:${review.version}`);
  // The diff view's identity keys on the selected version pair, so picking a new
  // pair recreates it while a poll tick on an unchanged pair updates in place.
  const diffContentKey = $derived(
    `${review.id}:${compareStore.baseVersion}:${compareStore.targetVersion}`,
  );

  // The opt-in link layer: simplified display text plus per-line clickable spans,
  // with line parity preserved (so the headings' and gutter's line numbers match
  // the stored plan). Memoized on the plan text so an unchanged poll tick yields
  // the SAME layer reference — SourceView change-detects its options by reference,
  // so a fresh object each tick would trigger a redundant setOptions + repaint.
  let memo: { text: string; layer: ReturnType<typeof buildLinkLayer> } | undefined;
  const linkLayer = $derived.by(() => {
    if (memo?.text !== review.currentPlan) {
      memo = { text: review.currentPlan, layer: buildLinkLayer(review.currentPlan) };
    }
    return memo.layer;
  });

  const baseText = $derived(compare.planFor(review.versions, compareStore.baseVersion));
  const targetText = $derived(compare.planFor(review.versions, compareStore.targetVersion));

  // Headings scanned from the formatted source (fence-aware). Line numbers index
  // the stored plan text, which matches the view's per-line data-line, so a jump
  // lands on the right row. Memoized on the plan text alongside the link layer.
  let headingMemo: { text: string; headings: ReturnType<typeof extractHeadings> } | undefined;
  const headings = $derived.by(() => {
    if (headingMemo?.text !== review.currentPlan) {
      headingMemo = { text: review.currentPlan, headings: extractHeadings(review.currentPlan) };
    }
    return headingMemo.headings;
  });

  // The imperative API the SourceView hands us once mounted: scroll-to-line plus
  // the host element whose annotation slots we project comments into.
  let api = $state<SourceViewApi | undefined>();
  const host = $derived(api?.host);

  // The source line of the heading currently in the reading zone. Tracked from
  // the scroll container's topmost rendered line so the pane highlights the
  // section being read.
  let activeLine = $state<number | null>(null);
  // The scroll container (the .diff-plan element), used by the ToC tracking to
  // read the topmost visible line.
  let scrollEl = $state<HTMLElement | undefined>();

  // Recompute the active heading from the view's topmost visible source line,
  // throttled with rAF so a scroll burst settles into one read. The view paints
  // each line as <div data-line="N"> in a shadow root; the first row whose
  // bottom sits below the container's top edge is the top visible line.
  function topVisibleLine(): number | null {
    const rows = scrollEl?.querySelector(".diffview")?.shadowRoot?.querySelectorAll<HTMLElement>(
      "[data-line]",
    );
    if (rows == null || rows.length === 0) return null;
    const top = scrollEl!.getBoundingClientRect().top;
    for (const row of rows) {
      if (row.getBoundingClientRect().bottom > top) {
        const n = Number(row.getAttribute("data-line"));
        return Number.isFinite(n) ? n : null;
      }
    }
    return null;
  }

  $effect(() => {
    const el = scrollEl;
    if (!el) return;
    // depend on the heading set so tracking re-arms after a version change
    void headings;
    let raf = 0;
    const update = () => {
      const top = topVisibleLine();
      if (top != null) activeLine = activeHeadingLine(headings, top);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  });

  // Reactive mirror of the controller's pending target, so the composer renders
  // when it opens or closes. The controller owns the state machine; this is the
  // view's read of it.
  let pending = $state<{ startLine: number; endLine: number } | undefined>();

  const commenting = createSourceCommenting({
    onCreate: (anchor) => onCreateLineAnnotation(anchor),
    onChange: () => {
      pending = commenting.pending();
    },
  });

  // Discard an open composer when the rendered content changes (a new version
  // arrives, or the review switches): its line anchor belongs to the prior text,
  // so submitting it onto the new version would mis-anchor. contentKey is the
  // reactive trigger.
  $effect(() => {
    void contentKey;
    commenting.cancel();
  });

  // The live drag readout: while the reviewer drags down the line-number column,
  // the library fires onLineSelectionChange on every row crossed. Mirroring the
  // normalized range here renders a lightweight "Lines X–Y" preview before
  // release, so the reviewer sees the span grow instead of learning it only when
  // the composer opens. Cleared on release/cancel, leaving no residue. The
  // readout is suppressed once the composer is open — the composer's own label
  // takes over — so the two never show at once.
  let dragRange = $state<{ startLine: number; endLine: number } | undefined>();

  // The one-time discoverability hint for the drag gesture: shown the first time
  // the reviewer hovers the gutter, dismissed (and remembered) the first time they
  // actually drag, so it never nags. Seeded from persisted state at mount.
  let hintDismissed = $state(isDragHintDismissed());
  let hintVisible = $state(false);

  function showDragHint(): void {
    if (!hintDismissed) hintVisible = true;
  }
  function retireDragHint(): void {
    hintVisible = false;
    if (!hintDismissed) {
      hintDismissed = true;
      dismissDragHint();
    }
  }

  const gutter: SourceViewGutter = {
    enableGutterUtility: true,
    enableLineSelection: true,
    onGutterUtilityClick: (range) => commenting.open({ start: range.start, end: range.end }),
    // Live during the drag: preview the growing range, and retire the hint once the
    // reviewer has used the gesture. The range arrives in either order; normalize it
    // so the preview reads ascending, exactly as the composer label will.
    onLineSelectionStart: (range) => {
      retireDragHint();
      dragRange = range == null ? undefined : normalizeRange(range);
    },
    onLineSelectionChange: (range) => {
      dragRange = range == null ? undefined : normalizeRange(range);
    },
    onLineSelectionEnd: () => {
      dragRange = undefined;
    },
    // caret fills the library's annotation slots itself (see annotationSlot.ts), so
    // the library's own renderAnnotation callback — disabled in container-managed
    // mode anyway — goes unused; the option is required by the bag's shape.
    renderAnnotation: () => undefined,
  };

  // The live preview text, suppressed once the composer opens (its label takes
  // over) so the readout and composer never disagree or stack.
  const dragReadout = $derived(
    dragRange && pending == null ? rangeLabel(dragRange.startLine, dragRange.endLine) : undefined,
  );

  // One library line annotation per anchored line — the saved comments plus the
  // open composer — so the library reserves an inline annotation row whose slot we
  // fill with the card/composer DOM (see annotationSlot.ts). Comments anchor to
  // their last line, so a multi-line comment sits below its whole range. Memoized
  // by the line set so an unchanged poll tick keeps the same array reference and
  // the wrapper skips a redundant library re-render.
  let annoKey: string | undefined;
  let annoValue: ReturnType<typeof toLineAnnotations> = [];
  const sourceAnnotations = $derived.by(() => {
    const lines = [...lineAnnotations.map((a) => a.endLine), ...(pending ? [pending.endLine] : [])];
    const key = [...new Set(lines)].sort((a, b) => a - b).join(",");
    if (annoKey !== key) {
      annoKey = key;
      annoValue = toLineAnnotations(lines);
    }
    return annoValue;
  });

  // The covered-line range of every saved comment plus the open composer, drawn
  // as a host-side bracket rail in the gutter (bracketLayer) so a multi-line
  // comment shows which lines belong to it — the card anchors to endLine only.
  // Both saved and pending spans appear; a version switch swaps `host` (the
  // SourceView recreates on contentKey), and the action re-observes the new host
  // and re-measures so no stale rail survives.
  const bracketSpans = $derived<BracketSpan[]>([
    ...lineAnnotations.map((a) => ({ startLine: a.startLine, endLine: a.endLine })),
    ...(pending ? [{ startLine: pending.startLine, endLine: pending.endLine }] : []),
  ]);
</script>

<!-- Control row above the surface. Reader affordances (wrap, line numbers) apply
     to both the single-version view and the compare diff, so they show in either
     mode; the version-compare picker appears only when there are versions to
     compare. -->
<div class="control-row">
  <ReaderAffordances
    {overflow}
    {disableLineNumbers}
    onSetOverflow={setOverflow}
    onSetDisableLineNumbers={setDisableLineNumbers}
  />
  {#if canCompare}
    <VersionComparePicker
      versions={review.versions}
      comparing={compareStore.comparing}
      baseVersion={compareStore.baseVersion}
      targetVersion={compareStore.targetVersion}
      diffStyle={compareStore.diffStyle}
      diffIndicators={compareStore.diffIndicators}
      onSetComparing={compare.setComparing}
      onSelectBase={compare.setBase}
      onSelectTarget={compare.setTarget}
      onSetDiffStyle={compare.setDiffStyle}
      onSetDiffIndicators={compare.setDiffIndicators}
    />
  {/if}
</div>

<div class="diff-surface">
  <!-- The contents pane and gutter composer are the single-version surface only.
       Compare mode is a clean diff with no ToC, no gutter, no annotations. -->
  {#if !showDiff}
    <SourceToc {headings} {activeLine} onJump={(line) => api?.scrollToLine(line)} />
  {/if}
  <div class="diff-plan" bind:this={scrollEl} onmouseenter={showDragHint} role="presentation">
    {#if showDiff}
      <!-- Compare mode: a diff between the selected version pair. Base is the
           reference version (the default base is the current version) and renders
           on the diff's "after" side; target is what it's compared against and
           renders on the "before" side — so the default current-vs-previous pair
           reads as the changes that produced the current version. Annotations and
           the gutter are deliberately omitted. The layout switches at runtime via
           the picker (no remount).

           The side names are the version numbers, so the sticky compare header
           reads the pair as `v{target} → v{base}` (the rename arrow is the
           library's, free when the two names differ) — naming what is being
           compared instead of a placeholder filename. -->
      <SourceDiffView
        oldDoc={{ name: `v${compareStore.targetVersion}`, text: targetText }}
        newDoc={{ name: `v${compareStore.baseVersion}`, text: baseText }}
        contentKey={diffContentKey}
        options={{
          ...readerOptions,
          diffStyle: compareStore.diffStyle,
          diffIndicators: compareStore.diffIndicators,
        }}
      />
    {:else}
      <!-- Live drag readout: a zero-height sticky rail rendered first so it pins to
           the top of the scroll viewport from scroll position 0 without reflowing
           the line grid (the absolutely-positioned readout inside it takes no flow
           space). It stays visible as the selection — and any auto-scroll — move
           during the drag. Reads the same ascending range the composer label will,
           and is gone the instant the drag releases or the composer opens. aria-live
           so a reader hears the range grow. -->
      <div class="drag-readout-rail" aria-hidden={dragReadout == null}>
        {#if dragReadout}
          <div class="drag-readout metric" role="status" aria-live="polite">{dragReadout}</div>
        {/if}
      </div>
      <SourceView
        doc={{ name: "plan.md", text: linkLayer.text }}
        links={linkLayer.spans}
        annotations={sourceAnnotations}
        options={readerOptions}
        {gutter}
        {contentKey}
        onReady={(a) => (api = a)}
        onLineComment={(line) => commenting.open({ start: line, end: line })}
      />
      <!-- The comment-span bracket overlay: rounded gutter rails marking each
           comment's covered lines. It layers over the .diff-plan scroll content
           (a child of it, positioned by the action against the host's shadow
           [data-line] rows) so the rails scroll with the rows; it is decorative
           (pointer-events: none). -->
      <div use:bracketLayer={{ host, spans: bracketSpans }}></div>
      <!-- Saved comments and the open composer are projected into the library's
           per-line annotation rows (slotInto), so they render inline between the
           code lines at their anchor line rather than floating over them. One node
           per line carries that line's slot; multiple comments on a line stack
           inside it as a single ordered thread. -->
      {#each lineThreads as thread (thread.line)}
        <div use:slotInto={{ host, line: thread.line }}>
          <SourceAnnotationThread
            annotations={thread.annotations}
            {focusedAnnotation}
            onFocus={onFocusAnnotation}
            onEdit={onEditAnnotation}
            onDelete={onDeleteAnnotation}
          />
        </div>
      {/each}
      {#if pending}
        <div use:slotInto={{ host, line: pending.endLine }}>
          <SourceComposer
            startLine={pending.startLine}
            endLine={pending.endLine}
            onSubmit={(comment) => commenting.submit(comment)}
            onCancel={() => commenting.cancel()}
          />
        </div>
      {/if}
      <!-- One-time hint: rendered last so it sticks to the bottom of the scroll
           viewport, reading as ambient guidance. Surfaces the drag-to-comment
           gesture on first gutter hover, retired for good once the reviewer drags. -->
      {#if hintVisible}
        <div class="drag-hint" role="note">Drag the line numbers to comment on a range.</div>
      {/if}
    {/if}
  </div>
</div>

{#if legacyAnnotations.length > 0}
  <LegacyAnnotationList annotations={legacyAnnotations} />
{/if}

<style>
  /* The control bar above the surface. Carries the bar chrome (raised paper,
     hairline rule) so its children — the reader affordances and the compare
     picker — read as one toolbar: reader options on the left, the version picker
     on the right when present. */
  .control-row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.5rem clamp(1rem, 3vw, 2rem);
    border-bottom: 1px solid var(--rule);
    background: var(--paper-raised);
  }
  /* The compare picker is the trailing group; it pushes to the right edge so the
     reader affordances hold the left. */
  .control-row :global(.compare-picker) {
    margin-left: auto;
  }

  /* The contents pane and source view share one row; the pane is a fixed-width
     left lane, the source view takes the rest and scrolls on its own. */
  .diff-surface {
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  /* Fills the content row and scrolls on its own; the SourceView renders its
     line grid (and the inline annotation rows) inside. `position: relative` makes
     it the containing block for the comment-span bracket overlay, whose rails are
     positioned against the scroll content (see lib/diffview/bracket.ts). */
  .diff-plan {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background: var(--paper);
  }

  /* The zero-height sticky rail that carries the live readout. Sticky to the top
     of the scroll viewport, but with no height so it never reflows the line grid
     (the readout positions absolutely within it). */
  .drag-readout-rail {
    position: sticky;
    top: 0;
    left: 0;
    z-index: 3;
    height: 0;
  }

  /* The live drag readout. Pinned to the top-left of the scroll viewport via the
     rail, offset so it sits over the gutter→content seam near the line numbers it
     counts. Amber-accented to tie it to the selection band the reviewer is
     dragging. The `.metric` atom (global) gives it tabular digits so the range
     doesn't reflow as it grows. pointer-events:none keeps it out of the drag's
     pointer capture. */
  .drag-readout {
    position: absolute;
    top: 0.4rem;
    left: 0.4rem;
    width: fit-content;
    padding: 0.2rem 0.5rem;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--accent-ink);
    background: var(--accent);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
    pointer-events: none;
    animation: readout-in var(--dur-fast) var(--ease-out);
  }

  /* The one-time discoverability hint. Sticky at the bottom of the viewport so it
     reads as ambient guidance rather than blocking the gutter it describes. Quiet
     paper-raised chrome — it is a nudge, not the amber action affordance. */
  .drag-hint {
    position: sticky;
    bottom: 0.5rem;
    left: 0;
    z-index: 3;
    width: fit-content;
    margin: 0 auto 0.5rem;
    padding: 0.35rem 0.7rem;
    font-size: var(--text-xs);
    color: var(--ink-soft);
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    animation: readout-in var(--dur-fast) var(--ease-out);
  }

  @keyframes readout-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
