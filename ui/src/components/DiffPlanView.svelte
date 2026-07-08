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
  import { untrack } from "svelte";
  import SourceView from "../lib/diffview/SourceView.svelte";
  import SourceDiffView from "../lib/diffview/SourceDiffView.svelte";
  import {
    groupAnnotationsByLine,
    slotInto,
    toLineAnnotations,
  } from "../lib/diffview/annotationSlot.ts";
  import { type BracketSpan, bracketLayer } from "../lib/diffview/bracket.ts";
  import { type CodeBlockRange, codeBlockRanges, codeBlockText } from "../lib/diffview/codeBlocks.ts";
  import { codeBlockAtPoint, copyAnchor } from "../lib/diffview/codeCopy.ts";
  import {
    type ComposerScratch,
    createSourceCommenting,
    normalizeRange,
    rangeLabel,
  } from "../lib/diffview/commenting.ts";
  import { dismissDragHint, isDragHintDismissed } from "../lib/diffview/dragHint.ts";
  import { buildLinkLayer } from "../lib/diffview/links.ts";
  import { readDiffStyle, writeDiffStyle } from "../lib/diffStylePref.ts";
  import { readDiffIndicators, writeDiffIndicators } from "../lib/diffIndicatorsPref.ts";
  import { type CompareStore, createCompare } from "../state/compare.svelte.ts";
  import { setHeadingSlug, takeHeadingSlug } from "../state/headingLink.ts";
  import VersionComparePicker from "./VersionComparePicker.svelte";
  import type { SourceViewGutter } from "../lib/diffview/options.ts";
  import type { SourceViewApi, SourceViewOptions } from "../lib/diffview/types.ts";
  import { activeHeadingLine, extractHeadings, lineForSlug, slugForLine } from "../lib/toc.ts";
  import { lineAtReadingZone } from "../lib/diffview/scroll.ts";
  import {
    type Annotation,
    type ClientReview,
    isLegacyAnnotation,
    isLineAnnotation,
  } from "@core/types";
  import SourceComposer from "./SourceComposer.svelte";
  import SourceScratchMarker from "./SourceScratchMarker.svelte";
  import SourceAnnotationThread from "./SourceAnnotationThread.svelte";
  import LegacyAnnotationList from "./LegacyAnnotationList.svelte";
  import SourceToc from "./SourceToc.svelte";
  import CodeCopyButton from "./CodeCopyButton.svelte";
  import RenderedPlanView from "./RenderedPlanView.svelte";
  import { type RenderMode, readRenderMode, writeRenderMode } from "../lib/renderModePref.ts";

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
    /** Report the current retained scratches up to the host so a sibling (the
     * Request Changes dialog) can surface them. Receives the controller's stable
     * snapshot verbatim — the host must forward it as-is (no copy/map) to keep the
     * reference-stability that avoids redundant re-renders. */
    onScratchesChange?: (scratches: ComposerScratch[]) => void;
    /** Hand the host the controller's per-scratch Save/Discard actions, once, so
     * the dialog can graduate or drop a scratch without owning the controller. */
    onExposeScratchActions?: (actions: {
      save: (key: string) => void;
      discard: (key: string) => void;
    }) => void;
  }

  let {
    review,
    onCreateLineAnnotation,
    annotations,
    focusedAnnotation,
    onEditAnnotation,
    onDeleteAnnotation,
    onFocusAnnotation,
    onScratchesChange,
    onExposeScratchActions,
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

  // Single-version render mode: the styled "rendered markdown" view (default) or
  // the source-code grid. Persisted so a reviewer's choice survives reloads. The
  // toggle shows only outside compare mode — the compare diff is always source.
  let viewMode = $state<RenderMode>(readRenderMode());
  function setViewMode(mode: RenderMode): void {
    if (mode === viewMode) return;
    viewMode = mode;
    writeRenderMode(mode);
  }

  // Reader affordances applied to both the single-version source view and the
  // compare diff are fixed (EXC-664): long lines scroll (never wrap) and the
  // line-number gutter is always shown. These were once user toggles (EXC-606),
  // but that configurability was removed, so the former defaults are now the only
  // behavior.
  const readerOptions: SourceViewOptions = { overflow: "scroll", disableLineNumbers: false };

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

  // The fenced code blocks in the rendered plan, each with its range (for hover
  // hit-testing) and its fence-stripped code (for the clipboard). Backs the per-block
  // copy affordance (EXC-692). Computed from the SAME text the view renders
  // (linkLayer.text) so the ranges line up with the shadow rows' data-line numbers,
  // and memoized on that text so an unchanged poll tick keeps a stable reference.
  let codeBlocksMemo:
    | { text: string; blocks: Array<{ range: CodeBlockRange; text: string }> }
    | undefined;
  const codeBlocks = $derived.by(() => {
    const text = linkLayer.text;
    if (codeBlocksMemo?.text !== text) {
      codeBlocksMemo = {
        text,
        blocks: codeBlockRanges(text).map((range) => ({ range, text: codeBlockText(text, range) })),
      };
    }
    return codeBlocksMemo.blocks;
  });

  // The imperative API the SourceView hands us once mounted: scroll-to-line plus
  // the host element whose annotation slots we project comments into.
  let api = $state<SourceViewApi | undefined>();
  const host = $derived(api?.host);

  // The code block the reviewer is hovering, with its top-right anchor in .diff-plan
  // content coordinates — drives the copy button (EXC-692). Undefined when the pointer
  // is over no block. The effect below tracks it from pointer moves over the scroller.
  let hoveredCopy = $state<
    { range: CodeBlockRange; text: string; top: number; left: number } | undefined
  >();

  // Track the hovered code block from pointer moves over the scroll container (the
  // rows live in the SourceView's shadow root; codeCopy.ts does the hit-test + the
  // content-coordinate anchor). rAF-throttled, and the anchor is recomputed only when
  // the hovered block changes (it is the block's own top-right, independent of where
  // in the block the pointer sits), so hovering does not thrash layout. The button is
  // a light-DOM child of .diff-plan, so it scrolls with the rows for free.
  $effect(() => {
    const scroller = scrollEl;
    const el = host;
    const blocks = codeBlocks;
    // The copy button hit-tests the source view's shadow rows, so it is a
    // source-mode affordance; the rendered view has no per-block copy button.
    if (viewMode !== "source" || scroller == null || el == null || blocks.length === 0) {
      hoveredCopy = undefined;
      return;
    }
    const ranges = blocks.map((b) => b.range);
    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    const update = () => {
      raf = 0;
      const range = codeBlockAtPoint(el, ranges, lastX, lastY);
      if (range == null) {
        hoveredCopy = undefined;
        return;
      }
      if (hoveredCopy?.range.start === range.start) return; // same block — keep the anchor
      const anchor = copyAnchor(el, scroller, range);
      const block = blocks.find((b) => b.range.start === range.start);
      hoveredCopy =
        anchor == null || block == null
          ? undefined
          : { range, text: block.text, top: anchor.top, left: anchor.left };
    };
    const onMove = (event: PointerEvent) => {
      lastX = event.clientX;
      lastY = event.clientY;
      if (raf === 0) raf = requestAnimationFrame(update);
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      hoveredCopy = undefined;
    };
    scroller.addEventListener("pointermove", onMove);
    scroller.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("pointermove", onMove);
      scroller.removeEventListener("pointerleave", onLeave);
    };
  });

  // Gates the live `?heading=` mirror until the deep-link restore has consumed any
  // incoming `?heading=`. Without it, the mirror effect (activeLine starts null)
  // could clear the param before onSourceReady reads it, depending on which
  // post-mount effect runs first.
  let restored = $state(false);

  // Captures the imperative API and, on the first ready, restores a deep-linked
  // heading (`?heading=<slug>`) by resolving the slug to its source line and
  // scrolling to it once. takeHeadingSlug() clears the param, so a later SourceView
  // remount (a version switch) won't re-jump — the live `?heading=` mirror takes
  // over from there. An unknown or stale slug resolves to null and is a no-op.
  function onSourceReady(a: SourceViewApi) {
    api = a;
    const slug = takeHeadingSlug();
    const line = slug != null ? lineForSlug(headings, slug) : null;
    if (line != null) {
      // The library paints its data-line rows asynchronously after the container is
      // ready, so the target row may not exist on the first frame. Retry across a
      // bounded number of frames until scrollToLine finds the row (it returns true),
      // so a deep link lands even on a long, highlight-heavy plan.
      let tries = 0;
      const restoreScroll = () => {
        if (a.scrollToLine(line) || ++tries >= 30) return;
        requestAnimationFrame(restoreScroll);
      };
      requestAnimationFrame(restoreScroll);
    }
    restored = true;
  }

  // The source line of the heading currently in the reading zone. Tracked from
  // the scroll container's topmost rendered line so the pane highlights the
  // section being read.
  let activeLine = $state<number | null>(null);
  // The scroll container (the .diff-plan element), used by the ToC tracking to
  // read the topmost visible line.
  let scrollEl = $state<HTMLElement | undefined>();

  // Recompute the active heading from the source line at the top of the reading
  // zone, throttled with rAF so a scroll burst settles into one read. The view
  // paints each line as <div data-line="N"> in a shadow root; lineAtReadingZone
  // picks the line sitting at the same offset jumps park headings at, so the
  // tracked section matches where a ToC click lands rather than the row above it.
  function topVisibleLine(): number | null {
    // Source mode paints rows into the .diffview shadow root; rendered mode paints
    // them as light-DOM children of .rendered-plan. Read whichever surface is live.
    const rows =
      scrollEl?.querySelector(".diffview")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-line]") ??
      scrollEl?.querySelector(".rendered-plan")?.querySelectorAll<HTMLElement>("[data-line]");
    if (rows == null || rows.length === 0) return null;
    // Capture the narrowed value: the generator closure below doesn't inherit TS's
    // non-null narrowing of `rows`.
    const measured = rows;
    const top = scrollEl!.getBoundingClientRect().top;
    // Measure rows lazily: lineAtReadingZone stops at the first row in the zone, so
    // only those rows pay for a getBoundingClientRect read rather than every line.
    function* geom() {
      for (const row of measured) {
        const line = Number(row.getAttribute("data-line"));
        if (Number.isFinite(line)) yield { line, bottom: row.getBoundingClientRect().bottom };
      }
    }
    return lineAtReadingZone(geom(), top);
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

  // Mirror the active heading's slug into `?heading=` so a copied URL reopens the
  // review at the section being read (composing with deepLink.ts's `?review=`).
  // Compare mode has no ToC and no tracked heading, so the param clears there.
  // Held until restore consumes any incoming `?heading=` (see `restored`).
  $effect(() => {
    if (!restored) return;
    const slug = activeLine != null ? slugForLine(headings, activeLine) : null;
    setHeadingSlug(showDiff ? null : slug);
  });

  // Reactive mirror of the controller's pending target, so the composer renders
  // when it opens or closes. The controller owns the state machine; this is the
  // view's read of it.
  let pending = $state<{ startLine: number; endLine: number } | undefined>();
  // The text to seed the open composer with, restoring a resumed scratch draft.
  let pendingText = $state("");
  // The retained, unsubmitted composer drafts ("scratches"), one Resume marker
  // per range. Mirrored from the controller so a dismissed-with-text composer
  // leaves a returnable marker instead of vanishing.
  let scratches = $state<ComposerScratch[]>([]);

  const commenting = createSourceCommenting({
    onCreate: (anchor) => onCreateLineAnnotation(anchor),
    onChange: () => {
      pending = commenting.pending();
      pendingText = commenting.pendingText();
      scratches = commenting.scratches();
    },
  });

  // Mirror the scratches up to the host (the Request Changes dialog reads them).
  // Done in an $effect on the local `scratches` state — not synchronously inside
  // onChange — so the cross-component write is scheduled, never re-entrant with
  // the controller callback that produced it (e.g. the clear() on a version
  // change, whose onChange would otherwise write host state mid-flush). The value
  // is the controller's stable snapshot, forwarded verbatim, so the host's
  // projection keeps the same reference between mutations.
  $effect(() => {
    onScratchesChange?.(scratches);
  });

  // Hand the host the controller's per-scratch Save/Discard actions once, on
  // mount. The controller returns one object whose methods are stable for its
  // lifetime, so a single hand-off captures live references. `untrack` keeps the
  // `onExposeScratchActions` prop from becoming a reactive dependency — the host
  // re-creating that callback on every render must not re-run this.
  $effect(() => {
    untrack(() => onExposeScratchActions)?.({ save: commenting.save, discard: commenting.discard });
  });

  // The open composer's live text, reported by SourceComposer.onInput. Held here
  // so opening a different range (gutter +, a line click, a Resume marker) first
  // retains the in-progress text as a scratch instead of dropping it on the floor.
  let liveText = "";
  function openRange(start: number, end: number): void {
    commenting.cancel(liveText); // retain any in-progress text; no-op when closed
    commenting.open({ start, end });
  }
  function resumeScratch(key: string): void {
    commenting.cancel(liveText); // retain the open composer's text before switching
    commenting.resume(key);
  }

  // Clear the open composer and every scratch when the rendered content changes
  // (a new version arrives, or the review switches): a scratch's line anchor
  // belongs to the prior text, so resuming it onto the new version would
  // mis-anchor. contentKey is the reactive trigger. (Scratches are in-memory, so
  // a reload starts empty without any teardown here.)
  $effect(() => {
    void contentKey;
    commenting.clear();
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
    lineHoverHighlight: "both",
    enableLineSelection: true,
    onGutterUtilityClick: (range) => openRange(range.start, range.end),
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

  // One library line annotation per anchored line — the saved comments, the open
  // composer, and every retained scratch draft — so the library reserves an
  // inline annotation row whose slot we fill with the card/composer/marker DOM
  // (see annotationSlot.ts). Comments anchor to their last line, so a multi-line
  // comment sits below its whole range; a scratch reserves its own row even on a
  // line with no saved comment. Memoized by the line set so an unchanged poll
  // tick keeps the same array reference and the wrapper skips a redundant library
  // re-render.
  let annoKey: string | undefined;
  let annoValue: ReturnType<typeof toLineAnnotations> = [];
  const sourceAnnotations = $derived.by(() => {
    const lines = [
      ...lineAnnotations.map((a) => a.endLine),
      ...(pending ? [pending.endLine] : []),
      ...scratches.map((s) => s.endLine),
    ];
    const key = [...new Set(lines)].sort((a, b) => a - b).join(",");
    if (annoKey !== key) {
      annoKey = key;
      annoValue = toLineAnnotations(lines);
    }
    return annoValue;
  });

  // The covered-line range of every saved comment and each retained scratch,
  // drawn as a host-side bracket rail in the gutter (bracketLayer) so a multi-line
  // span shows which lines belong to it — the card/marker anchors to endLine only.
  // The OPEN composer (`pending`) is deliberately omitted (EXC-664): while it's
  // open the full-bleed selection band already marks its range, so a bracket there
  // would just double the cue. A version switch swaps `host` (the SourceView
  // recreates on contentKey), and the action re-observes the new host and
  // re-measures so no stale rail survives.
  const bracketSpans = $derived<BracketSpan[]>([
    ...lineAnnotations.map((a) => ({ startLine: a.startLine, endLine: a.endLine })),
    ...scratches.map((s) => ({ startLine: s.startLine, endLine: s.endLine })),
  ]);
</script>

<!-- Per-line comment content for the rendered view: the saved-comment thread, the
     open composer, and any scratch markers anchored at `line`. RenderedPlanView
     renders this inline right after the matching row — the light-DOM counterpart to
     the source view's slotInto projection. Authored here so it shares DiffPlanView's
     commenting state and scoped styles. -->
{#snippet renderedBelow(line: number)}
  {@const thread = lineThreads.find((t) => t.line === line)}
  {@const lineScratches = scratches.filter((s) => s.endLine === line && pending?.endLine !== line)}
  {#if thread || pending?.endLine === line || lineScratches.length > 0}
    <div class="rendered-below">
      {#if thread}
        <SourceAnnotationThread
          annotations={thread.annotations}
          {focusedAnnotation}
          onFocus={onFocusAnnotation}
          onEdit={onEditAnnotation}
          onDelete={onDeleteAnnotation}
        />
      {/if}
      {#if pending?.endLine === line}
        <SourceComposer
          startLine={pending.startLine}
          endLine={pending.endLine}
          initial={pendingText}
          onInput={(text) => (liveText = text)}
          onSubmit={(comment) => commenting.submit(comment)}
          onCancel={(text) => commenting.cancel(text)}
        />
      {/if}
      {#each lineScratches as scratch (scratch.key)}
        <SourceScratchMarker text={scratch.text} onResume={() => resumeScratch(scratch.key)} />
      {/each}
    </div>
  {/if}
{/snippet}

<!-- Control row above the surface: the version-compare picker. The picker is
     always shown; its toggle disables itself when there are no other versions to
     compare (EXC-664). -->
<div class="control-row">
  {#if !showDiff}
    <!-- Single-version view-mode toggle: the styled "rendered markdown" view vs. the
         source grid. Hidden in compare mode (the compare diff is always source). -->
    <div class="view-toggle" role="group" aria-label="Plan view">
      <button
        type="button"
        class="view-toggle-btn"
        class:active={viewMode === "rendered"}
        aria-pressed={viewMode === "rendered"}
        onclick={() => setViewMode("rendered")}
      >Rendered</button>
      <button
        type="button"
        class="view-toggle-btn"
        class:active={viewMode === "source"}
        aria-pressed={viewMode === "source"}
        onclick={() => setViewMode("source")}
      >Source</button>
    </div>
  {/if}
  <VersionComparePicker
    versions={review.versions}
    comparing={compareStore.comparing}
    {canCompare}
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
      {#if viewMode === "rendered"}
        <!-- Rendered markdown: styled decorated source, no gutter. Per-line comment
             content renders inline after each row via the renderedBelow snippet. -->
        <RenderedPlanView
          doc={{ name: "plan.md", text: review.currentPlan }}
          {contentKey}
          onReady={onSourceReady}
          onLineComment={(line) => openRange(line, line)}
          onLineRangeComment={(start, end) => openRange(start, end)}
          onLineRangePreview={(range) => {
            if (range != null) retireDragHint();
            dragRange = range ?? undefined;
          }}
          selectedRange={pending ?? null}
          belowRow={renderedBelow}
        />
      {:else}
      <SourceView
        doc={{ name: "plan.md", text: linkLayer.text }}
        links={linkLayer.spans}
        annotations={sourceAnnotations}
        options={readerOptions}
        {gutter}
        {contentKey}
        onReady={onSourceReady}
        onLineComment={(line) => openRange(line, line)}
        onLineRangeComment={(start, end) => openRange(start, end)}
        onLineRangePreview={(range) => {
          // Starting a body drag retires the discoverability hint — it is the gesture
          // the hint advertises (the gutter drag retires it via onLineSelectionStart).
          if (range != null) retireDragHint();
          dragRange = range ?? undefined;
        }}
        selectedRange={pending ?? null}
      />
      <!-- The comment-span bracket overlay: rounded gutter rails marking each
           comment's covered lines. It layers over the .diff-plan scroll content
           (a child of it, positioned by the action against the host's shadow
           [data-line] rows) so the rails scroll with the rows; it is decorative
           (pointer-events: none). -->
      <div use:bracketLayer={{ host, spans: bracketSpans }}></div>
      <!-- The per-code-block copy button (EXC-692): shown at the top-right of the
           fenced block the reviewer is hovering (tracked above). Keyed on the block
           so moving to another block resets its copied/checkmark state. It layers over
           the .diff-plan scroll content, so like the bracket rails it scrolls with the
           rows. -->
      {#if hoveredCopy}
        {#key hoveredCopy.range.start}
          <CodeCopyButton text={hoveredCopy.text} top={hoveredCopy.top} left={hoveredCopy.left} />
        {/key}
      {/if}
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
            initial={pendingText}
            onInput={(text) => (liveText = text)}
            onSubmit={(comment) => commenting.submit(comment)}
            onCancel={(text) => commenting.cancel(text)}
          />
        </div>
      {/if}
      <!-- Retained scratch drafts: an unsubmitted composer dismissed with typed
           text leaves a quiet "Resume" marker at its line, clicking which reopens
           the composer with the text restored. The open composer supersedes the
           marker for its own range (the reviewer is editing it now), so skip a
           scratch sharing the pending line. -->
      <!-- Markers anchor to endLine (matching the composer/card), so two scratches
           that end on the same line share one library row and stack within it —
           an uncommon overlap, harmless: each stays clickable and resumable. -->
      {#each scratches as scratch (scratch.key)}
        {#if pending?.endLine !== scratch.endLine}
          <div use:slotInto={{ host, line: scratch.endLine }}>
            <SourceScratchMarker text={scratch.text} onResume={() => resumeScratch(scratch.key)} />
          </div>
        {/if}
      {/each}
      {/if}
      <!-- One-time hint: rendered last so it sticks to the bottom of the scroll
           viewport, reading as ambient guidance. Surfaces the drag-to-comment
           gesture on first gutter hover, retired for good once the reviewer drags. -->
      {#if hintVisible}
        <div class="drag-hint" role="note">Drag across lines to comment on a range — hold Shift to select text.</div>
      {/if}
    {/if}
  </div>
</div>

{#if legacyAnnotations.length > 0}
  <LegacyAnnotationList annotations={legacyAnnotations} />
{/if}

<style>
  /* The control bar above the surface. Carries the bar chrome (raised paper,
     hairline rule) for the version-compare picker: the "Compare versions" toggle
     sits at the left, and (in compare mode) the layout / indicator toggles are
     pushed to the right edge. */
  .control-row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.5rem clamp(1rem, 3vw, 2rem);
    border-bottom: 1px solid var(--rule);
    background: var(--paper-raised);
  }
  /* The compare picker now owns the bar: it spans the row so the "Compare
     versions" toggle sits at the left, and its display toggles (margin-left: auto,
     in compare mode) reach the right edge. */
  .control-row :global(.compare-picker) {
    flex: 1;
  }

  /* Single-version view-mode toggle: a compact segmented control. The track is a
     sunk lane; the active segment lifts to raised paper with accent text, so the
     current mode reads at a glance without shouting. */
  .view-toggle {
    display: inline-flex;
    flex: none;
    gap: 2px;
    padding: 2px;
    background: var(--paper-sunk);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
  }
  .view-toggle-btn {
    appearance: none;
    border: none;
    background: none;
    cursor: pointer;
    padding: 0.2rem 0.6rem;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink-soft);
    border-radius: calc(var(--radius) - 2px);
    transition:
      color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }
  .view-toggle-btn:hover {
    color: var(--ink);
  }
  .view-toggle-btn.active {
    color: var(--accent);
    background: var(--paper-raised);
    box-shadow: var(--shadow-card);
  }

  /* Inline comment content projected under a rendered row (the renderedBelow
     snippet). Reset the rendered view's large reading font/leading so the composer
     and comment cards render at their own scale, with breathing room above/below. */
  .rendered-below {
    font-size: var(--text-base);
    line-height: normal;
    white-space: normal;
    padding: 0.35rem 0 0.6rem;
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
