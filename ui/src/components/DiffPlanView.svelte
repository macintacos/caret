<script lang="ts">
  // Source-view plan surface: renders the active plan version's stored text as
  // line-numbered markdown source through the diffview SourceView wrapper, with the
  // outline beside it, the breadcrumbs in its header, and a line gutter for creating
  // comments. Clicking the gutter `+` opens an inline composer at the selected line
  // or range, and submitting creates a line-anchored {startLine, endLine} annotation
  // in the autosave working copy. Saved comments and the open composer render inline
  // in the library's per-line annotation rows (see annotationSlot.ts): the wrapper is
  // fed one line annotation per anchored line so the library reserves the row, and
  // the card/composer DOM is projected into that row's slot, so a comment sits
  // between the code lines instead of floating over them. The wrapper owns the
  // @pierre/diffs lifecycle and preserves the view instance across re-renders when
  // the contentKey is unchanged, so scroll survives the 2s poll re-delivering the
  // same version.
  //
  // A toggle in the plan header swaps the source view for a plan preview of the same text
  // rendered as HTML (PlanPreview), remembered per browser. The source view's own
  // behaviors — gutter, cursor, search, heading tracking, reference and code chrome —
  // run only on the surfaces planView.ts's SURFACE_BEHAVIORS lists for them.
  //
  // When the review has multiple stored versions, a compare control lets the
  // reviewer diff any two of them (base vs. target) through the SourceDiffView
  // wrapper, switching the split/unified layout at runtime. The gutter and
  // inline annotation cards belong to the source view only, and the heading
  // surfaces to the source view and the preview — compare mode is a clean diff
  // surface with none of them; the compared versions' comments surface in the
  // docked panel instead, revealing their line on the side
  // they belong to for the two rendered versions and listing non-interactively for
  // anything in between.
  import { flushSync, tick, untrack } from "svelte";
  import SourceView from "$lib/diffview/SourceView.svelte";
  import SourceDiffView from "$lib/diffview/SourceDiffView.svelte";
  import {
    groupAnnotationsByLine,
    slotInto,
    toLineAnnotations,
  } from "$lib/diffview/annotationSlot.ts";
  import { type BracketSpan, bracketLayer } from "$lib/diffview/bracket.ts";
  import { type CodeBlockRange, codeBlockRanges, codeBlockText } from "$lib/diffview/codeBlocks.ts";
  import {
    type ChromeBox,
    type ChromeGeometry,
    codeBlockAtPoint,
    codeChromeAnchors,
    previewCodeBlockAtPoint,
    previewCodeChromeAnchors,
  } from "$lib/diffview/codeChrome.ts";
  import {
    type ComposerScratch,
    normalizeRange,
    rangeLabel,
    type SourceCommenting,
  } from "$lib/diffview/commenting.ts";
  import { dismissDragHint, isDragHintDismissed } from "$lib/diffview/dragHint.ts";
  import {
    buildFileRefLayer,
    type FileRefSpan,
    type FileRefSpanMap,
    mergeFileRefSpans,
  } from "$lib/diffview/fileRefs.ts";
  import {
    dismissRefHint,
    isRefHintDismissed,
    type RefHintAnchor,
    refHintToken,
    syncRefHints,
  } from "$lib/diffview/refHint.ts";
  import { getFileExcerpt, resolveFileRefs } from "$lib/api.ts";
  import { highlightChunk } from "$lib/diffview/highlight.ts";
  import { languageForPath } from "@core/plan/excerpt-language";
  import type { ReviewContext } from "$lib/editorCompletion.ts";
  import { commentIndex } from "$lib/feedback.ts";
  import { createFolderMemory } from "$lib/folderTree.ts";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { buildLinkLayer } from "$lib/diffview/links.ts";
  import { readDiffStyle, writeDiffStyle } from "$lib/diffStylePref.ts";
  import { readPreviewFontSize } from "$lib/previewFontSizePref.ts";
  import { readDiffIndicators, writeDiffIndicators } from "$lib/diffIndicatorsPref.ts";
  import { appearance } from "@/state/appearance.svelte.ts";
  import { type CompareStore, createCompare } from "@/state/compare.svelte.ts";
  import { createPlanKeyboard, type PlanKeyboardStore } from "@/state/planKeyboard.svelte.ts";
  import { setHeadingSlug, takeHeadingSlug } from "@/state/headingLink.ts";
  import VersionComparePicker from "@/components/VersionComparePicker.svelte";
  import PlanSearch from "@/components/PlanSearch.svelte";
  import type { SourceViewGutter } from "$lib/diffview/options.ts";
  import type {
    DiffSide,
    SourceDiffViewApi,
    SourceViewApi,
    SourceViewOptions,
  } from "$lib/diffview/types.ts";
  import type { ThemeId } from "$lib/theme.ts";
  import {
    ariaKeyshortcutsFor,
    bind,
    CANONICAL_KEYMAP,
    chordMatches,
    defaultIsEditingContext,
    shortcuts,
  } from "$lib/shortcuts/index.ts";
  import { sound } from "$lib/sound.ts";
  import { type CursorMotion, lineCountOf } from "$lib/diffview/lineCursor.ts";
  import { findMatches } from "$lib/diffview/planSearch.ts";
  import {
    clearPreviewSearch,
    createPreviewSearch,
    openMatchDetails,
    paintPreviewSearch,
    previewMatchRanges,
  } from "$lib/previewSearch.ts";
  import { activeHeadingLine, extractHeadings, lineForSlug, slugForLine } from "$lib/toc.ts";
  import { NARROW_WIDTH_PX } from "$lib/layout.ts";
  import { slideLayout, type SlidePart } from "$lib/layoutSlide.ts";
  import { createPaneMove } from "$lib/paneMove.ts";
  import {
    clampDrawerSize,
    DEFAULT_DRAWER_SHARE,
    type DrawerEdge,
    readDrawerSize,
    writeDrawerSize,
  } from "$lib/fileDrawer.ts";
  import { outlineBounds, outlineWidth, outlineWidthPref } from "$lib/outlineColumn.ts";
  import { sectionLines } from "$lib/tocSections.ts";
  import type { PeekTarget } from "$lib/outlinePeek.ts";
  import { previewSnippet, sourceSnippet } from "$lib/peekSnippet.ts";
  import {
    followBox,
    lineAtReadingZone,
    REVEAL_MARGIN_BOTTOM,
    revealScrollDelta,
    rowForLine,
    SCROLL_ANIM_MS,
    scrollRowIntoView,
  } from "$lib/diffview/scroll.ts";
  import { createPreviewCursor, type PreviewCursorStore } from "@/state/previewCursor.ts";
  import {
    type BandBox,
    cursorBand,
    lastVisualLine,
    linesBand,
    pointForLine,
    readingPoint,
    rowAt,
    spanBands,
    stepVisualLine,
    type TextPoint,
    visualLineBox,
    visualLineRange,
    withinLines,
  } from "$lib/previewLines.ts";
  import { createPlanSourceMap, type PlanSourceMap } from "$lib/planSourceMap.ts";
  import {
    blockIndexForLine,
    holdPlace,
    holdThroughRewrap,
    previewTopLine,
  } from "$lib/planPlace.ts";
  import {
    clearCommentHighlight,
    createSlotGaps,
    groupBySlot,
    paintCommentHighlight,
    sameSlotBoxes,
    type SlotBox,
    type SlotGap,
    slotGap,
    spanRanges,
  } from "$lib/previewComments.ts";
  import { previewFileRefs } from "$lib/previewRefs.ts";
  import {
    type Annotation,
    type ClientReview,
    type FileRefKind,
    isLegacyAnnotation,
    isLineAnnotation,
    type LineAnnotation,
  } from "@core/lib/types";
  import SourceComposer from "@/components/SourceComposer.svelte";
  import SourceScratchMarker from "@/components/SourceScratchMarker.svelte";
  import SourceAnnotationThread from "@/components/SourceAnnotationThread.svelte";
  import LegacyAnnotationList from "@/components/LegacyAnnotationList.svelte";
  import PlanBreadcrumbs from "@/components/PlanBreadcrumbs.svelte";
  import PlanToc from "@/components/PlanToc.svelte";
  import Splitter from "@/components/Splitter.svelte";
  import OutlinePeek from "@/components/OutlinePeek.svelte";
  import Icon from "@/components/Icon.svelte";
  import KbdCap from "@/components/KbdCap.svelte";
  import CodeBlockChrome from "@/components/CodeBlockChrome.svelte";
  import RefHintBadge from "@/components/RefHintBadge.svelte";
  import FileDrawer from "@/components/FileDrawer.svelte";
  import FilePreview from "@/components/FilePreview.svelte";
  import FolderTree from "@/components/FolderTree.svelte";
  import PlanPreview from "@/components/PlanPreview.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { memoLast } from "$lib/memoLast.ts";
  import { renderPlanMarkdown, type SourceSpan } from "$lib/planMarkdown.ts";
  import {
    type PlanOutline,
    type PlanSurface,
    type PlanView,
    readPlanOutline,
    readPlanView,
    runsOn,
    type SurfaceBehavior,
    writePlanOutline,
    writePlanView,
  } from "$lib/planView.ts";

  interface Props {
    /** The review whose current plan version is rendered. */
    review: ClientReview;
    /** The working-copy annotations to display over the source. */
    annotations: Annotation[];
    /** The single focused annotation id (drives expand + highlight), or null. */
    focusedAnnotation: string | null;
    onEditAnnotation: (id: string, comment: string) => void;
    onDeleteAnnotation: (id: string) => void;
    onFocusAnnotation: (id: string) => void;
    /** The unsent-scratch controller, owned by App and injected down (EXC-877). This
     * view operates it (open/submit/cancel/resume + the contentKey reseed effect) and
     * reads its reactive state through the three mirror props below; App wires the
     * controller's onChange to those mirrors and shares the same instance with the
     * Request Changes dialog, so the dialog's Save/Discard/Draft reach it directly. */
    commenting: SourceCommenting;
    /** App's mirror of `commenting.pending()` — the open composer target, or undefined
     * when closed. */
    pending?: { startLine: number; endLine: number };
    /** App's mirror of `commenting.pendingText()` — the seed text for the open composer. */
    pendingText?: string;
    /** App's mirror of `commenting.scratches()` — the retained drafts, one Resume marker
     * per range. */
    scratches?: ComposerScratch[];
    /** Hand the host a reveal(line, side) action once on mount, so a sibling (the
     * comment navigator) can scroll to a commented line. The side is read only while
     * comparing, where a line number alone names a row on either document; the source
     * view ignores it. A call before the view paints is a bounded-retry no-op; on the
     * plan preview it scrolls to the line's item in its comment slot. */
    onExposeReveal?: (reveal: (line: number, side?: DiffSide) => void) => void;
    /** Report the compared versions upward (null when not comparing), so App can
     * point the single CommentNavigator instance at the cross-version index.
     * `before`/`after` name the two documents the diff renders — not a sorted
     * range — so the panel can tell which side a comment's version is on. Compare
     * state lives here (compareStore), but the panel is a root sibling of .shell —
     * same expose-upward idiom as onExposeReveal. */
    onCompareChange?: (versions: { before: number; after: number } | null) => void;
    /** The active caret theme, forwarded to the shadow-DOM diff view so its shiki
     * highlighting is painted in the selected palette (EXC-730, EXC-752), and to
     * PlanPreview, where it colours the preview's code blocks. Omitted leaves the
     * library on caret's pair following the system preference, and the preview's code
     * blocks plain. */
    themeId?: ThemeId;
    /** Whether the shortcut-hint affordances are shown (EXC-826); gates the V-mode
     * "c comment · Esc cancel" chip. Defaults to shown; the shortcut still fires. */
    showShortcutHints?: boolean;
    /** A counter App bumps whenever a Setting is applied (EXC-843). It's the signal
     * to re-read the persisted diff-layout/marker prefs into the compare store so an
     * open diff reflows the moment those settings change (they live here, not in a
     * mirror App can resync). */
    settingsRev?: number;
    /** The review the comment editors compose against, forwarded to every composer
     * this view hosts, on either surface. App builds it, because the adapter id comes
     * from the health probe rather than the review record. */
    reviewContext?: ReviewContext;
  }

  let {
    review,
    annotations,
    focusedAnnotation,
    onEditAnnotation,
    onDeleteAnnotation,
    onFocusAnnotation,
    commenting,
    pending = undefined,
    pendingText = "",
    scratches = [],
    onExposeReveal,
    onCompareChange,
    themeId,
    showShortcutHints = true,
    settingsRev = 0,
    reviewContext,
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
  // factory stays pure. The version/style fields are placeholders — the init effect
  // below sets the real default pair and persisted layout as soon as the active
  // review is established.
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
    sound: sound.play,
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

  let previewFontSize = $state(readPreviewFontSize());

  // A Settings change to the diff prefs or the preview's font size (App bumps settingsRev)
  // re-reads them into this view's state, so an open diff reflows and the preview resizes
  // live — the immediate-apply promise reaching the prefs that live in this view rather
  // than an App mirror. Skipped on the initial mount (settingsRev starts 0;
  // compare.init already seeded these); the in-view picker mutates the store directly
  // and never bumps settingsRev, so its choice is never clobbered.
  $effect(() => {
    if (settingsRev === 0) return;
    compareStore.diffStyle = readDiffStyle();
    compareStore.diffIndicators = readDiffIndicators();
    previewFontSize = readPreviewFontSize();
  });

  const canCompare = $derived(compare.canCompare(review.versions));
  const showDiff = $derived(canCompare && compareStore.comparing);

  let planView = $state<PlanView>(readPlanView());
  // Gates the flip fade, so a first paint doesn't fade under App's plan hand-off too.
  let viewFlipped = $state(false);
  const surface = $derived<PlanSurface>(showDiff ? "compare" : planView);
  const runs = (behavior: SurfaceBehavior): boolean => runsOn(behavior, surface);

  // The plan preview renders the stored text, so its blocks' source spans count the
  // same lines the source view numbers. Memoized: the 2s poll hands a fresh `review`
  // each tick, which would otherwise re-lex and re-sanitize the whole plan.
  const renderPreview = memoLast(renderPlanMarkdown);
  const planPreview = $derived(
    surface === "preview" ? renderPreview(review.currentPlan) : null,
  );
  // The preview's root, bound from PlanPreview: the chrome geometry and capturePlace read it.
  let previewEl = $state<HTMLDivElement | undefined>();

  // The preview's comments, one slot per line they end on, in the order the source view's
  // annotation row stacks them: thread, then the open composer, then draft markers. A
  // slot's `start` is its earliest item's, so its gap opens under the row their text
  // ends on.
  type PreviewSlotItem =
    | { kind: "thread"; line: number; annotations: (typeof lineThreads)[number]["annotations"] }
    | { kind: "composer"; line: number; start: number }
    | { kind: "marker"; line: number; start: number; scratch: ComposerScratch };
  const itemStart = (item: PreviewSlotItem) =>
    item.kind === "thread" ? Math.min(...item.annotations.map((a) => a.startLine)) : item.start;
  // The open composer supersedes the draft marker on its own line on both surfaces.
  const draftMarkers = $derived(scratches.filter((s) => s.endLine !== pending?.endLine));
  const previewSlots = $derived(
    planPreview && runs("commentThreads")
      ? groupBySlot<PreviewSlotItem>([
          ...lineThreads.map((t) => ({ kind: "thread" as const, ...t })),
          ...(pending
            ? [{ kind: "composer" as const, line: pending.endLine, start: pending.startLine }]
            : []),
          ...draftMarkers.map((s) => ({
            kind: "marker" as const,
            line: s.endLine,
            start: s.startLine,
            scratch: s,
          })),
        ]).map((slot) => ({ ...slot, start: Math.min(...slot.items.map(itemStart)) }))
      : [],
  );
  // One string per set of slot spans: previewSlots re-derives on every annotation poll, and
  // re-observing and re-placing on each would bump the layout signal with nothing moved.
  const previewSlotKey = $derived(previewSlots.map((s) => `${s.start}-${s.line}`).join());
  let slotBoxes = $state(new Map<number, SlotBox>());
  // Created per root rather than per sync run, so a re-run keeps the gaps it holds open
  // instead of closing them for a frame.
  const slotGaps = $derived(previewEl ? createSlotGaps(previewEl) : undefined);
  $effect(() => {
    const gaps = slotGaps;
    return () => gaps?.release();
  });

  // The comment under the pointer, else the one holding focus in a slot, else the open
  // composer's range, else the focused annotation: the span the preview highlights.
  let pointerSpan = $state<SourceSpan | null>(null);
  let focusSpan = $state<SourceSpan | null>(null);
  const spanOf = (r: { startLine: number; endLine: number }): SourceSpan => ({
    start: r.startLine,
    end: r.endLine,
  });
  const pendingSpan = $derived(pending ? spanOf(pending) : null);
  const focusedAnnotationSpan = $derived.by(() => {
    const a = lineAnnotations.find((x) => x.id === focusedAnnotation);
    return a ? spanOf(a) : null;
  });
  const activeSpan = $derived(pointerSpan ?? focusSpan ?? pendingSpan ?? focusedAnnotationSpan);

  // A version switch or a flip leaves the boxes on the previous document's coordinates,
  // and removes slots without the pointerleave/focusout that would clear their spans.
  $effect(() => {
    void contentKey;
    void surface;
    slotBoxes = new Map();
    pointerSpan = null;
    focusSpan = null;
  });

  const sameSpan = (a: SourceSpan | null, b: SourceSpan | null) =>
    a?.start === b?.start && a?.end === b?.end;

  function slotSpan(target: EventTarget | null): SourceSpan | null {
    if (!(target instanceof Element)) return null;
    const card = target.closest<HTMLElement>("[data-annotation-card]");
    if (card) {
      const a = lineAnnotations.find((x) => x.id === card.dataset.annotationCard);
      return a ? spanOf(a) : null;
    }
    const item = target.closest<HTMLElement>("[data-span-start]");
    return item
      ? { start: Number(item.dataset.spanStart), end: Number(item.dataset.slotLine) }
      : null;
  }

  function pointSlot(target: EventTarget | null): void {
    const span = slotSpan(target);
    if (!sameSpan(span, pointerSpan)) pointerSpan = span;
  }

  function focusSlot(target: EventTarget | null): void {
    const span = slotSpan(target);
    if (!sameSpan(span, focusSpan)) focusSpan = span;
  }

  function leaveSlotFocus(e: FocusEvent & { currentTarget: HTMLElement }): void {
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)))
      focusSpan = null;
  }

  // A slot item removed under the pointer fires no pointerleave, nor in WebKit a focusout,
  // so its removal re-reads both spans: focus has left it by then, and the pointer's next
  // pointerover sets its span again.
  function releasesSpans(_item: HTMLElement): { destroy(): void } {
    return {
      destroy() {
        pointerSpan = null;
        focusSpan = slotSpan(document.activeElement);
      },
    };
  }

  // The map reads the DOM, so it is built in an effect, after the `{@html}` commits: a
  // derived can be read mid-render over the previous version. Ungated: each consumer
  // gates on its own row.
  let previewSourceMap = $state.raw<PlanSourceMap | null>(null);
  $effect(() => {
    void planPreview?.html;
    previewSourceMap = previewEl ? createPlanSourceMap(previewEl) : null;
  });
  // Bumped, rAF-throttled, whenever the preview's layout or text may have moved: everything
  // placed or painted over the preview re-runs from it. The slot sync, the one reader that
  // moves blocks, is declared first; a reader declared before it measures a frame late.
  let previewLayoutRev = $state(0);
  $effect(() => {
    const root = previewEl;
    if (root == null) return;
    let raf = 0;
    const schedule = () => {
      if (raf === 0)
        raf = requestAnimationFrame(() => {
          raf = 0;
          previewLayoutRev++;
        });
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    // Slots sit outside the root: one growing moves nothing the root shows until the slot
    // sync grows its gap.
    void previewSlotKey;
    for (const el of scrollEl?.querySelectorAll<HTMLElement>("[data-preview-slot]") ?? [])
      resize.observe(el);
    // Text rewraps without resizing the root: reference tagging and code swaps rewrite
    // nodes, and a theme paint (inline properties on <html>) restyles the markdown.
    // Attributes under the root stay unobserved: the slot gaps write their heights there,
    // and the root's resize already reports each.
    const text = new MutationObserver(schedule);
    text.observe(root, { childList: true, subtree: true, characterData: true });
    const paint = new MutationObserver(schedule);
    paint.observe(document.documentElement, { attributeFilter: ["style"] });
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      text.disconnect();
      paint.disconnect();
    };
  });
  const previewSearch = $derived(
    previewEl && previewSourceMap ? createPreviewSearch(previewEl, previewSourceMap) : null,
  );
  // The code highlight pass replaces a block's text nodes after mount and on a theme
  // switch, collapsing any range painted inside them, so the paint re-runs on each
  // previewLayoutRev bump.
  $effect(() => {
    void previewLayoutRev;
    const map = previewSourceMap;
    const span = activeSpan;
    // The open composer's rows wear the cited rows' band instead.
    const banded = draftRows !== null && sameSpan(span, pendingSpan);
    if (!runs("commentThreads") || !map || !span || banded) {
      clearCommentHighlight();
      return;
    }
    paintCommentHighlight(spanRanges(map, span));
    return clearCommentHighlight;
  });
  // Hold each preview slot's room open in the text under the row its comments end on and
  // place the slot there, on each previewLayoutRev bump. The slot set, the document and a
  // review switch trigger it directly too, so a new or reset slot is measured in the same
  // flush rather than held unmeasured for a frame. Every gap is read from the text before
  // any opens, and opened before the boxes are measured: a gap moves everything below it.
  $effect(() => {
    const geometry = previewGeometry();
    const gaps = slotGaps;
    const blocks = planPreview?.blocks;
    void previewLayoutRev;
    void previewSlotKey;
    void contentKey;
    if (geometry === null || gaps === undefined || blocks === undefined) return;
    const { root, scroller, map } = geometry;
    const heights = new Map(
      [...scroller.querySelectorAll<HTMLElement>("[data-preview-slot]")].map((el) => [
        Number(el.dataset.previewSlot),
        el.offsetHeight,
      ]),
    );
    const open = new Map<number, { at: SlotGap; height: number }>();
    for (const { start, line } of untrack(() => previewSlots)) {
      const at = slotGap(root, map, blocks, { start, end: line });
      const height = heights.get(line);
      if (at !== null && height !== undefined) open.set(line, { at, height });
    }
    gaps.set(map, open);
    const next = gaps.boxes(scroller);
    if (!sameSlotBoxes(untrack(() => slotBoxes), next)) slotBoxes = next;
  });

  // Parks in its own ResizeObserver callback, not on previewLayoutRev, so the re-park
  // paints in the rewrap's frame. Reads no api/host, so it needs no SURFACE_BEHAVIORS gate.
  $effect(() => {
    const geometry = previewGeometry();
    if (geometry === null) return;
    const { root, scroller, map } = geometry;
    return holdThroughRewrap({
      scroller,
      content: root,
      take: () => {
        const top = scroller.getBoundingClientRect().top;
        const point = readingPoint(root, map, top);
        const box = point && visualLineBox(root, map, point);
        return point && box ? { point, offset: box.top - top } : null;
      },
      lineTop: (point) => visualLineBox(root, map, point)?.top ?? null,
    });
  });

  // Report the compared versions to the host, so App can point the docked comment
  // panel at the cross-version index (EXC-872). The assignment matches what the
  // SourceDiffView below renders — oldDoc is the target, newDoc the base — rather
  // than being sorted, so the panel knows which side each version's comments jump
  // to. Re-fires whenever the pair or the mode changes.
  $effect(() => {
    onCompareChange?.(
      showDiff
        ? { before: compareStore.targetVersion, after: compareStore.baseVersion }
        : null,
    );
  });

  // Below --w-narrow, split's two side-by-side columns can't fit, so the compare
  // diff is forced to unified (EXC-811). This overrides the rendered layout only —
  // the persisted diffStyle preference is never written, so widening back above the
  // breakpoint restores the reviewer's split choice. The matchMedia guard defends a
  // DOM env lacking matchMedia (happy-dom's reports no match, so units stay on the
  // wide default either way). NARROW_WIDTH_PX is a constant rather than the --w-*
  // token because matchMedia cannot read one, and it is TopBar's own
  // narrow-consolidation breakpoint (EXC-810).
  let narrow = $state(
    typeof matchMedia === "function" &&
      matchMedia(`(max-width: ${NARROW_WIDTH_PX - 1}px)`).matches,
  );
  $effect(() => {
    if (typeof matchMedia !== "function") return;
    const mql = matchMedia(`(max-width: ${NARROW_WIDTH_PX - 1}px)`);
    narrow = mql.matches;
    const onChange = (e: MediaQueryListEvent) => {
      narrow = e.matches;
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  });
  // The layout the compare view actually renders: forced unified when narrow,
  // otherwise the reviewer's stored preference.
  const effectiveDiffStyle = $derived(narrow ? "unified" : compareStore.diffStyle);

  // Reader affordances applied to both the single-version source view and the
  // compare diff are fixed (EXC-664): long lines scroll (never wrap) and the
  // line-number gutter is always shown.
  // Reactive on `themeId` so a theme switch yields a new options reference — both
  // the reader (SourceView) and the compare view (which spreads this) re-apply it
  // through their existing `lifecycle.sync`, re-highlighting in the chosen theme.
  const readerOptions = $derived<SourceViewOptions>({
    overflow: "scroll",
    disableLineNumbers: false,
    themeId,
  });

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

  // The filename-reference layer (EXC-687). Two sources union here: the paths
  // SCANNED out of the display text (inline code, and parenthesized runs per
  // EXC-1184), and the ones the link layer
  // EMITTED over collapsed markdown-link labels (EXC-954) — which the scan can
  // never re-find, since the target is gone by the time it reads display text.
  // Memoized on the link layer OBJECT, not its text: two plans can render the
  // same display text ([a/b.md](a/b.md) and a bare a/b.md) with different emitted
  // spans, so a text-keyed memo would serve a stale map. The layer reference is
  // itself stable across a poll tick, so this still resolves once per plan.
  let fileRefMemo: { layer: ReturnType<typeof buildLinkLayer>; refs: FileRefSpanMap } | undefined;
  const fileRefCandidates = $derived.by(() => {
    const link = linkLayer;
    if (fileRefMemo?.layer !== link) {
      fileRefMemo = {
        layer: link,
        refs: mergeFileRefSpans(buildFileRefLayer(link.text), link.fileRefs),
      };
    }
    return fileRefMemo.refs;
  });

  // The review's id as a value-stable derived: the 2s poll hands us a fresh review
  // object every tick, so reading `review.id` directly in an effect re-runs it each
  // tick even when the id is unchanged. A $derived short-circuits on the equal
  // string, so effects keyed on it fire only when the review actually switches.
  const reviewId = $derived(review.id);

  // What each candidate path resolves to in the review's cwd — the daemon is the
  // existence gate and the only thing that can say file vs. directory (EXC-916).
  // Both kinds are kept: a file draws the file glyph and opens the excerpt
  // preview, a directory draws the folder glyph and opens the folder tree
  // (EXC-918). A path absent from the map resolved to nothing and stays inert.
  // Resolved once per candidate-set change: both dependencies below (the memoized
  // candidate map and the value-stable reviewId) hold their reference across a poll
  // tick, so an unchanged plan never re-resolves and the icons and the open hover
  // preview do not flicker every 2s. Cleared up front so a plan edit or review
  // switch drops stale icons at once.
  let resolvedKinds = $state<Map<string, FileRefKind>>(new Map());
  $effect(() => {
    const candidates = fileRefCandidates;
    const id = reviewId;
    const paths = [...new Set([...candidates.values()].flat().map((s) => s.path))];
    resolvedKinds = new Map();
    if (paths.length === 0) return;
    let cancelled = false;
    void resolveFileRefs(id, paths).then((kinds) => {
      if (cancelled) return;
      resolvedKinds = new Map(Object.entries(kinds));
    });
    return () => {
      cancelled = true;
    };
  });

  // The plan's files, highlighted ahead while the reader reads: the opening of the first
  // file in each language, so a file's first open doesn't stall its slide compiling the
  // grammar rules its lines reach. Real source, because a grammar compiles a rule only
  // when a line reaches it, and a sample never reaches what a real file does.
  $effect(() => {
    const firsts = new Map<string, string>();
    for (const [path, kind] of resolvedKinds) {
      const language = languageForPath(path);
      if (kind === "file" && language !== "text" && !firsts.has(language)) firsts.set(language, path);
    }
    if (firsts.size === 0) return;
    const review = reviewId;
    let cancelled = false;
    const warm = async () => {
      for (const path of firsts.values()) {
        if (cancelled) return;
        try {
          const excerpt = await getFileExcerpt(review, path);
          await highlightChunk(excerpt.lines.join("\n"), excerpt.language, appearance.themeId);
        } catch {
          // A file that won't read ahead highlights when it opens.
        }
      }
    };
    if (typeof requestIdleCallback === "function") {
      const idle = requestIdleCallback(() => void warm(), { timeout: 2000 });
      return () => {
        cancelled = true;
        cancelIdleCallback(idle);
      };
    }
    const timer = setTimeout(() => void warm(), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  // The active reference spans: candidates confirmed real, each carrying what the
  // daemon said it is. The kind is attached to a COPY of the span rather than
  // written onto the memoized candidate — that map is keyed on the plan text and
  // survives a review switch, so mutating it would carry one review's kinds into
  // the next. Undefined when none resolve, so SourceView wires no reference
  // affordance in that common case.
  const fileRefs = $derived.by(() => {
    const kinds = resolvedKinds;
    if (kinds.size === 0) return undefined;
    const active: FileRefSpanMap = new Map();
    for (const [line, spans] of fileRefCandidates) {
      const keep = spans.flatMap((s) => {
        const kind = kinds.get(s.path);
        return kind === undefined ? [] : [{ ...s, kind }];
      });
      if (keep.length > 0) active.set(line, keep);
    }
    return active.size > 0 ? active : undefined;
  });
  // The view's one resolved map, re-keyed by display text for the preview, which never
  // resolves on its own.
  const previewRefs = $derived(
    runs("fileReferences") && planPreview && fileRefs
      ? previewFileRefs(fileRefs, linkLayer.text)
      : [],
  );

  // The file the preview is open on, plus the token it was opened from, which the
  // reveal effect below measures so the clicked filename stays visible beside the
  // drawer. It closes on Escape (the dismissal effect below) or on the pane's own
  // close button; leaving the source view hides the lane without clearing this — the dismissal
  // effect carries the matching guard.
  //
  // `token` is optional because there are two openers. A plan reference (EXC-687)
  // has one, and the excerpt is worth nothing if the filename it came from is behind
  // the lane. A file row in the folder card (EXC-1137) has none, and there is nothing
  // to reveal: the row is in a viewport-fixed card that steps clear of the lane
  // itself — so the tokenless open is a missing field rather than a synthesized
  // element, and the reveal effect skips what it cannot measure.
  type OpenFile = { path: string; line?: number; endLine?: number; token?: HTMLElement };
  let filePreview = $state<OpenFile | undefined>();

  // Dismissal slides the lane out past its edge before the drawer leaves, so the
  // pane goes with the excerpt still in it instead of blinking out. The drawer
  // stays mounted for that beat and `drawerClosing` puts it in its closing state,
  // out of the layout; the timer then drops it. Must match the closing lane's
  // duration (--dur-state = 160ms, pinned by motion.test.ts), as must the folding
  // column's below — a timer rather than transitionend because happy-dom fires no
  // transition events, so the unit env would strand the drawer forever.
  const CLOSE_ANIM_MS = 160;
  let drawerClosing = $state(false);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelDrawerClose(): void {
    if (closeTimer !== undefined) clearTimeout(closeTimer);
    closeTimer = undefined;
    drawerClosing = false;
  }

  /** Slide the lane out, dropping the drawer once it has gone. A column the drawer
   * folded stands again in the same frame, as the plan takes the lane's room back. */
  function dismissFilePreview(): void {
    if (filePreview === undefined || drawerClosing) return;
    // Below the early return, so a redundant dismiss stays silent.
    sound.play("filePreviewClose");
    slide(fileParts, () => (drawerClosing = true));
    closeTimer = setTimeout(() => {
      filePreview = undefined;
      cancelDrawerClose();
    }, CLOSE_ANIM_MS);
  }

  /** Slide the lane in, a column it folds sliding out with it. Reopening mid-close
   * drops the pending unmount, so the lane slides back on the same instance rather
   * than being torn out from under it. */
  function openFilePreview(next: OpenFile): void {
    sound.play("filePreviewOpen");
    slide(fileParts, () => {
      cancelDrawerClose();
      filePreview = next;
    });
  }

  // The directory reference whose tree is open (EXC-918), plus the clicked
  // token's box. A viewport-fixed card rather than the file preview's lane: a
  // folder has no `:line` to bound it, so the surface is one to navigate rather
  // than to peek at, and it is dismissed by the next click AWAY from it, or by
  // Escape, rather than sized and lived in. It can stand open BESIDE the lane
  // (EXC-1129) all the same, and is placed clear of it.
  //
  // The RECT rather than the element: the card places itself once and never
  // tracks the token, and the plan surface it belongs to is torn out whenever
  // the source view gives way — a detached element measures all zeros, which would park
  // the card in the viewport's corner and keep the dead subtree alive besides.
  let folderTree = $state<{ path: string; rect: DOMRect } | undefined>();

  // One reference click, two surfaces. The daemon said which this is (EXC-916),
  // so the branch is on the kind the span carries rather than on the path's shape
  // — the whole point of resolving server-side. The two are PEERS (EXC-1129):
  // opening either leaves the other standing, so following a plan that cites a
  // folder and the files under it never costs the reader the surface they were
  // already using. What makes that safe is two rules below — the card's click
  // handler treats the lane as a coexisting surface rather than as "outside", and
  // the lane yields Escape to the card stacked over it.
  function openFileRef(ref: FileRefSpan, tokenElement: HTMLElement): void {
    // The one funnel every reference open passes through — the token click, the
    // badge's own activation, and any keyboard opener a later change adds — so
    // retiring the hint here (EXC-1061) covers all of them without a second call
    // site to keep in step. Only the opened kind retires: learning that a
    // filename opens an excerpt teaches nothing about the folder tree.
    if (ref.kind !== undefined) {
      dismissRefHint(ref.kind);
      refHints = refHints.filter((h) => h.kind !== ref.kind);
    }
    if (ref.kind === "directory") {
      folderTree = { path: ref.path, rect: tokenElement.getBoundingClientRect() };
      return;
    }
    openFilePreview({ path: ref.path, line: ref.line, endLine: ref.endLine, token: tokenElement });
  }

  $effect(() => () => cancelDrawerClose());

  // Where the folder cards of THIS review are remembered (EXC-1138). Held here
  // rather than as a module singleton so a review switch can discard the whole
  // instance below.
  let folderCards = $state.raw(createFolderMemory());

  // A review switch drops the open card, and every card the reader has been in.
  // Their contents belong to the previous review's cwd, and the 2s poll can swap
  // the review under a reader who left one open — so without this the card sits
  // over a different plan describing a directory tree that has nothing to do
  // with it.
  //
  // A fresh instance rather than a map emptied in place: the card this effect
  // dismisses files ITS memory on the way out, after the effect has already run.
  // The outgoing card holds the OLD instance, so that write lands somewhere
  // nothing references any more instead of surviving the switch it was meant to
  // be dropped by.
  $effect(() => {
    void reviewId;
    folderTree = undefined;
    folderCards = createFolderMemory();
  });

  // The folder card's dismissal, mirroring the file preview's below: Escape, or a
  // click outside the card, both in the CAPTURE phase so they run before the
  // plan's own handlers. `composedPath` is what makes this work over a surface
  // behind a shadow root — a click on a tree row still carries the card.
  //
  // One exemption list, and everything on it means the same thing: this click
  // belongs to a surface the reader is still using, so the card neither closes nor
  // swallows it and it does its own job on the FIRST press. That covers the card
  // itself, the excerpt lane it coexists with (EXC-1129) — where the close circle
  // is the click that would otherwise cost two — and the two openers, a reference
  // token and the hint badge that teaches it (EXC-1061), which are on the list
  // because swallowing them would make the affordance dead for as long as a card
  // is open. Every other click is a click away from the card: it closes,
  // and is swallowed so dismissing never also opens a line comment.
  const CARD_EXEMPT = "[data-folder-tree], [data-file-drawer], [data-file-ref], [data-ref-hint]";

  // Gated on the fileReferences surfaces, not just the state: elsewhere the card is
  // off screen with `folderTree` still set, and these handlers would eat an Escape
  // and a click from the visible view.
  $effect(() => {
    if (!runs("fileReferences") || folderTree === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      folderTree = undefined;
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      if (e.composedPath().some((n) => n instanceof Element && n.matches(CARD_EXEMPT))) return;
      folderTree = undefined;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("click", onClick, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("click", onClick, { capture: true });
    };
  });

  // Escape dismissal (EXC-840), in the CAPTURE phase so it runs before the plan's
  // own handlers. It is the keyboard half of a pair with the pane's close circle.
  // A click OUTSIDE the lane deliberately does nothing here (EXC-1067) — the
  // preview is a docked lane rather than a popover, so it takes layout space
  // beside the plan instead of covering it and there is no "outside" in the modal
  // sense to click away from. The reader works in the plan with the excerpt beside
  // them, and every click they spend there does its own job on the first press.
  // The folder card's effect above keeps its outside-click dismissal: that surface
  // IS viewport-fixed over the plan, so the divergence tracks the two surfaces'
  // shapes rather than being drift.
  //
  // Gated on the fileReferences surfaces, not just the state: elsewhere the lane is
  // hidden with `filePreview` still set, and its handler would swallow Escape.
  //
  // Gated on the card too (EXC-1129), which is what gives the two coexisting
  // surfaces an Escape ORDER. Both handlers are capture-phase listeners on the same
  // window, where `stopPropagation` says nothing to a sibling — so one press would
  // close both. Precedence is therefore state rather than a listener race: the card
  // is stacked above the lane, so while one is open the lane simply does not listen.
  // Closing it re-runs this effect, and the next Escape reaches the lane. The outline's
  // float and the find row stand over the lane the same way.
  $effect(() => {
    if (!runs("fileReferences") || filePreview === undefined) return;
    if (folderTree !== undefined || floatOpen || keyboardStore.searchOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || drawerClosing) return;
      dismissFilePreview();
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  });

  // Which edge the preview docks to: the right of the plan surface when there is
  // width to spare, the bottom once there isn't. It rides the same `narrow`
  // subscription the compare view's split→unified flip uses, so a resize
  // re-docks the drawer for free and there is no second breakpoint to keep in
  // sync — and no user-facing control, since the choice is purely about room.
  const drawerEdge = $derived<DrawerEdge>(narrow ? "bottom" : "right");
  // The whole surface the plan and the drawer divide between them. The reveal
  // effect measures THIS rather than .diff-plan: the surface's height never
  // changes, so the geometry is the same whether the effect runs before, during,
  // or after the lane's opening slide. Its size is *bound* (a ResizeObserver under
  // the hood) rather than measured, so the clamp below tracks any window resize —
  // including one that never crosses the breakpoint, which would otherwise leave
  // the plan pane squeezed past its minimum with nothing to re-clamp it. No
  // feedback loop: the surface's own size does not depend on the drawer's.
  let surfaceEl = $state<HTMLElement | undefined>();
  let surfaceWidth = $state(0);
  let surfaceHeight = $state(0);
  const drawerAxis = $derived(drawerEdge === "right" ? surfaceWidth : surfaceHeight);
  // What the reader last chose for each edge — storage seeds it, a drag replaces
  // it. Held apart from the size actually rendered so their choice survives a
  // window too narrow to honour it: narrowing shrinks the lane, widening restores
  // what they picked. Two keys, so a right-edge drag is never a bottom-edge one.
  const chosenSize = $state<Record<DrawerEdge, number | null>>({
    right: readDrawerSize("right"),
    bottom: readDrawerSize("bottom"),
  });
  const drawerSize = $derived(
    clampDrawerSize(
      chosenSize[drawerEdge] ?? drawerAxis * DEFAULT_DRAWER_SHARE,
      drawerAxis,
      drawerEdge,
    ),
  );
  function setDrawerSize(px: number | null): void {
    chosenSize[drawerEdge] = px;
    writeDrawerSize(drawerEdge, px);
  }

  // The outline stands as a column beside the plan while the reader keeps it out, unless
  // the window is under --w-narrow; a file docked right shares the surface beside it.
  // Hidden or unable to stand, it drops from `\` as a float over the plan. Compare has no
  // outline: the column folds as a mode that leaves the reader's choice alone.
  let outline = $state<PlanOutline>(readPlanOutline());
  let floatOpen = $state(false);
  let bodyWidth = $state(0);
  const outlineRuns = $derived(runs("headingTracking") && !showDiff);
  let columnChosen = $state(outlineWidthPref.read());
  const columnWidth = $derived(outlineWidth(columnChosen, bodyWidth, remPx()));
  const columnBounds = $derived(outlineBounds(bodyWidth, remPx()));
  const columnShown = $derived(outlineRuns && outline === "shown" && !narrow);

  // The column shows or hides in one update, but the bound surface width catches up a
  // frame later, so an open drawer would size for the old surface and then shift under a
  // card already placed against it. Read it now.
  $effect(() => {
    void columnShown;
    if (surfaceEl !== undefined) surfaceWidth = surfaceEl.clientWidth;
  });

  // The column is sized in rem, so a larger default font widens it with the text.
  function remPx(): number {
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(root) ? root : 16;
  }

  function setColumnWidth(px: number | null): void {
    columnChosen = px;
    outlineWidthPref.write(px);
  }

  // The layout's live moves (lib/layoutSlide.ts): the column standing or folding, and a
  // file docking beside the plan or leaving it. A folding column stays mounted out of the
  // layout while it slides away, `columnLeaving`, and its key travels in its well to the
  // header's outline key, which waits unseen until the column has gone, letting go of its
  // latch on the way. A standing column's key latches as it travels in, so it mounts at
  // rest for the style pass the slide starts from, `keyEntry` "rest", then latches on
  // the slide's clock, "latching"; a click's key is down already, and mounts latched.
  let columnLeaving = $state(false);
  let keyEntry = $state<"rest" | "latching" | null>(null);
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let bodyEl = $state<HTMLElement | undefined>();
  let paneEl = $state<HTMLElement | undefined>();
  let floorEl = $state<HTMLElement | undefined>();
  let lipEl = $state<HTMLElement | undefined>();
  let bedEl = $state<HTMLElement | undefined>();
  let crumbSlotEl = $state<HTMLElement | undefined>();
  let headerWellEl = $state<HTMLElement | undefined>();
  const COLUMN_KEY = ".toc-title-row .header-tray";
  const lane = (open: boolean) =>
    surfaceEl?.querySelector<HTMLElement>(
      open ? "[data-file-drawer]:not([data-file-drawer-closing])" : "[data-file-drawer]",
    );
  const part = (el: () => HTMLElement | null | undefined): SlidePart => ({
    before: el,
    after: el,
  });
  // A folding column is a part too, so one caught standing folds from where it got to in
  // step with the slide: a transition turned back runs shorter than the slide.
  const columnParts: SlidePart[] = [
    {
      before: () => outlineEl,
      after: () => outlineEl,
      enter: { from: (box) => ({ x: -box.width, y: 0 }), duration: "var(--dur-pane)" },
    },
    {
      before: () => outlineEl?.querySelector<HTMLElement>(COLUMN_KEY) ?? headerWellEl,
      after: () => outlineEl?.querySelector<HTMLElement>(COLUMN_KEY),
    },
  ];
  // The column's edge moves only the plan's left edge, so the pane holds still: its floor,
  // recess and header bed stretch from that edge, and the plan's text, the crumbs and the
  // find row slide with it, inside a crumb slot that clips them at its own end. The Search
  // entry and the view keys stay where they are. Only transforms move, so nothing waits on
  // a frame.
  const outlineParts: SlidePart[] = [
    ...columnParts,
    // Held only, so a move it interrupts ends where this one starts, and what it holds
    // slides from wherever that move had got it to.
    { before: () => null, after: () => paneEl },
    { ...part(() => floorEl), stretches: "both" },
    { ...part(() => bedEl), stretches: "both" },
    part(() => scrollEl),
    part(() => crumbSlotEl?.querySelector<HTMLElement>(".plan-breadcrumbs")),
    part(() => crumbSlotEl?.querySelector<HTMLElement>(".plan-search")),
    part(() => crumbSlotEl?.querySelector<HTMLElement>(".search-entry")),
    part(() => paneEl?.querySelector<HTMLElement>(".compare-picker")),
    { ...part(() => lipEl), stretches: "both" },
  ];
  // A file moves both of the plan's edges, the lane covering the right one, so the pane
  // slides whole, the crumbs and the find row inside it from where they stood. The floor,
  // the recess, the header bed and the plan's text start their left edge from wherever an
  // outline move had got it to; their right edge is the pane's.
  const fileParts: SlidePart[] = [
    ...columnParts,
    part(() => paneEl),
    { ...part(() => floorEl), stretches: "start" },
    { ...part(() => lipEl), stretches: "start" },
    { ...part(() => bedEl), stretches: "start" },
    part(() => scrollEl),
    part(() => crumbSlotEl?.querySelector<HTMLElement>(".plan-breadcrumbs")),
    part(() => crumbSlotEl?.querySelector<HTMLElement>(".plan-search")),
    {
      before: () => lane(false),
      after: () => lane(true),
      enter: {
        from: (box) => (drawerEdge === "right" ? { x: box.width, y: 0 } : { x: 0, y: box.height }),
        duration: "var(--dur-pane)",
      },
    },
  ];

  /** Apply a layout change at once, and slide `parts` from where they stood. */
  function slide(parts: SlidePart[], change: () => void): void {
    const stood = columnShown;
    slideLayout(
      parts,
      (sliding) => {
        change();
        // In the same flush as the change, so the folding column is never unmounted.
        if (sliding && stood && !columnShown) leaveColumn();
        if (sliding && !stood && columnShown && !outlineKeyClicked) keyEntry = "rest";
        flushSync();
      },
      {
        duration: () => (columnShown && !stood ? "var(--dur-pane)" : "var(--dur-state)"),
        measured: aimLeavingKey,
      },
    );
    if (keyEntry === null) return;
    keyEntry = "latching";
    flushSync();
    // The latch starts in this style pass, on the arriving key's timing, which it keeps.
    void outlineEl?.getBoundingClientRect();
    keyEntry = null;
    flushSync();
  }

  function leaveColumn(): void {
    clearTimeout(leaveTimer);
    columnLeaving = true;
    // Its latch lets go as it travels, which a shortcut's press echo would hold down.
    outlineEl?.querySelector(`${COLUMN_KEY} > [data-key-pressed]`)?.removeAttribute("data-key-pressed");
    leaveTimer = setTimeout(() => (columnLeaving = false), CLOSE_ANIM_MS);
  }

  function dropLeavingColumn(): void {
    clearTimeout(leaveTimer);
    columnLeaving = false;
  }
  $effect(() => () => clearTimeout(leaveTimer));

  /** Aim the folding column's key at the header's key: the offset its well ends at, in
   * the column slid a column's width off. Read off the layout, transform-free, so a fold
   * that reverses a standing column mid-slide aims true. */
  function aimLeavingKey(): void {
    const well = outlineEl?.querySelector<HTMLElement>(COLUMN_KEY);
    if (!columnLeaving || columnShown || !outlineEl || !well || !headerWellEl || !bodyEl) return;
    let x = 0;
    let y = 0;
    for (let el: Element | null = well; el instanceof HTMLElement && el !== bodyEl; el = el.offsetParent) {
      x += el.offsetLeft;
      y += el.offsetTop;
    }
    const body = bodyEl.getBoundingClientRect();
    const to = headerWellEl.getBoundingClientRect();
    well.style.setProperty("--key-dx", `${to.left - body.left - x + outlineEl.offsetWidth}px`);
    well.style.setProperty("--key-dy", `${to.top - body.top - y}px`);
  }

  function setOutline(next: PlanOutline): void {
    slide(outlineParts, () => {
      outline = next;
      writePlanOutline(next);
    });
  }

  // Compare swaps the plan's content as well as moving it, so it runs as one view
  // transition (lib/paneMove.ts), the column folding or standing inside it.
  const movePanes = createPaneMove();

  function setComparing(next: boolean): void {
    movePanes(next ? "exit" : "enter", () => {
      dropLeavingColumn();
      compare.setComparing(next);
    });
  }

  // Shift+\ and the header's key show or hide the column; neither opens the float.
  function toggleOutline(): void {
    setOutline(outline === "shown" ? "hidden" : "shown");
  }

  // A press from the pointer or from Space holds the header's key down until its click
  // lands, so the column it stands brings its key in latched; Enter's click shows no
  // press. `:active` has lifted by the time the click lands, and Space's click, like
  // Enter's, carries no `detail`, so the key notes a held Space itself.
  let outlineKeyClicked = false;
  let outlineKeySpace = false;
  function clickOutlineKey(event: MouseEvent): void {
    outlineKeyClicked = event.detail > 0 || outlineKeySpace;
    outlineKeySpace = false;
    toggleOutline();
    outlineKeyClicked = false;
  }

  // `\` lands in the column's filter while it is shown, and opens the float on its own
  // filter otherwise.
  function filterOutline(): void {
    if (columnShown) openColumnFilter?.();
    else if (!floatOpen) {
      floatReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      floatOpen = true;
    }
  }

  // Handed up by the column, which owns its filter.
  let openColumnFilter: (() => void) | undefined;
  let outlineEl = $state<HTMLElement | undefined>();
  let outlineKey = $state<HTMLButtonElement | null>(null);
  let floatEl = $state<HTMLElement | null>(null);
  let floatAnchor = $state<HTMLElement | null>(null);
  // Where focus stood before `\` opened the float, for Escape to hand it back.
  let floatReturn: HTMLElement | null = null;
  // A pick from the float hands the reviewer to the plan rather than back to the key.
  let floatPicked = false;

  // A float has nothing to float over once the column stands.
  $effect(() => {
    if (columnShown) floatOpen = false;
  });

  // The column and the header's outline key replace each other, so whichever one held
  // focus hands it to the other as it leaves; Compare has no outline key, so there it is
  // Versions'. The float leaves as the column stands.
  $effect.pre(() => {
    const shown = columnShown;
    const leaving = untrack(() => (shown ? [outlineKey, floatEl] : [outlineEl]));
    if (!leaving.some((el) => el?.contains(document.activeElement))) return;
    void tick().then(() =>
      (shown
        ? outlineEl?.querySelector<HTMLButtonElement>(`${COLUMN_KEY} > button`)
        : (outlineKey ?? paneEl?.querySelector<HTMLButtonElement>(".compare-toggle"))
      )?.focus(),
    );
  });

  function pickFromFloat(line: number): void {
    floatPicked = true;
    floatOpen = false;
    pickHeading(line);
  }

  // Scroll the clicked filename clear of the drawer. Only the bottom dock can
  // cover it — a right dock shortens the plan's width, never its reading height —
  // so the inset is the lane's height there and zero otherwise. The guarantee is
  // free rather than a spacer trick: shortening .diff-plan raises its max scroll
  // by the same amount, and the EXC-772 scroll-past-the-end room means even a
  // reference on the plan's last line has somewhere to go. `drawerSize` is read
  // untracked so dragging the handle resizes the lane without also scrolling the
  // plan on every frame. The scroll is instant because the lane is already
  // animating, and a competing smooth scroll reads as two motions. The lane takes its
  // room in the layout pass that docks it, so one write has all the room it needs.
  $effect(() => {
    const token = filePreview?.token;
    const edge = drawerEdge;
    if (token === undefined || !token.isConnected) return;
    const scroller = scrollEl;
    const surface = surfaceEl?.getBoundingClientRect();
    if (scroller === undefined || surface === undefined) return;
    const rect = token.getBoundingClientRect();
    const inset = untrack(() => (edge === "bottom" ? drawerSize : 0));
    const delta = revealScrollDelta({
      cardTop: rect.top,
      cardBottom: rect.bottom,
      viewTop: scroller.getBoundingClientRect().top,
      viewBottom: surface.bottom - inset,
      margin: REVEAL_MARGIN_BOTTOM,
    });
    if (delta !== 0) scroller.scrollTop += delta;
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
  // hit-testing and chrome anchoring) and its fence-stripped code (for the clipboard).
  // Backs the per-block chrome (EXC-692, EXC-1386). Computed from the SAME text the view
  // renders (linkLayer.text) so the ranges line up with the shadow rows' data-line numbers,
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
  // the host element whose annotation slots we project comments into. Never cleared —
  // it outlives SourceView on the plan preview and in compare — so anything outside
  // SourceView's branch that reads it (or `host`) gates through runs(…); that gate,
  // not a null check, is what keeps a detached shadow root inert.
  let api = $state<SourceViewApi | undefined>();
  const host = $derived(api?.host);
  // The compare view's counterpart, captured the same way. Undefined until the
  // diff mounts, and it keeps the last instance after compare mode closes — the
  // reveal below only reaches for it while showDiff, so a stale one is inert.
  let diffApi = $state<SourceDiffViewApi | undefined>();

  // The code block the reviewer's pointer is over — what brightens that block's chrome
  // (EXC-1386). Undefined when the pointer is over no block.
  let hoveredBlockStart = $state<number | undefined>();

  // The blocks the reviewer has soft-wrapped, by opening line. Transient by design: no
  // preference, nothing persisted, and it empties on a review or version switch below.
  let reflowedBlocks = $state<ReadonlySet<number>>(new Set());
  const toggleReflow = (start: number): void => {
    // A fresh Set rather than a mutation — the reference change is what re-runs the
    // tagging effect in SourceView and the chrome sync below.
    const next = new Set(reflowedBlocks);
    if (!next.delete(start)) next.add(start);
    reflowedBlocks = next;
  };
  // Empty the choices on a review or version switch: they name blocks that are no longer
  // on screen. contentKey rather than the text, so an unchanged poll tick re-delivering the
  // same version leaves a live wrap alone.
  $effect(() => {
    void contentKey;
    reflowedBlocks = new Set();
  });

  // Where each block's chrome sits, in .diff-plan content coordinates, whether the block
  // overflows unwrapped — the predicate the wrap button gates on — and the code its copy
  // button writes.
  let chromeBoxes = $state<ChromeBox[]>([]);

  // A version switch, a fresh SourceView, or a flip between source and preview leaves the
  // boxes holding the previous document's coordinates and code, and on the source the first
  // re-sync is a frame away — long enough to paint them over rows they were never measured
  // on.
  $effect(() => {
    void contentKey;
    void host;
    void surface;
    chromeBoxes = [];
  });

  // The chrome's geometry on the surface on screen: on the source, what to observe for
  // resizes; the hit-test, and the anchors. Undefined where no chrome renders — off the
  // codeChrome row, before the surface mounts, or with no fenced block. A preview block
  // joins a source block by `start`, so one the source view does not see gets no chrome.
  const chromeGeometry = $derived.by(
    (): ChromeGeometry | undefined => {
      const blocks = codeBlocks;
      if (!runs("codeChrome") || blocks.length === 0) return undefined;
      const textByStart = new Map(blocks.map((b) => [b.range.start, b.text]));
      if (surface === "preview") {
        const root = previewEl;
        if (root == null) return undefined;
        return {
          observed: undefined,
          blockAt: (x, y) => previewCodeBlockAtPoint(root, x, y),
          boxes: (scroller) =>
            previewCodeChromeAnchors(root, scroller, reflowedBlocks).filter((b) =>
              textByStart.has(b.start),
            ),
        };
      }
      const el = host;
      if (el == null) return undefined;
      const ranges = blocks.map((b) => b.range);
      return {
        observed: el,
        blockAt: (x, y) => codeBlockAtPoint(el, ranges, x, y)?.start,
        boxes: (scroller) =>
          codeChromeAnchors(el, scroller, ranges).flatMap((a) => {
            const text = textByStart.get(a.start);
            return text === undefined ? [] : [{ ...a, text }];
          }),
      };
    },
  );

  // Track the hovered code block from pointer moves over the scroll container; the
  // geometry does the hit-test. rAF-throttled, and it yields a key rather than a
  // position — every block's chrome is anchored by the sync effect below, whatever the
  // pointer is doing.
  $effect(() => {
    const scroller = scrollEl;
    const geometry = chromeGeometry;
    // A flip between surfaces swaps one geometry for another; a kept key would brighten
    // the new surface's block with the same `start` until the pointer moves.
    hoveredBlockStart = undefined;
    if (scroller == null || geometry === undefined) return;
    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    const update = () => {
      raf = 0;
      hoveredBlockStart = geometry.blockAt(lastX, lastY);
    };
    const onMove = (event: PointerEvent) => {
      lastX = event.clientX;
      lastY = event.clientY;
      if (raf === 0) raf = requestAnimationFrame(update);
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      hoveredBlockStart = undefined;
    };
    scroller.addEventListener("pointermove", onMove);
    scroller.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("pointermove", onMove);
      scroller.removeEventListener("pointerleave", onLeave);
    };
  });

  // Keep every block's chrome anchored. The preview re-anchors on previewLayoutRev; the
  // source re-syncs, rAF-throttled, from a ResizeObserver over its content
  // (`geometry.observed`). Content coordinates survive scrolling, so only a block's box
  // changing matters — a library repaint, a block being re-carded after a repaint, a
  // viewport resize — and each changes the rendered height the observer watches. The
  // chrome is a light-DOM child of .diff-plan, so it scrolls with the rows for free.
  $effect(() => {
    const scroller = scrollEl;
    const geometry = chromeGeometry;
    // A wrap toggle changes a block's height: depending on it re-measures now rather than
    // waiting for the ResizeObserver to report the new box.
    void reflowedBlocks;
    if (scroller == null || geometry === undefined) {
      chromeBoxes = [];
      return;
    }
    if (geometry.observed === undefined) {
      void previewLayoutRev;
      chromeBoxes = geometry.boxes(scroller);
      return;
    }
    let raf = 0;
    const sync = () => {
      raf = 0;
      chromeBoxes = geometry.boxes(scroller);
    };
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(sync);
    };
    // The source rows are tagged and carded on a frame off SourceView's MutationObserver,
    // so there is nothing to measure for the first few frames after a document arrives.
    const cancelFrames = retryFrames(() => {
      sync();
      return chromeBoxes.length > 0;
    });
    const observer = new ResizeObserver(schedule);
    observer.observe(geometry.observed);
    return () => {
      cancelFrames();
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  });

  // The one-time reference hints (EXC-1061): where to badge the first on-screen
  // file reference and the first on-screen directory reference, in .diff-plan
  // content coordinates. Empty once both kinds are retired, and the effect below
  // is what fills it.
  let refHints = $state<RefHintAnchor[]>([]);
  // What the hints were last measured against, so a document is measured exactly
  // once. It takes BOTH halves because neither moves on its own: a compare-mode
  // toggle-back mounts a fresh SourceView (new host, same contentKey), while a
  // review or version switch keeps the very same container element and only swaps
  // its contents (same host, new contentKey) — the library re-renders into the
  // container rather than remounting the component. Scrolling and an unchanged
  // poll tick move neither, which is what keeps the badges and their running ping
  // in place. Deliberately a plain `let`, so reading it below is not a dependency.
  let measured: { host: HTMLElement; key: string } | undefined;

  // Keep the badges anchored, for as long as this document is on screen. The work is
  // syncRefHints (refHint.ts); this effect only decides WHEN to run it, and the answer
  // is "whenever anything could have moved a token", because two things can:
  //
  // The reviewer SCROLLS — the pick only ever anchors to a reference in view.
  //
  // The content RESIZES. Content coordinates survive scrolling by construction, but
  // not a change in the height of anything above the token — a web font arriving,
  // shiki repainting a row, a fenced block moving back into its card. A badge
  // holding coordinates from before such a shift sits where its token used to be, and
  // observing the host catches all of them: they all change the rendered height.
  //
  // rAF-throttled together, so a flung scroll costs one sync per frame. `refHints` is
  // keyed by kind in the template, so a sync updates the badge's props and leaves the
  // instance — and its running ping — alone.
  $effect(() => {
    const scroller = scrollEl;
    const el = host;
    const refs = fileRefs;
    const key = contentKey;
    // Nothing to teach off the referenceHints surfaces, and their content is a
    // different document — syncing there would walk the source view's torn-out
    // shadow root for a badge that cannot render anyway.
    if (!runs("referenceHints") || scroller == null || el == null || refs === undefined) return;
    // A different document: its rows are not the ones the current hints chose, so
    // start the choice over rather than re-anchoring onto whatever now sits there.
    if (measured?.host !== el || measured.key !== key) {
      refHints = [];
      measured = { host: el, key };
    }
    if (isRefHintDismissed("file") && isRefHintDismissed("directory")) return;

    let raf = 0;
    const sync = (): void => {
      raf = 0;
      // Re-read the flags every sync rather than closing over a snapshot: opening a
      // reference retires its kind without changing anything this effect depends on,
      // so a captured list would re-pick the badge the reviewer just spent.
      const kinds = (["file", "directory"] as const).filter((k) => !isRefHintDismissed(k));
      refHints = syncRefHints(el, scroller, refs, kinds, refHints);
    };
    const schedule = (): void => {
      if (raf === 0) raf = requestAnimationFrame(sync);
    };
    // The first sync still spends the painted-row budget: the tokens are tagged on a
    // frame off SourceView's MutationObserver, so there is nothing to anchor to for
    // the first few frames after a document arrives.
    const cancelFrames = retryFrames(() => {
      sync();
      return refHints.length > 0;
    });
    scroller.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    return () => {
      cancelFrames();
      cancelAnimationFrame(raf);
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
    };
  });

  // Re-hover the row under a stationary cursor as the plan scrolls (EXC-836). The
  // browser re-evaluates hover only on pointer MOVE, never on scroll, and the
  // @pierre/diffs view drives its row highlight (data-hovered) and gutter "+" off its
  // own pointermove — not CSS :hover — with no scroll listener of its own. So scrolling
  // the plan under a still pointer leaves both glued to the row that scrolled away.
  // Re-fire the real gesture: on scroll, synthesize a pointermove at the retained cursor
  // position into the row now beneath it. The library re-hovers that row (highlight +
  // "+"), and the composed event bubbles out to .diff-plan so the block-hover effect above
  // re-lights the chrome on the block now under the pointer — one re-fire drives every
  // hover-dependent affordance.
  // rAF-throttled, and gated on pointer presence so a programmatic scroll (a vim j/k
  // motion) with the pointer away can't resurrect a stale hover.
  $effect(() => {
    const scroller = scrollEl;
    const el = host;
    if (!runs("lineComments") || scroller == null || el == null) return;
    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    let inside = false;
    const rehover = () => {
      raf = 0;
      // Same shadow-root hit-test SourceView.lineAtPoint uses; dispatch on the resolved
      // row so the library resolves it from the event's composedPath, exactly as a real
      // move would.
      const target = el.shadowRoot?.elementFromPoint(lastX, lastY);
      target?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          composed: true,
          clientX: lastX,
          clientY: lastY,
          pointerType: "mouse",
        }),
      );
    };
    const onMove = (event: PointerEvent) => {
      inside = true;
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onLeave = () => {
      inside = false;
    };
    const onScroll = () => {
      if (inside && raf === 0) raf = requestAnimationFrame(rehover);
    };
    scroller.addEventListener("pointermove", onMove, { passive: true });
    scroller.addEventListener("pointerleave", onLeave, { passive: true });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("pointermove", onMove);
      scroller.removeEventListener("pointerleave", onLeave);
      scroller.removeEventListener("scroll", onScroll);
    };
  });

  // Gates the live `?heading=` mirror until the deep-link restore has consumed any
  // incoming `?heading=`. Without it, the mirror effect (activeLine starts null)
  // could clear the param before the first surface's restore (`onSourceReady`, or the
  // preview's restore effect below) reads it, depending on which
  // post-mount effect runs first.
  let restored = $state(false);

  // How many frames anything needing a painted row waits for one. The library
  // paints its rows asynchronously after the container is ready, so a fresh target
  // may not exist on the first frame; the budget lets a jump land even on a long,
  // highlight-heavy plan.
  const PAINT_RETRY_FRAMES = 30;

  /** Run `attempt` each frame until it reports success or the budget runs out.
   * Returns a canceller for the pending frame. */
  function retryFrames(attempt: () => boolean): () => void {
    let raf = 0;
    let tries = 0;
    const step = () => {
      if (attempt() || ++tries >= PAINT_RETRY_FRAMES) return;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }

  // Scroll to a 1-based line once the library has painted the target row
  // (scrollToLine reports whether it had one). Shared by the deep-link restore and
  // the comment navigator's reveal; neither outlives the view it scrolls, so the
  // canceller goes unused here.
  function retryScrollTo(line: number): void {
    const a = api;
    if (a == null) return;
    retryFrames(() => a.scrollToLine(line));
  }

  // Reveal a commented line for the host (the comment navigator): scroll whichever
  // view is on screen to it. While comparing, the side picks which of the diff's
  // two documents the line names; otherwise it is ignored and the source view scrolls
  // to the line, or the preview to the line's item in its comment slot. Each spends the
  // same paint budget waiting for its target.
  function revealLine(line: number, side?: DiffSide): void {
    if (showDiff) {
      const d = diffApi;
      if (d == null) return;
      // Every linkable compare entry carries a side, so the fallback is only
      // reached by a caller that omitted one; "after" is the base version — the
      // side a reviewer reads as "the plan as it stands".
      retryFrames(() => d.scrollToLine(line, side ?? "after"));
      return;
    }
    if (!runs("commentThreads")) return;
    if (surface === "preview") {
      retryFrames(() => revealPreviewSlot(line));
      return;
    }
    retryScrollTo(line);
  }

  // False until the line's slot is measured, so retryFrames waits for the sync pass.
  function revealPreviewSlot(line: number): boolean {
    if (!slotBoxes.has(line) || !scrollEl) return false;
    const slot = scrollEl.querySelector<HTMLElement>(`[data-preview-slot="${line}"]`);
    const item = slot?.querySelector<HTMLElement>(`[data-slot-line="${line}"]`);
    if (!slot || !item) return false;
    scrollRowIntoView(slot, item);
    return true;
  }

  // Take the reviewer to a heading they picked in the breadcrumbs bar. The line
  // cursor goes with them: a pick is a deliberate move, so it relocates the cursor
  // exactly as a line click does in openRange below, and the reviewer's next
  // motion, comment or visual selection starts from the heading they chose.
  // Scrolling never lands here — the trail re-roots on the scroll observer, and
  // only a pick calls onJump — so reading around leaves the cursor untouched.
  function pickHeading(line: number): void {
    latchHeading(line);
    keyboardStore.cursorLine = line;
    if (surface !== "preview") {
      api?.scrollToLine(line);
      return;
    }
    const block = previewBlock(line);
    if (previewEl != null && block != null) scrollRowIntoView(previewEl, block);
  }

  function previewBlock(line: number): Element | null {
    const i = planPreview ? blockIndexForLine(planPreview.blocks, line) : null;
    return previewEl && i != null ? (previewEl.children[i] ?? null) : null;
  }

  // Captures the imperative API and restores a deep-linked heading
  // (`?heading=<slug>`) by resolving the slug to its source line and scrolling to
  // it. takeHeadingSlug() clears the param, so a later SourceView remount (a version
  // switch) won't re-jump — the live `?heading=` mirror takes over from there. An
  // unknown or stale slug resolves to null and is a no-op. A place carried from the
  // preview wins over the slug: by then the URL holds the preview's live mirror, not
  // a link the reader opened.
  function onSourceReady(a: SourceViewApi) {
    api = a;
    const slug = carriedLine == null ? takeHeadingSlug() : null;
    const line = slug != null ? lineForSlug(headings, slug) : null;
    const carried = carriedLine;
    carriedLine = null;
    if (line != null) retryScrollTo(line);
    else if (carried != null) {
      releasePlace();
      releasePlace = keepPlace(() => a.host, () => rowForLine(a.host, carried));
    }
    restored = true;
  }

  // Cancels the pending landing or ends the live hold, whichever is current.
  let releasePlace: () => void = () => {};
  // The preview's top line, waiting for the next SourceView to hand over its api.
  let carriedLine: number | null = null;

  // A flip parks the new surface on the reader's place instantly — it swaps the view
  // rather than travelling, so a glide would slide through unrelated text — and holds
  // it there while images load and rows highlight.
  function keepPlace(
    content: () => Element | null | undefined,
    target: () => Element | null,
  ): () => void {
    let releaseHold: (() => void) | undefined;
    const cancelFrames = retryFrames(() => {
      const box = content();
      if (scrollEl == null || box == null || target() == null) return false;
      releaseHold = holdPlace({ scroller: scrollEl, content: box, target });
      return true;
    });
    return () => {
      cancelFrames();
      releaseHold?.();
    };
  }

  function capturePlace(): void {
    if (planView === "source") {
      const line = topVisibleLine();
      if (line == null) return;
      releasePlace();
      releasePlace = keepPlace(() => previewEl, () => previewBlock(line));
    } else {
      carriedLine = topVisibleLine();
    }
  }

  // The preview's counterpart of onSourceReady's deep-link restore, on its first mount.
  $effect(() => {
    if (restored || surface !== "preview" || previewEl == null || planPreview == null) return;
    const slug = takeHeadingSlug();
    const line = slug != null ? lineForSlug(headings, slug) : null;
    if (line != null) {
      releasePlace();
      releasePlace = keepPlace(() => previewEl, () => previewBlock(line));
    }
    restored = true;
  });

  // Keyed on contentKey, not surface: the flip itself changes surface, and that
  // teardown would cancel the hold the flip just scheduled.
  $effect(() => {
    void contentKey;
    return () => releasePlace();
  });

  // Hand the host the reveal(line) action once. `untrack` keeps onExposeReveal from
  // becoming a reactive dependency; revealLine closes over the live `api` and preview
  // slots, so exposing it before the view paints is safe (the reveal simply no-ops until
  // the api lands).
  $effect(() => {
    untrack(() => onExposeReveal)?.(revealLine);
  });

  // The source line of the heading currently in the reading zone. Tracked from
  // the scroll container's topmost rendered line so the breadcrumbs bar reports
  // the section being read.
  let activeLine = $state<number | null>(null);
  // A deliberate jump (an outline pick, a crumb, a heading key) latches its heading at once
  // and holds it while the plan travels there, so the outline's latch moves once rather
  // than stepping through every heading the travel passes. A heading the travel cannot
  // bring to the reading zone lets go after twice the travel's duration, which leaves room
  // for a travel that starts a few frames after the jump.
  let latchJump = $state<number | null>(null);
  let latchTimer: ReturnType<typeof setTimeout> | undefined;
  const latchedLine = $derived(latchJump ?? activeLine);
  function latchHeading(line: number | null): void {
    clearTimeout(latchTimer);
    latchJump = line;
    latchTimer = setTimeout(() => (latchJump = null), 2 * SCROLL_ANIM_MS);
  }
  $effect(() => {
    if (latchJump !== null && activeLine === latchJump) latchJump = null;
  });
  $effect(() => () => clearTimeout(latchTimer));
  // The scroll container (the .diff-plan element), used by the heading tracking to
  // read the topmost visible line.
  let scrollEl = $state<HTMLElement | undefined>();
  // Opens the breadcrumbs bar's trailing crumb, handed over by the bar itself
  // (EXC-947). Undefined until the bar first mounts, and it keeps the last closure
  // afterwards — entering compare unmounts the bar without clearing this. What makes
  // `b` inert there is the binding's own headingTracking guard; the closure would
  // no-op anyway, since it reads a `barEl` the unmount set back to null.
  let openHeadingNav: (() => void) | undefined;

  // The plan's keyboard surface (EXC-875): the vim line cursor (EXC-788), visual
  // line-select (EXC-790), and the `/` full-text search HUD (EXC-832) in one
  // unit-testable factory (state/planKeyboard). The component owns the reactive store —
  // the runes live here — and the factory sequences the transitions over it. The store
  // is shared with the preview cursor (state/previewCursor), which keeps `cursorLine`
  // and adds `cursorPoint` and `visualAnchorPoint`; no cursor on compare. The DOM
  // effects are injected: the rendered lines, heading lines, the reading position, the
  // half-page size, scroll-follow, the match space and its landing, the shared jump, the
  // composer open, and focus/blur.
  let keyboardStore = $state<PlanKeyboardStore & PreviewCursorStore>({
    cursorLine: null,
    cursorPoint: null,
    visualAnchor: null,
    visualAnchorPoint: null,
    searchOpen: false,
    searchCommitted: false,
    searchQuery: "",
    searchIndex: -1,
    lastQuery: "",
    searchClosing: false,
  });
  const keyboard = createPlanKeyboard(keyboardStore, {
    lines: () => linkLayer.text.split("\n"),
    headingLines: () => headings.map((h) => h.line),
    readingLine: () => topVisibleLine(),
    halfPage: cursorHalfPage,
    follow: (line) => api?.followCursorLine(line),
    matchesFor: (query) =>
      surface === "preview"
        ? (previewSearch?.find(query) ?? [])
        : findMatches(linkLayer.text.split("\n"), query),
    followMatch: (m) => {
      if (surface !== "preview") {
        api?.followCursorLine(m.line);
        return;
      }
      if (previewEl && previewSourceMap) openMatchDetails(previewEl, previewSourceMap, m);
      previewCursor.placeAt({ line: m.line, column: m.startCol });
    },
    jump: (line) => api?.scrollToLine(line),
    openComposer: openRange,
    focusField: focusSearchField,
    blur: () => (document.activeElement as HTMLElement | null)?.blur(),
    sound: sound.play,
  });

  type PreviewGeometry = { root: Element; scroller: HTMLElement; map: PlanSourceMap };
  function previewGeometry(): PreviewGeometry | null {
    const root = previewEl;
    const scroller = scrollEl;
    const map = previewSourceMap;
    return root == null || scroller == null || map == null ? null : { root, scroller, map };
  }

  function previewHalfPage(): number {
    const lineHeight = previewEl ? Number.parseFloat(getComputedStyle(previewEl).lineHeight) : NaN;
    if (scrollEl == null || !(lineHeight > 0)) return 10;
    return Math.max(1, Math.floor(scrollEl.clientHeight / 2 / lineHeight));
  }

  const planLineCount = $derived(lineCountOf(linkLayer.text.split("\n")));

  // The outline's peek: a section copied from the live view the first time a row shows it,
  // and kept until what the view draws could have changed. Each such change makes a new
  // `peekSnippet`, which an open peek copies again from. A section the view has yet to
  // draw is not kept, so the next ask copies it afresh.
  let peekTarget = $state<PeekTarget | null>(null);
  let previewHighlightRev = $state(0);
  const peekSnippet = $derived.by(() => {
    void [surface, contentKey, themeId, reflowedBlocks, previewLayoutRev, previewHighlightRev];
    const copies = new Map<number, HTMLElement>();
    return (line: number): HTMLElement | null => {
      const copy = copies.get(line) ?? copySection(line);
      if (copy !== null) copies.set(line, copy);
      return copy;
    };
  });
  // The view flip keeps an open peek, which swaps in the other view's copy.
  const FLIP_CHORDS =
    CANONICAL_KEYMAP.find((entry) => entry.id === "actions.togglePreview")?.keys ?? [];
  function flipsView(e: KeyboardEvent): boolean {
    return (
      !showDiff &&
      !defaultIsEditingContext() &&
      FLIP_CHORDS.some((chord) => chordMatches(chord, e))
    );
  }
  function copySection(line: number): HTMLElement | null {
    const lines = sectionLines(headings, line, linkLayer.text.split("\n"));
    if (lines === null || !runs("outlinePeek")) return null;
    if (surface === "preview") return previewEl ? previewSnippet(previewEl, lines) : null;
    return host ? sourceSnippet(host, lines) : null;
  }
  const previewCursor = createPreviewCursor(keyboardStore, {
    lines: () => linkLayer.text.split("\n"),
    headingLines: () => headings.map((h) => h.line),
    halfPage: previewHalfPage,
    seed: () => {
      const geometry = previewGeometry();
      return (
        geometry &&
        readingPoint(geometry.root, geometry.map, geometry.scroller.getBoundingClientRect().top)
      );
    },
    step: (from, count) => {
      const geometry = previewGeometry();
      return geometry ? stepVisualLine(geometry.root, geometry.map, from, count) : from;
    },
    pointForLine: (line) => {
      const map = previewSourceMap;
      return map && pointForLine(map, line, planLineCount);
    },
    last: () => {
      const geometry = previewGeometry();
      return geometry && lastVisualLine(geometry.root, geometry.map);
    },
    follow: (p) => {
      const geometry = previewGeometry();
      const box = geometry && visualLineBox(geometry.root, geometry.map, p);
      if (geometry && box) followBox(geometry.scroller, box);
    },
    jump: (p) => {
      const block = previewBlock(p.line);
      if (previewEl && block) scrollRowIntoView(previewEl, block);
    },
    selection: (from, to) => {
      const geometry = previewGeometry();
      return geometry && visualLineRange(geometry.root, geometry.map, from, to);
    },
    comment: commentOnPreview,
    sound: sound.play,
  });

  // The band on screen and the point it marks. A step glides it, as the pointer glides
  // the hover; a layout bump lands it.
  let previewCursorBox = $state.raw<({ point: TextPoint; glide: boolean } & BandBox) | null>(
    null,
  );
  let cursorLayout = -1;
  $effect(() => {
    const rev = previewLayoutRev;
    const p = runs("keyboardCursor") && surface === "preview" ? previewCursor.point() : null;
    const map = p && previewSourceMap;
    const previous = untrack(() => previewCursorBox);
    const sameLayout = rev === cursorLayout;
    cursorLayout = rev;
    if (p == null || map == null || scrollEl == null || previewEl == null) {
      previewCursorBox = null;
      return;
    }
    const band = cursorBand(previewEl, scrollEl, map, p, lineHeightOf(previewEl));
    const glide =
      sameLayout && previous !== null && glidesFrom(previewEl, map, previous.point, p);
    previewCursorBox = band && { point: p, glide, ...band };
  });

  // Shift held: a press on either surface selects text rather than rows, so the pointer
  // shows the text cursor.
  let selectingText = $state(false);
  $effect(() => {
    const track = (event: KeyboardEvent) => (selectingText = event.shiftKey);
    const reset = () => (selectingText = false);
    window.addEventListener("keydown", track);
    window.addEventListener("keyup", track);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", track);
      window.removeEventListener("keyup", track);
      window.removeEventListener("blur", reset);
    };
  });

  // The pointer over the preview, for the hover band over the visual line under it, the
  // "+" beside that line, and a comment drag's band over the rows its release cites.
  // rAF-throttled like the source view's [data-hovered], re-read under a still pointer on
  // scroll, and cleared when the pointer leaves the plan. Only a move glides the bands; a
  // scroll, press or release lands them in place.
  type PreviewPointer = { x: number; y: number; pressed: boolean; glide: boolean };
  let pointer = $state.raw<PreviewPointer | null>(null);
  let plusEl = $state<HTMLButtonElement | undefined>();
  $effect(() => {
    const scroller = scrollEl;
    if (scroller == null || surface !== "preview" || !runs("textComments")) return;
    let raf = 0;
    let at: PreviewPointer | null = null;
    const schedule = () => {
      if (raf === 0)
        raf = requestAnimationFrame(() => {
          raf = 0;
          pointer = at;
        });
    };
    // On window, so a drag that leaves the plan keeps its band.
    const onPointer = (event: PointerEvent) => {
      // Pressing the "+" keeps its line hovered until the click lands.
      const onPlus = event.target instanceof Node && plusEl?.contains(event.target) === true;
      if (event.type === "pointerdown" && onPlus) return;
      const { clientX: x, clientY: y, buttons, type } = event;
      at = { x, y, pressed: buttons !== 0, glide: type === "pointermove" };
      schedule();
    };
    const onScroll = () => {
      if (at === null) return;
      at = { ...at, glide: false };
      schedule();
    };
    const onLeave = (event: PointerEvent) => {
      if (event.buttons !== 0) return;
      at = null;
      schedule();
    };
    const events = ["pointermove", "pointerdown", "pointerup", "pointercancel"] as const;
    for (const type of events) window.addEventListener(type, onPointer, { passive: true });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("pointerleave", onLeave, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      pointer = null;
      for (const type of events) window.removeEventListener(type, onPointer);
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("pointerleave", onLeave);
    };
  });

  function previewRowAt(y: number): TextPoint | null {
    const geometry = previewGeometry();
    return geometry && rowAt(geometry.root, geometry.map, y);
  }

  const lineHeightOf = (el: Element) => Number.parseFloat(getComputedStyle(el).lineHeight);

  type PreviewHover = {
    row: TextPoint;
    band: BandBox;
    /** The "+"'s lane: the preview's left padding. */
    plus: { left: number; width: number };
    glide: boolean;
  };
  let hover = $state.raw<PreviewHover | null>(null);
  let hoverLayout = -1;
  $effect(() => {
    const rev = previewLayoutRev;
    const at = pointer;
    const geometry = previewGeometry();
    const previous = untrack(() => hover);
    hover =
      at && !at.pressed && geometry
        ? hoverAt(geometry, at, previous, rev === hoverLayout)
        : null;
    hoverLayout = rev;
  });

  /** The hover a still pointer `at` shows: over the preview root's text and padding, and
   * over the "+", which keeps its line; not over a slot or the code chrome. */
  function hoverAt(
    geometry: PreviewGeometry,
    at: PreviewPointer,
    previous: PreviewHover | null,
    sameLayout: boolean,
  ): PreviewHover | null {
    const target = document.elementFromPoint(at.x, at.y);
    const onPlus = target !== null && plusEl?.contains(target) === true;
    if (!onPlus && (target === null || !geometry.root.contains(target))) return null;
    const row = onPlus ? previous?.row : rowAt(geometry.root, geometry.map, at.y);
    return row ? rowHover(geometry, row, previous, at.glide && sameLayout) : null;
  }

  /** Whether a band moving from `from`'s row to `to`'s glides: a flick or a jump of more
   * than two rows lands in place, as gliding that far would trail the pointer or key. */
  const glidesFrom = (root: Element, map: PlanSourceMap, from: TextPoint, to: TextPoint) =>
    withinLines(root, map, from, to, 2);

  /** The hover over `row`, gliding from `previous` when `glide` allows and the two are near. */
  function rowHover(
    { root, scroller, map }: PreviewGeometry,
    row: TextPoint,
    previous: PreviewHover | null,
    glide: boolean,
  ): PreviewHover | null {
    const band = cursorBand(root, scroller, map, row, lineHeightOf(root));
    if (!band) return null;
    return {
      row,
      band,
      plus: laneBeside({ root }, band),
      glide: glide && previous !== null && glidesFrom(root, map, previous.row, row),
    };
  }

  function laneBeside(
    { root }: Pick<PreviewGeometry, "root">,
    band: BandBox,
  ): PreviewHover["plus"] {
    return {
      left: band.left,
      width: Number.parseFloat(getComputedStyle(root).paddingInlineStart),
    };
  }

  // The keyboard cursor's band wins its own line, as [data-caret-cursor] does in source.
  const hoverBandShown = $derived(
    hover != null &&
      (previewCursorBox == null || Math.abs(hover.band.top - previewCursorBox.top) > 1),
  );

  /** A comment drag: one band over the rows from its press's through the pointer's, and the
   * hover over the pointer's row, whose "+" rides with it as the source gutter's does. */
  type PreviewDrag = { band: BandBox; end: PreviewHover };
  let dragAnchor = $state.raw<TextPoint | null>(null);
  let drag = $state.raw<PreviewDrag | null>(null);
  let dragLayout = -1;
  $effect(() => {
    const rev = previewLayoutRev;
    const anchor = dragAnchor;
    const at = pointer;
    const geometry = previewGeometry();
    const previous = untrack(() => drag?.end ?? null);
    drag =
      anchor && at && geometry ? dragAt(geometry, anchor, at, previous, rev === dragLayout) : null;
    dragLayout = rev;
  });

  function dragAt(
    geometry: PreviewGeometry,
    anchor: TextPoint,
    at: PreviewPointer,
    previous: PreviewHover | null,
    sameLayout: boolean,
  ): PreviewDrag | null {
    const { root, scroller, map } = geometry;
    const row = rowAt(root, map, at.y);
    const end = row && rowHover(geometry, row, previous, at.glide && sameLayout);
    const start = cursorBand(root, scroller, map, anchor, lineHeightOf(root));
    if (!end || !start) return null;
    return { band: spanBands(start, end.band), end };
  }

  /** Visual mode banded as a drag is: from the anchor's row through the cursor's, which
   * carries the "+" and glides as the cursor does. An open composer hides it, as the
   * source's `selectedRange` does. */
  let visual = $state.raw<PreviewDrag | null>(null);
  $effect(() => {
    void previewLayoutRev;
    const cursor = previewCursorBox;
    const anchor =
      cursor && runs("keyboardComments") && pending == null ? previewCursor.anchor() : null;
    const geometry = previewGeometry();
    visual = anchor && cursor && geometry ? visualAt(geometry, anchor, cursor) : null;
  });

  function visualAt(
    geometry: PreviewGeometry,
    anchor: TextPoint,
    cursor: NonNullable<typeof previewCursorBox>,
  ): PreviewDrag | null {
    const { root, scroller, map } = geometry;
    const start = cursorBand(root, scroller, map, anchor, lineHeightOf(root));
    if (!start) return null;
    const end = {
      row: cursor.point,
      band: cursor,
      plus: laneBeside(geometry, cursor),
      glide: cursor.glide,
    };
    return { band: spanBands(start, cursor), end };
  }
  const plusAt = $derived(drag?.end ?? visual?.end ?? hover);

  /** The rows a comment cites, banded, with the source gutter's selection bar down the "+"
   * lane: a drag's while it runs, then the open composer's while it drafts, else visual
   * mode's, as the source view's `selectedRange` holds its lines. */
  type CitedRows = { band: BandBox; lane: PreviewHover["plus"]; glide: boolean };
  let draftRows = $state.raw<CitedRows | null>(null);
  $effect(() => {
    void previewLayoutRev;
    const geometry = previewGeometry();
    draftRows = geometry && pending ? rowsOfLines(geometry, spanOf(pending)) : null;
  });

  function rowsOfLines(geometry: PreviewGeometry, lines: SourceSpan): CitedRows | null {
    const { root, scroller, map } = geometry;
    const band = linesBand(root, scroller, map, lines, lineHeightOf(root));
    return band && { band, lane: laneBeside(geometry, band), glide: false };
  }
  const rowsOf = (d: PreviewDrag): CitedRows => ({
    band: d.band,
    lane: d.end.plus,
    glide: d.end.glide,
  });
  const citedRows = $derived<CitedRows | null>(
    drag ? rowsOf(drag) : (draftRows ?? (visual && rowsOf(visual))),
  );

  // The live visual selection, ascending — mirrored into SourceView's amber band through
  // `selectedRange` while visual mode is active, so extending it with j/k grows the
  // highlight in step.
  const visualSelection = $derived(
    keyboardStore.visualAnchor != null && keyboardStore.cursorLine != null
      ? normalizeRange({ start: keyboardStore.visualAnchor, end: keyboardStore.cursorLine })
      : undefined,
  );

  // Matches for the current query over the text the surface shows — linkLayer.text on the
  // source, the rendered text on the preview. Either way a match's line is a source line,
  // so the pill counter, the highlight, and the cursor jump all share it.
  const searchMatches = $derived(keyboard.matches());

  // Matches hold a source line and columns; ranges are rebuilt through the map on each
  // previewLayoutRev bump, since the highlighter's text-node swap collapses painted ones.
  $effect(() => {
    void previewLayoutRev;
    const map = previewSourceMap;
    const root = previewEl;
    const matches = searchMatches;
    if (!runs("search") || surface !== "preview" || !map || !root || matches.length === 0) return;
    paintPreviewSearch(previewMatchRanges(root, map, matches), keyboardStore.searchIndex);
    return clearPreviewSearch;
  });

  // A flip swaps the match space under the live index (the source misses a wrapped
  // phrase, the preview a URL), so re-seat it at the cursor. The map read re-runs this
  // once the preview root has mounted and its matches exist. The effect below covers an
  // uncommitted query; this one covers the committed HUD.
  $effect(() => {
    void surface;
    void previewSourceMap;
    untrack(() => {
      if (runs("search") && keyboardStore.searchOpen) keyboard.retrackToNearest();
    });
  });

  // Re-track the current match to the nearest one at the reading position whenever the
  // QUERY changes while the field is being edited (search open, not yet committed) — so
  // the counter and the strong highlight follow the query live as you type or reopen.
  // Gated on !searchCommitted so a resume seed (n/N with the pill closed sets the query
  // AND commits) is not clobbered back to "nearest"; the seed (cursor / reading position)
  // is read UNTRACKED so a same-query n/N step never re-runs this.
  $effect(() => {
    void searchMatches;
    if (!runs("search") || !keyboardStore.searchOpen || keyboardStore.searchCommitted) return;
    untrack(() => keyboard.retrackToNearest());
  });

  // Drop the cursor, any visual selection, and the live search when the rendered content
  // changes (a new version or a review switch) so a later motion never steps from a line
  // that belonged to the prior plan. contentKey short-circuits on an unchanged poll tick,
  // so this fires only on a real switch, not every 2s poll re-delivering the same
  // version. The remembered query (lastQuery) is kept so a later `/` can still resume it.
  $effect(() => {
    void contentKey;
    keyboard.clearForContentSwitch();
    previewCursor.reset();
  });

  // Recompute the active heading from the source line at the top of the reading
  // zone, throttled with rAF so a scroll burst settles into one read. The view
  // paints each line as <div data-line="N"> in a shadow root; lineAtReadingZone
  // picks the line sitting at the same offset jumps park headings at, so the
  // tracked section matches where a crumb jump lands rather than the heading above it.
  // The preview reads its block at the same zone instead.
  function topVisibleLine(): number | null {
    if (surface === "preview") {
      return scrollEl && previewEl && planPreview
        ? previewTopLine(scrollEl.getBoundingClientRect().top, previewEl, planPreview.blocks)
        : null;
    }
    const rows = scrollEl?.querySelector(".diffview")?.shadowRoot?.querySelectorAll<HTMLElement>(
      "[data-line]",
    );
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
    // Reading the surface re-arms (and re-seeds) tracking on the way back to source.
    if (!runs("headingTracking")) return;
    const el = scrollEl;
    if (!el) return;
    // depend on the heading set so tracking re-arms after a version change
    void headings;
    let raf = 0;
    // Returns whether the view had painted rows to measure.
    const update = () => {
      const top = topVisibleLine();
      if (top != null) activeLine = activeHeadingLine(headings, top);
      return top != null;
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Seed the tracked heading at load rather than leaving it null until the
    // first scroll, so a plan nobody has scrolled yet still reads as a location
    // (the breadcrumbs bar has no trail without it).
    const stopSeed = retryFrames(update);
    return () => {
      cancelAnimationFrame(raf);
      stopSeed();
      el.removeEventListener("scroll", onScroll);
    };
  });

  // Whether text lies below the pane's foot, for the lip's bottom shade. Its own listener,
  // as the heading tracking above doesn't run on compare. Rows paint after mount without
  // resizing the scroller, so its children are observed too, afresh for each surface and
  // content.
  let paneMoreBelow = $state(false);
  $effect(() => {
    const el = scrollEl;
    if (!el) return;
    void surface;
    void contentKey;
    void diffContentKey;
    const update = () => {
      paneMoreBelow = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    };
    const resize = new ResizeObserver(update);
    for (const box of [el, ...el.children]) resize.observe(box);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      resize.disconnect();
      el.removeEventListener("scroll", update);
    };
  });

  // ----- Keyboard line cursor + vim motion (EXC-788) -----
  // Each reserved motion binding (keymap.ts) maps to a cursor motion; registering
  // with the SAME id upgrades the display-only reservation to a live entry, so the
  // help modal shows the keys and the global dispatcher fires them.
  const CURSOR_MOTIONS: Record<string, CursorMotion> = {
    "motion.down": "down",
    "motion.up": "up",
    "motion.halfPageDown": "halfDown",
    "motion.halfPageUp": "halfUp",
    "motion.top": "top",
    "motion.bottom": "bottom",
    "motion.nextHeading": "nextHeading",
    "motion.prevHeading": "prevHeading",
    "motion.nextBlank": "nextBlank",
    "motion.prevBlank": "prevBlank",
  };

  // Half-page size from the scroller height over a rendered row's height, with a
  // constant fallback before the view paints. Injected into the keyboard factory as its
  // halfPage dep and measured per motion — cheap at keyboard cadence.
  function cursorHalfPage(): number {
    const rowH =
      scrollEl
        ?.querySelector(".diffview")
        ?.shadowRoot?.querySelector<HTMLElement>("[data-line]")
        ?.getBoundingClientRect().height ?? 0;
    if (scrollEl == null || rowH <= 0) return 10;
    return Math.max(1, Math.floor(scrollEl.clientHeight / rowH / 2));
  }

  // ----- Plan search field focus (EXC-832) -----
  // `/` reopens the search with the last committed query selected, so typing replaces it.
  // PlanSearch focuses its field whenever it mounts; this covers `/` over a field that is
  // mounted but blurred, and waits a tick so it selects the prefilled value.
  async function focusSearchField(): Promise<void> {
    await tick();
    const el = document.querySelector<HTMLInputElement>("input[aria-label='Search plan']");
    el?.focus();
    el?.select();
  }
  // Clear a pending close timer if the view unmounts mid-collapse — the factory owns the
  // timer, and cancelClose tears it down.
  $effect(() => () => keyboard.cancelClose());

  // Register the live motion shortcuts on the keyboardCursor surfaces, driving the
  // surface's own cursor; teardown unregisters them, so motion is gone elsewhere.
  // Depends only on the surface — the closures read cursorLine/headings/api live at
  // dispatch, so a cursor move never re-runs this effect (which would churn the registry).
  // Ctrl+d/Ctrl+u are non-bare, so the dispatcher does not suppress them in an
  // editing context; the enabled guard does, so half-page motions don't fire while
  // the composer is focused.
  $effect(() => {
    if (!runs("keyboardCursor")) return;
    const move = surface === "preview" ? previewCursor.moveCursor : keyboard.moveCursor;
    const offs: Array<() => void> = [];
    for (const [id, motion] of Object.entries(CURSOR_MOTIONS)) {
      offs.push(
        shortcuts.register(
          bind(id, {
            run: () => {
              move(motion);
              if (motion === "nextHeading" || motion === "prevHeading") {
                latchHeading(keyboardStore.cursorLine);
              }
            },
            enabled: () => !defaultIsEditingContext(),
          }),
        ),
      );
    }
    return () => {
      for (const off of offs) off();
    };
  });

  $effect(() => {
    if (!runs("keyboardComments")) return;
    const onPreview = surface === "preview";
    const comment = onPreview ? previewCursor.comment : keyboard.commentCursorLine;
    const enterVisualMode = onPreview ? previewCursor.enterVisualMode : keyboard.enterVisualMode;
    const offs: Array<() => void> = [];
    // Commenting on the focused line / a keyboard-selected range (EXC-790): live entries
    // bound over EXC-786's reservations, with the motions' editing-context guard. c
    // comments the cursor line — on the preview, the cursor's visual line — or, in visual
    // mode, the whole selection; V enters visual line-select.
    offs.push(
      shortcuts.register(
        bind("commenting.comment", {
          run: () => comment(),
          enabled: () => !defaultIsEditingContext(),
        }),
      ),
    );
    offs.push(
      shortcuts.register(
        bind("commenting.visualLine", {
          run: () => enterVisualMode(),
          enabled: () => !defaultIsEditingContext(),
        }),
      ),
    );
    return () => {
      for (const off of offs) off();
    };
  });

  // Esc closes search / exits visual mode but never clears the line cursor (EXC-834,
  // narrowing EXC-790's Esc reconciliation). Gated on something to clear so Esc neither
  // shadows other Esc handlers nor preventDefaults with nothing to do; a focused editor
  // keeps Esc regardless (the dispatcher suppresses bare keys in an editing context).
  $effect(() => {
    if (!runs("search") && !runs("keyboardComments")) return;
    return shortcuts.register(
      bind("commenting.clear", {
        run: () => keyboard.clearSelectionOrCursor(),
        enabled: () => keyboardStore.searchOpen || keyboardStore.visualAnchor != null,
      }),
    );
  });

  // Mirror the active heading's slug into `?heading=` so a copied URL reopens the
  // review at the section being read (composing with deepLink.ts's `?review=`).
  // A surface off the headingTracking row tracks no heading (and drops
  // the breadcrumbs bar), so the param clears there.
  // Held until restore consumes any incoming `?heading=` (see `restored`).
  $effect(() => {
    if (!restored) return;
    const slug = activeLine != null ? slugForLine(headings, activeLine) : null;
    setHeadingSlug(runs("headingTracking") ? slug : null);
  });

  // The compare-toggle, preview-toggle + plan-search shortcuts, live entries over EXC-786's
  // reservations. Registered while the single-version view is mounted (i.e. an active
  // review), so they no-op with no review; the enabled guards mirror each control's
  // own availability — `d` toggles compare only when there are versions to compare,
  // `p` flips the view only off compare, where its button shows,
  // `/` opens search only on the search surfaces, and n/N cycle only while a
  // search is committed. Mount-once: the closures read compareStore/surface/search*
  // live at dispatch, so a version or view change never churns the registry.
  $effect(() => {
    const offs: Array<() => void> = [];
    offs.push(
      shortcuts.register(
        bind("actions.toggleDiff", {
          run: () => setComparing(!compareStore.comparing),
          enabled: () => canCompare,
        }),
      ),
    );
    offs.push(
      shortcuts.register(
        bind("actions.togglePreview", { run: togglePlanView, enabled: () => !showDiff }),
      ),
    );
    // `/` opens the plan search (EXC-832). Plan-content only; not gated on the plan
    // having headings — search is over text, not structure.
    offs.push(
      shortcuts.register(
        bind("actions.search", {
          run: () => keyboard.openSearch(),
          enabled: () => runs("search"),
        }),
      ),
    );
    // n / N cycle matches, live while a search is committed (the field is blurred
    // then, so these bare keys reach the global dispatcher) OR when a remembered query
    // exists so they can RESUME a closed search from the cursor. Single-version only,
    // and never while an editor is focused.
    offs.push(
      shortcuts.register(
        bind("actions.searchNext", {
          run: () => keyboard.stepSearch(1),
          enabled: () =>
            runs("search") &&
            !defaultIsEditingContext() &&
            (keyboardStore.searchCommitted || keyboardStore.lastQuery !== ""),
        }),
      ),
    );
    offs.push(
      shortcuts.register(
        bind("actions.searchPrev", {
          run: () => keyboard.stepSearch(-1),
          enabled: () =>
            runs("search") &&
            !defaultIsEditingContext() &&
            (keyboardStore.searchCommitted || keyboardStore.lastQuery !== ""),
        }),
      ),
    );
    // The heading surfaces' keys: `b` opens the breadcrumbs bar's trailing crumb
    // (EXC-947), gated on the headingTracking row the bar renders behind; `\` opens the
    // outline's filter and Shift+\ shows or hides the outline, wherever the outline
    // stands. The optional call covers a first render off the headingTracking row, where
    // the bar has not handed an open action back yet.
    offs.push(
      shortcuts.register(
        bind("actions.headingNav", {
          run: () => openHeadingNav?.(),
          enabled: () => runs("headingTracking"),
        }),
      ),
    );
    offs.push(
      shortcuts.register(bind("actions.contents", { run: filterOutline, enabled: () => outlineRuns })),
    );
    offs.push(
      shortcuts.register(
        bind("actions.toggleOutline", { run: toggleOutline, enabled: () => outlineRuns && !narrow }),
      ),
    );
    return () => {
      for (const off of offs) off();
    };
  });

  // The `commenting` controller, its pending / pendingText / scratches mirrors, and
  // the scratches→autosave persistence all live in App (EXC-877); this view receives
  // the controller and the three mirrors as props and simply operates the controller.

  // The open composer's live text, reported by SourceComposer.onInput. Held here
  // so opening a different range (gutter +, a line click, a Resume marker) first
  // retains the in-progress text as a scratch instead of dropping it on the floor.
  let liveText = "";
  function openRange(start: number, end: number): void {
    commenting.cancel(liveText); // retain any in-progress text; no-op when closed
    commenting.open({ start, end });
    keyboardStore.cursorLine = end; // a line click relocates the cursor (keyboard + mouse coherent)
  }
  function commentOnPreview(range: Range): void {
    const lines = previewSourceMap?.linesOf(range);
    if (lines) openRange(lines.start, lines.end);
  }
  // A mouse comment cites every source line with text on the rows it covers, as `c` and
  // `V` do over the same rows.
  function commentOnRows(from: TextPoint, to: TextPoint): void {
    const geometry = previewGeometry();
    const range = geometry && visualLineRange(geometry.root, geometry.map, from, to);
    if (range) commentOnPreview(range);
  }
  // Each surface hosts its own composer, so a flip would remount it with its typed text
  // lost: retain the text as a scratch first, which the approve guard still counts.
  function setPlanView(next: PlanView): void {
    releasePlace();
    if (next !== planView) {
      commenting.cancel(liveText);
      capturePlace();
      // The surfaces select different units — source lines against visual lines — so a
      // carried selection would silently change its extent.
      keyboardStore.visualAnchor = null;
      viewFlipped = true;
    }
    planView = next;
    writePlanView(next);
  }
  function togglePlanView(): void {
    setPlanView(planView === "preview" ? "source" : "preview");
  }
  function resumeScratch(key: string): void {
    commenting.cancel(liveText); // retain the open composer's text before switching
    commenting.resume(key);
  }

  // Reseed the controller's scratches from the review's persisted set whenever the
  // rendered content changes (a new version arrives, or the review switches) and on
  // first mount, so a reload restores the reviewer's "Resume" markers. A fresh
  // version is served with none of its own, so this doubles as the wipe that keeps
  // a scratch from mis-anchoring onto text it was not written against. contentKey
  // is the reactive trigger; review.composerScratches is read untracked so a poll
  // tick re-delivering the same id:version (a new array reference) never re-seeds
  // over live typing.
  $effect(() => {
    void contentKey;
    untrack(() => commenting.seed(review.composerScratches));
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
    if (runs("lineComments") && !hintDismissed) hintVisible = true;
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

  // The live range readout, driving both the mouse-drag preview and the keyboard
  // visual-select span (EXC-790): whichever is active, "Lines X–Y" is announced
  // through the aria-live rail below, so a keyboard reviewer hears the selection
  // grow as j/k extend it — parity with the drag path. Suppressed once the composer
  // opens (its own label takes over) so the readout and composer never stack.
  const rangeReadout = $derived.by(() => {
    if (pending != null) return undefined;
    const range = visualSelection ?? dragRange;
    return range ? rangeLabel(range.startLine, range.endLine) : undefined;
  });

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

<!-- The plan's body row: the outline column, when it stands, then the surface the plan
     and the file drawer divide between them. -->
<div
  class="plan-body"
  class:column-leaving={columnLeaving && !columnShown}
  bind:this={bodyEl}
  bind:clientWidth={bodyWidth}
>
  {#if columnShown || columnLeaving}
    <aside
      class="plan-outline"
      class:leaving={!columnShown}
      class:key-arriving={keyEntry !== null}
      inert={!columnShown}
      aria-label="Outline"
      style:width="{columnWidth}px"
      bind:this={outlineEl}
    >
      {@render outlineList("column")}
      <Splitter
        label="Resize outline"
        grows="right"
        size={columnWidth}
        min={columnBounds.min}
        max={columnBounds.max}
        onResize={setColumnWidth}
        onReset={() => setColumnWidth(null)}
      />
    </aside>
  {/if}
<div
  class="diff-surface"
  class:dock-bottom={drawerEdge === "bottom"}
  class:beside-outline={columnShown}
  bind:this={surfaceEl}
  bind:clientWidth={surfaceWidth}
  bind:clientHeight={surfaceHeight}
>
  <div
    class="plan-pane"
    bind:this={paneEl}
    data-surface={surface}
    data-more-below={paneMoreBelow || undefined}
  >
    <span class="pane-floor" aria-hidden="true" bind:this={floorEl}></span>
    <!-- The plan's header, stuck to the pane's top edge above the scroller: the outline
         key while the column is not shown, the crumb slot, then the view keys, all in one
         bed. While comparing, the compare controls take the crumbs' place. -->
    <div
      class="plan-header"
      class:comparing={showDiff}
      class:searching={keyboardStore.searchOpen}
    >
      <span class="header-bed" aria-hidden="true" bind:this={bedEl}></span>
      {#if outlineRuns && narrow}
        <span class="float-anchor" aria-hidden="true" bind:this={floatAnchor}></span>
      {:else if outlineRuns && !columnShown}
        <span class="tray header-tray" bind:this={headerWellEl}>
          <!-- Its name holds whatever the state, as ARIA's toggle pattern asks; it reports
               the column, which is hidden while the key stands here. -->
          <Button
            variant="secondary"
            size={showShortcutHints ? "sm" : "icon-sm"}
            class="outline-key float-chip"
            bind:ref={outlineKey}
            aria-label="Outline"
            aria-pressed="false"
            aria-keyshortcuts={ariaKeyshortcutsFor("actions.toggleOutline")}
            onkeydown={(e: KeyboardEvent) => (outlineKeySpace = e.key === " ")}
            onclick={clickOutlineKey}
          >
            <Icon name="panel-left" size={14} />
            {#if showShortcutHints}
              <Kbd class="kbd-sm" aria-hidden="true"><KbdCap key="shift" /><KbdCap key={"\\"} /></Kbd>
            {/if}
          </Button>
        </span>
      {/if}
      {#if !showDiff}
        <!-- The crumbs, the Search entry at the slot's end, and the find row that slides
             open from it over them. The slot clips at its end, so the row comes out of the
             entry; the crumbs keep their box under it, so their collapse measure holds
             still, and fade back in as it tucks away. -->
        <div
          class="crumb-slot"
          bind:this={crumbSlotEl}
          data-covered={keyboardStore.searchOpen && !keyboardStore.searchClosing ? "" : undefined}
        >
          <!-- Heading breadcrumbs (EXC-946): where in the plan the reviewer is, and the
               menus to move sideways or deeper. It rides the activeLine the scroll
               observer below tracks and jumps through `pickHeading`. Off the
               headingTracking row no heading is tracked (and `?heading=` clears), so the
               bar is dropped there rather than left showing a stale trail. -->
          {#if runs("headingTracking")}
            <PlanBreadcrumbs
              {headings}
              {activeLine}
              {showShortcutHints}
              onJump={pickHeading}
              onExposeOpen={(open) => (openHeadingNav = open)}
            />
          {/if}
          {#if runs("search")}
            <!-- Named apart from its word, which a tight header drops. -->
            <button
              type="button"
              class="search-entry"
              aria-label="Search"
              aria-keyshortcuts={ariaKeyshortcutsFor("actions.search")}
              onclick={() => keyboard.openSearch()}
            >
              <Icon name="search" size={14} />
              <span class="search-word">Search</span>
              {#if showShortcutHints}
                <Kbd class="kbd-sm" aria-hidden="true">/</Kbd>
              {/if}
            </button>
            {#if keyboardStore.searchOpen}
              <PlanSearch
                hints={showShortcutHints}
                bind:query={keyboardStore.searchQuery}
                matchCount={searchMatches.length}
                currentIndex={keyboardStore.searchIndex}
                committed={keyboardStore.searchCommitted}
                closing={keyboardStore.searchClosing}
                oncommit={() => keyboard.commitSearch()}
                onnext={() => keyboard.stepSearch(1)}
                onprev={() => keyboard.stepSearch(-1)}
                onclose={() => keyboard.closeSearch()}
              />
            {/if}
          {/if}
        </div>
      {/if}
      <!-- The plan's view keys. The version-compare picker is always shown; its toggle
           disables itself when there are no other versions to compare (EXC-664). -->
      <VersionComparePicker
        versions={review.versions}
        comparing={compareStore.comparing}
        {canCompare}
        baseVersion={compareStore.baseVersion}
        targetVersion={compareStore.targetVersion}
        diffStyle={compareStore.diffStyle}
        diffIndicators={compareStore.diffIndicators}
        layoutLocked={narrow}
        {showShortcutHints}
        onSetComparing={setComparing}
        onSelectBase={compare.setBase}
        onSelectTarget={compare.setTarget}
        onSetDiffStyle={compare.setDiffStyle}
        onSetDiffIndicators={compare.setDiffIndicators}
      >
        {#snippet trailing()}
          <!-- The source / preview switch. Outside any branch on planView, so it keeps
               focus across a flip. -->
          {#if !showDiff}
            <Button
              variant="secondary"
              size="sm"
              class="preview-toggle float-chip"
              aria-pressed={planView === "preview"}
              aria-keyshortcuts={ariaKeyshortcutsFor("actions.togglePreview")}
              onclick={togglePlanView}
            >
              Preview
              {#if showShortcutHints}
                <Kbd class="kbd-sm" aria-hidden="true">p</Kbd>
              {/if}
            </Button>
          {/if}
        {/snippet}
      </VersionComparePicker>
    </div>
    <!-- The gutter composer is the source view only. The compare diff
         is a clean surface with no gutter and no inline annotations; the compared
         versions' comments read in the docked panel instead (EXC-872). -->
    <div
      class="diff-plan"
      data-view-flip={viewFlipped ? planView : undefined}
      style:--preview-font-size={previewFontSize}
      bind:this={scrollEl}
      onmouseenter={showDragHint}
      role="presentation"
    >
      <!-- The per-code-block chrome, keyed on the block's opening line so a re-anchor
           updates each box's props and leaves the instance — and its copied/checkmark
           state — alone. A snippet rendered in both branches below, not once after the
           {/if}, so it keeps its place in the source view's DOM order against the overlays
           that follow it. -->
      {#snippet codeChrome()}
        {#each chromeBoxes as chromeBox (chromeBox.start)}
          <CodeBlockChrome
            text={chromeBox.text}
            start={chromeBox.start}
            top={chromeBox.top}
            left={chromeBox.left}
            wrappable={chromeBox.wrappable}
            reflowed={reflowedBlocks.has(chromeBox.start)}
            hovered={hoveredBlockStart === chromeBox.start}
            onToggleReflow={() => toggleReflow(chromeBox.start)}
          />
        {/each}
      {/snippet}
      <!-- A line's comment items, rendered by both surfaces inside each one's own wrapper. -->
      {#snippet commentThread(annotations: LineAnnotation[])}
        <SourceAnnotationThread
          {annotations}
          {focusedAnnotation}
          onFocus={onFocusAnnotation}
          onEdit={onEditAnnotation}
          onDelete={onDeleteAnnotation}
          {reviewContext}
        />
      {/snippet}
      {#snippet openComposer(range: { startLine: number; endLine: number })}
        <SourceComposer
          startLine={range.startLine}
          endLine={range.endLine}
          initial={pendingText}
          {reviewContext}
          onInput={(text) => (liveText = text)}
          onSubmit={(comment) => commenting.submit(comment)}
          onKeep={(text) => commenting.cancel(text)}
          onDiscard={() => commenting.discardOpen(liveText)}
        />
      {/snippet}
      {#snippet draftMarker(scratch: ComposerScratch)}
        <SourceScratchMarker text={scratch.text} onResume={() => resumeScratch(scratch.key)} />
      {/snippet}
      <!-- Visual line-select affordance (EXC-790): while V mode is active, a quiet
           bottom-pinned chip names the two keys — c commits the selection to a
           comment, Esc cancels — rendered as shadcn Kbd keycaps. Shares the
           drag-hint's chip chrome; the selection's own highlight already shows the range. -->
      {#snippet visualHint()}
        {#if keyboardStore.visualAnchor != null && showShortcutHints}
          <div class="visual-hint" role="note">
            Selecting lines — <Kbd class="kbd-sm">c</Kbd> comment · <Kbd class="kbd-sm">Esc</Kbd> cancel
          </div>
        {/if}
      {/snippet}
      {#if showDiff}
        <!-- Compare mode: a diff between the selected version pair. Base is the
             reference version (the default base is the current version) and renders
             on the diff's "after" side; target is what it's compared against and
             renders on the "before" side — so the default current-vs-previous pair
             reads as the changes that produced the current version. Inline
             annotations and the gutter are deliberately omitted from this surface —
             the comments themselves list in the docked panel. The layout switches
             at runtime via the picker (no remount).

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
            diffStyle: effectiveDiffStyle,
            diffIndicators: compareStore.diffIndicators,
          }}
          onReady={(a) => (diffApi = a)}
        />
      {:else if planPreview}
        <PlanPreview
          html={planPreview.html}
          codeLanguages={planPreview.codeLanguages}
          {themeId}
          {reflowedBlocks}
          bind:root={previewEl}
          onHighlight={() => previewHighlightRev++}
          fileRefs={previewRefs}
          onFileRefClick={openFileRef}
          rowAt={previewRowAt}
          onTextComment={runs("textComments") ? commentOnRows : undefined}
          onCommentDrag={(anchor) => (dragAnchor = anchor)}
          selectText={selectingText}
        />
        <!-- Before the chrome and slots, which the cited rows' band runs under. -->
        {#if citedRows}
          <div
            class="preview-drag"
            data-caret-preview-drag
            data-glide={citedRows.glide ? "" : undefined}
            aria-hidden="true"
            style:top="{citedRows.band.top}px"
            style:left="{citedRows.band.left}px"
            style:width="{citedRows.band.width}px"
            style:height="{citedRows.band.height}px"
          ></div>
          <div
            class="preview-drag-bar"
            data-caret-preview-drag-bar
            data-glide={citedRows.glide ? "" : undefined}
            aria-hidden="true"
            style:top="{citedRows.band.top}px"
            style:left="{citedRows.lane.left}px"
            style:width="{citedRows.lane.width}px"
            style:height="{citedRows.band.height}px"
          ></div>
        {/if}
        {@render codeChrome()}
        <!-- Comment slots sit outside the preview root, which holds only the rendered HTML
             the source map and place-keeping index and the slots' empty gaps. -->
        {#each previewSlots as slot (slot.line)}
          {@const box = slotBoxes.get(slot.line)}
          <div
            class="preview-slot"
            role="group"
            aria-label={`Comments on line ${slot.items[0]?.line}`}
            data-preview-slot={slot.line}
            style:top={box ? `${box.top}px` : undefined}
            style:left={box ? `${box.left}px` : undefined}
            style:width={box ? `${box.width}px` : undefined}
            style:padding-inline={box ? `${box.padStart}px ${box.padEnd}px` : undefined}
            data-unmeasured={box ? undefined : ""}
            onpointerover={(e) => pointSlot(e.target)}
            onfocusin={(e) => focusSlot(e.target)}
            onpointerleave={() => (pointerSpan = null)}
            onfocusout={leaveSlotFocus}
          >
            {#each slot.items as item (item.kind === "marker" ? item.scratch.key : `${item.kind}:${item.line}`)}
              {#if item.kind === "thread"}
                <div data-slot-line={item.line} use:releasesSpans>
                  {@render commentThread(item.annotations)}
                </div>
              {:else if item.kind === "composer"}
                {#key `${item.start}:${item.line}`}
                  <div data-slot-line={item.line} data-span-start={item.start} use:releasesSpans>
                    {@render openComposer({ startLine: item.start, endLine: item.line })}
                  </div>
                {/key}
              {:else}
                <div data-slot-line={item.line} data-span-start={item.start} use:releasesSpans>
                  {@render draftMarker(item.scratch)}
                </div>
              {/if}
            {/each}
          </div>
        {/each}
        {#if previewCursorBox}
          <div
            class="preview-cursor"
            data-caret-preview-cursor
            data-line={previewCursorBox.point.line}
            data-glide={previewCursorBox.glide ? "" : undefined}
            aria-hidden="true"
            style:top="{previewCursorBox.top}px"
            style:left="{previewCursorBox.left}px"
            style:width="{previewCursorBox.width}px"
            style:height="{previewCursorBox.height}px"
          ></div>
        {/if}
        <!-- Hidden rather than gone under the cursor's row, so it glides off it. -->
        {#if hover}
          <div
            class="preview-hover"
            data-caret-preview-hover
            data-line={hover.row.line}
            data-glide={hover.glide ? "" : undefined}
            aria-hidden="true"
            style:visibility={hoverBandShown ? undefined : "hidden"}
            style:top="{hover.band.top}px"
            style:left="{hover.band.left}px"
            style:width="{hover.band.width}px"
            style:height="{hover.band.height}px"
          ></div>
        {/if}
        {#if plusAt}
          {@const row = plusAt.row}
          <!-- Visual mode's "+" comments on its selection, as `c` does. -->
          {@const selection = plusAt === visual?.end}
          <div
            class="preview-plus"
            data-glide={plusAt.glide ? "" : undefined}
            style:top="{plusAt.band.top}px"
            style:left="{plusAt.plus.left}px"
            style:width="{plusAt.plus.width}px"
            style:height="{plusAt.band.height}px"
          >
            <button
              type="button"
              bind:this={plusEl}
              aria-label="Add a comment"
              onclick={() =>
                selection ? previewCursor.comment() : commentOnRows(row, row)}
            >
              <!-- The source gutter's glyph: @pierre/diffs' diffs-icon-plus. -->
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 3a.75.75 0 0 1 .75.75v3.5h3.5a.75.75 0 0 1 0 1.5h-3.5v3.5a.75.75 0 0 1-1.5 0v-3.5h-3.5a.75.75 0 0 1 0-1.5h3.5v-3.5A.75.75 0 0 1 8 3"
                />
              </svg>
            </button>
          </div>
        {/if}
        {@render visualHint()}
      {:else}
        <!-- Live range readout: a zero-height sticky rail rendered first so it pins to
             the top of the scroll viewport from scroll position 0 without reflowing
             the line grid (the absolutely-positioned readout inside it takes no flow
             space). It stays visible as the selection — mouse drag or keyboard visual
             select — and any auto-scroll move. Reads the same ascending range the
             composer label will, and is gone the instant the gesture ends or the
             composer opens. aria-live so a reader hears the range grow. -->
        <div class="drag-readout-rail" aria-hidden={rangeReadout == null}>
          {#if rangeReadout}
            <div class="drag-readout metric" role="status" aria-live="polite">{rangeReadout}</div>
          {/if}
        </div>
        <SourceView
          doc={{ name: "plan.md", text: linkLayer.text }}
          links={linkLayer.spans}
          inline={linkLayer.inline}
          images={linkLayer.images}
          quoteDepth={linkLayer.quoteDepth}
          {fileRefs}
          onFileRefClick={openFileRef}
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
          selectedRange={pending ?? visualSelection ?? null}
          cursorLine={keyboardStore.cursorLine}
          {searchMatches}
          currentMatchIndex={keyboardStore.searchIndex}
          {reflowedBlocks}
          selectText={selectingText}
        />
        <!-- The comment-span bracket overlay: rounded gutter rails marking each
             comment's covered lines. It layers over the .diff-plan scroll content
             (a child of it, positioned by the action against the host's shadow
             [data-line] rows) so the rails scroll with the rows; it is decorative
             (pointer-events: none). -->
        <div use:bracketLayer={{ host, spans: bracketSpans }}></div>
        <!-- The per-code-block chrome (EXC-692, EXC-1386): copy at the top-right of every
             fenced block, plus soft wrap on the ones that overflow, resting dimmed and
             brightening under the pointer. It layers over the .diff-plan scroll content, so
             like the bracket rails it scrolls with the rows. -->
        {@render codeChrome()}
        <!-- The one-time reference hints (EXC-1061): one badge over the first
             on-screen file reference and one over the first directory reference,
             teaching that a path token opens a preview. Layered over the .diff-plan
             scroll content like the copy button, so they scroll with the rows.
             Rendered on the referenceHints surfaces only, so elsewhere both drop —
             nothing renders there, so no badge is shown off the source view. Opening a
             reference on the preview still retires its kind through `openFileRef`,
             since the reader has learned the gesture.
             NOT gated on showShortcutHints, unlike the two hint chips further down:
             that pref governs keyboard-shortcut affordances, and this teaches a
             mouse gesture. Keyed on the kind — never on a value a poll tick changes
             — so the instance and its running ping survive a re-render. -->
        {#each refHints as hint (hint.kind)}
          <RefHintBadge
            kind={hint.kind}
            path={hint.span.path}
            top={hint.top}
            left={hint.left}
            onActivate={() => openFileRef(hint.span, refHintToken(host, hint))}
          />
        {/each}
        <!-- Saved comments and the open composer are projected into the library's
             per-line annotation rows (slotInto), so they render inline between the
             code lines at their anchor line rather than floating over them. One node
             per line carries that line's slot; multiple comments on a line stack
             inside it as a single ordered thread. -->
        {#each lineThreads as thread (thread.line)}
          <div use:slotInto={{ host, line: thread.line }}>{@render commentThread(thread.annotations)}</div>
        {/each}
        {#if pending}
          <!-- Key the whole composer host container per range, not just the inner
               SourceComposer. This <div> is the node slotInto projects into the
               library's annotation row; keying only the composer left it mounted
               across a range switch, so slotInto reassigned its slot in place, and
               that reprojection stripped the just-focused editor's DOM caret while
               CodeMirror kept its offset — the first Backspace then jumped the caret
               to the start (EXC-780). Remounting the container gives a fresh slot
               placement on each switch. The key still gives each line a clean
               composer (SourceComposer/MarkdownEditor seed their text once at mount);
               the dismissed line's text is retained as a scratch by openRange, so
               nothing is lost. -->
          {#key `${pending.startLine}:${pending.endLine}`}
            <div use:slotInto={{ host, line: pending.endLine }}>{@render openComposer(pending)}</div>
          {/key}
        {/if}
        <!-- Retained scratch drafts: an unsubmitted composer dismissed with typed
             text leaves a quiet "Resume" marker at its line, clicking which reopens
             the composer with the text restored. The open composer supersedes the
             marker for its own range (the reviewer is editing it now), so skip a
             scratch sharing the pending line. -->
        <!-- Markers anchor to endLine (matching the composer/card), so two scratches
             that end on the same line share one library row and stack within it —
             an uncommon overlap, harmless: each stays clickable and resumable. -->
        {#each draftMarkers as scratch (scratch.key)}
          <div use:slotInto={{ host, line: scratch.endLine }}>{@render draftMarker(scratch)}</div>
        {/each}
        <!-- One-time hint: rendered last so it sticks to the bottom of the scroll
             viewport, reading as ambient guidance. Surfaces the drag-to-comment
             gesture on first gutter hover, retired for good once the reviewer drags. -->
        {#if hintVisible}
          <div class="drag-hint" role="note">Drag across lines to comment on a range — hold Shift to select text.</div>
        {/if}
        {@render visualHint()}
      {/if}
      {#if legacyAnnotations.length > 0}
        <LegacyAnnotationList annotations={legacyAnnotations} />
      {/if}
    </div>
    <span class="pane-lip" aria-hidden="true" bind:this={lipEl}></span>
  </div>
  <!-- The filename-reference preview (EXC-687, docked since EXC-937): a lane
       beside the plan holding the referenced file's excerpt. It takes layout
       space rather than covering the plan, and slides in from whichever edge it
       docked to. Only appears for references the daemon resolved to a real file,
       and only on the fileReferences surfaces. -->
  {#if runs("fileReferences") && filePreview}
    <!-- Bound here because the {#if}'s narrowing does not reach into a snippet body. -->
    {@const openRef = filePreview}
    <FileDrawer
      edge={drawerEdge}
      size={drawerSize}
      available={drawerAxis}
      onResize={setDrawerSize}
      onReset={() => setDrawerSize(null)}
      closing={drawerClosing}
    >
      {#snippet children()}
        <FilePreview
          reviewId={reviewId}
          path={openRef.path}
          line={openRef.line}
          endLine={openRef.endLine}
          {showShortcutHints}
          onClose={dismissFilePreview}
        />
      {/snippet}
    </FileDrawer>
  {/if}
</div>
</div>

<!-- The outline itself, in either place it stands. Off compare it reads the plan and its
     comments and latches the heading being read; while comparing it reads the base
     version and marks each section's change against the target. -->
{#snippet outlineList(placement: "column" | "float")}
  <PlanToc
    {placement}
    {headings}
    activeLine={showDiff ? null : latchedLine}
    latchGlides={latchJump !== null}
    plan={review.currentPlan}
    previous={review.versions.at(-2) ?? null}
    comments={commentIndex(annotations, scratches)}
    {showShortcutHints}
    onJump={placement === "float" ? pickFromFloat : pickHeading}
    onHide={() => setOutline("hidden")}
    open={columnShown && keyEntry !== "rest"}
    onExposeFilter={placement === "column" ? (open) => (openColumnFilter = open) : undefined}
    onPeek={runs("outlinePeek") ? (target) => (peekTarget = target) : undefined}
    peekStays={runs("outlinePeek") ? flipsView : undefined}
  />
{/snippet}

<!-- The outline as a float, dropped from the header's start by `\` while the column is
     hidden or under --w-narrow. It opens on its filter; Escape or a click outside closes
     it back to where focus was, and a pick closes it into the plan. -->
{#if outlineRuns && !columnShown}
  <Popover.Root bind:open={floatOpen}>
    <Popover.Content
      class="outline-float"
      customAnchor={outlineKey ?? floatAnchor}
      side="bottom"
      align="start"
      sideOffset={18}
      alignOffset={-9}
      bind:ref={floatEl}
      onOpenAutoFocus={(e) => {
        const field = floatEl?.querySelector<HTMLInputElement>("[data-slot='command-input']");
        if (field == null) return;
        e.preventDefault();
        field.focus();
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        if (floatPicked) floatPicked = false;
        else if (floatReturn?.isConnected) floatReturn.focus();
        floatReturn = null;
      }}
    >
      {@render outlineList("float")}
    </Popover.Content>
  </Popover.Root>
{/if}

{#if runs("outlinePeek")}
  <OutlinePeek
    target={peekTarget}
    snippet={peekSnippet}
    view={planView}
    bounds={paneEl}
  />
{/if}

<!-- The folder-reference tree (EXC-918). A viewport-fixed card rather than a lane
     in the surface above, so it sits outside that flex row entirely; gated on the
     fileReferences surfaces like the file lane is. -->
{#if runs("fileReferences") && folderTree}
  {@const openDir = folderTree}
  <!-- A file row opens the SAME lane a filename reference opens (EXC-1137). The
       card converted the row's tree-relative path already. -->
  <FolderTree
    reviewId={reviewId}
    path={openDir.path}
    anchor={openDir.rect}
    memory={folderCards}
    {showShortcutHints}
    onOpenFile={(path) => openFilePreview({ path })}
  />
{/if}

<style>
  /* Placed over the room its block's padding holds open; the bottom padding, matching
     .plan-preview's block margin, is the gap before the next block. */
  .preview-slot {
    position: absolute;
    padding-block-end: calc(var(--text-base) * var(--preview-scale));
    font-size: var(--text-base);
  }
  /* Not visibility: hidden — a composer mounting here focuses at once, and a hidden element
     can't take focus. */
  .preview-slot[data-unmeasured] {
    opacity: 0;
    pointer-events: none;
  }
  /* The body row under the top bar: the outline column, when it stands, beside the
     surface. As a .shell grid item it would floor at its content's intrinsic width, so
     min-width: 0 lets it shrink inside the app's MIN_APP_WIDTH_PX floor. It holds a folding
     column as it leaves, and clips the parts of a layout slide (lib/layoutSlide.ts) that
     start past its edges. Hidden, not clip: Chromium lazy-loads an image in the plan only
     within reach of a scroll container's edge, and a clip ancestor cuts that reach off. */
  .plan-body {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  /* The outline column: a bed cut into the body (PlanToc.svelte draws it), level with the
     plan pane and inset from the window's edge as the pane is. The 1px at its foot is the
     room the pane keeps for its lip. */
  .plan-outline {
    position: relative;
    z-index: 1;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 0 0.5rem 1px var(--pane-gap);
  }
  /* The column's edge covers only the gap between its bed and the plan pane, its end
     padding, below the column's head, so it takes no click meant for a row, the head's
     keys or the plan, and its grip never rises beside the head's outline key. */
  .plan-outline > :global(.splitter) {
    inset: var(--pane-header-h) 0 0 auto;
    width: 0.5rem;
  }
  /* The parts of a layout slide (lib/layoutSlide.ts), each sliding home from the offset it
     is let go at. The column stacks over the plan, so its key shows as it travels across. */
  .plan-outline,
  .plan-outline :global(.toc-title-row .header-tray),
  .plan-pane,
  .diff-plan,
  .header-bed,
  .crumb-slot :global(:is(.plan-breadcrumbs, .plan-search)),
  .plan-header :global(.compare-picker) {
    transition: transform var(--slide-dur, var(--dur-state)) var(--ease-out);
  }
  .header-bed {
    transform-origin: left;
  }
  /* The slot clips what slides in it at its end, so the crumbs and the find row never run
     over the view keys. Open to its left, where they slide in from as the column stands. */
  .crumb-slot {
    clip-path: inset(0 0 0 -100vw);
  }
  /* While the column leaves, the plan's text slides on from past the pane's right edge,
     which clips it there. The 2px above and below keep the floor's lip. */
  .plan-body.column-leaving .plan-pane {
    clip-path: inset(-2px 0 -2px -100vw round 0 var(--pane-radius) var(--pane-radius) 0);
  }
  /* Folding, the column leaves the layout where it stands, so the plan takes its room in
     one pass, and slides off the window's edge. Its key travels on to the header's, which
     waits unseen until the column has gone. */
  .plan-outline.leaving {
    position: absolute;
    inset-block: 0;
    left: 0;
    transform: translateX(-100%);
    transition-duration: var(--dur-state);
  }
  .plan-outline.leaving :global(.toc-title-row .header-tray) {
    transform: translate(var(--key-dx, 0px), var(--key-dy, 0px));
    transition-duration: var(--dur-state);
  }
  /* The key's latch rides its travel: it latches on --dur-pane as the column stands, and
     lets go on --dur-state as it folds, on the travel's curve rather than a press's
     spring. */
  .plan-outline:is(.key-arriving, .leaving) :global(.toc-title-row .header-tray > button) {
    transition-timing-function: var(--ease-out);
  }
  .plan-outline.key-arriving :global(.toc-title-row .header-tray > button) {
    transition-duration: var(--dur-pane);
  }
  .plan-body.column-leaving .plan-header > .header-tray {
    opacity: 0;
  }

  /* The plan's header, stuck to the pane's top edge above the scroller, in one bed
     (atoms.css). Its keys stand at the top bar's height, and its end keys' pads, with its
     own, put them as far inside the bed's walls as the bed is inside the pane. */
  .plan-header {
    --ctl-h: 1.75rem;
    container: plan-header / inline-size;
    position: relative;
    z-index: 5;
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    height: var(--pane-header-h);
    min-width: 0;
    padding-inline: 1.15rem var(--well-pad);
  }
  .plan-header:has(> .header-tray) {
    padding-left: var(--well-pad);
  }
  /* Where the header's outline key would stand, for the float to drop from under
     --w-narrow, where the key is not rendered. */
  .float-anchor {
    position: absolute;
    inset-inline-start: calc(var(--well-pad) * 2);
    top: 50%;
    height: var(--ctl-h);
    translate: 0 -50%;
    pointer-events: none;
  }
  /* The parts a layout move (lib/paneMove.ts) moves apart from the window, named only for
     its transition so no other one picks them up. */
  :global(:root[data-pane-move]) .plan-outline {
    view-transition-name: plan-outline;
  }
  :global(:root[data-pane-move]) .plan-pane {
    view-transition-name: plan-pane;
  }
  :global(:root[data-pane-move]) .crumb-slot {
    view-transition-name: plan-crumbs;
  }
  :global(:root[data-pane-move]) .plan-header > .header-tray {
    view-transition-name: outline-key;
  }
  :global(:root[data-pane-move]) .header-bed {
    view-transition-name: header-bed;
  }
  :global(:root[data-pane-move]) .plan-header :global(.preview-toggle) {
    view-transition-name: preview-key;
  }

  /* The view keys close the header. While comparing, the compare controls span the
     room the crumbs leave. */
  .plan-header :global(.compare-picker) {
    flex: none;
    margin-left: auto;
  }
  .plan-header.comparing :global(.compare-picker) {
    flex: 1 1 auto;
    min-width: 0;
  }
  /* Where the find row would still squeeze its query with its slash and the count's
     spaces gone, the header's keys drop their hint caps while it is open. Measured with
     the outline key in the header and Versions without its word. */
  @container plan-header (width < 31.3rem) {
    .plan-header.searching :global(.header-tray .kbd-sm) {
      display: none;
    }
  }

  /* The crumbs' slot, and the stage the find row slides across: the clip at its end is
     what makes the row come out of the Search entry. */
  .crumb-slot {
    position: relative;
    flex: 1 1 auto;
    align-self: stretch;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }
  /* The breadcrumbs (EXC-946) GROW into the slot rather than sizing to their trail
     (EXC-957), which their own collapse depends on: sized to content, giving a level up
     would shrink the bar, which would free room, which would bring the level back.
     Covered by the find row they keep their box, so that measure holds still, and they
     fade back in as it tucks away. Only uncovering fades: the row covers them at once,
     and a fade out that a quick close reversed would cut the fade back in short. */
  .crumb-slot:not([data-covered]) :global(.plan-breadcrumbs) {
    transition:
      opacity var(--dur-state) var(--ease-out),
      transform var(--slide-dur, var(--dur-state)) var(--ease-out);
  }
  .crumb-slot :global(.plan-breadcrumbs) {
    flex: 1 1 auto;
    min-width: 0;
  }
  .crumb-slot[data-covered] :global(.plan-breadcrumbs) {
    visibility: hidden;
    opacity: 0;
  }
  /* The way into search, at the slot's end before the view keys: a closed field the find
     row slides open from and tucks back into. It lies in a field's shallow cut rather than
     standing as a key, so the crumbs and the view keys keep the header's weight. Its
     hover, focus and press are a ghost control's. A ring of the bed's floor hides the
     crumbs that pass under it as the column folds. */
  .search-entry {
    --entry-ring: 0 0 0 0.2rem var(--header-bed-floor);
    position: relative;
    flex: none;
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: var(--ctl-h);
    padding-inline: 0.55rem;
    border: none;
    border-radius: calc(var(--key-radius) + var(--well-pad));
    background-color: var(--field-floor);
    box-shadow: var(--panel-recess), var(--entry-ring);
    color: var(--ink-soft);
    font-size: var(--text-xs);
    white-space: nowrap;
    user-select: none;
    transition:
      background-color var(--dur-state) var(--ease-out),
      color var(--dur-state) var(--ease-out),
      box-shadow var(--dur-state) var(--ease-out),
      transform var(--slide-dur, var(--dur-state)) var(--ease-out),
      visibility var(--dur-state) step-end;
  }
  .search-entry:is(:hover, :focus-visible) {
    background-image: linear-gradient(var(--ink-wash), var(--ink-wash));
    color: var(--ink);
  }
  .search-entry:is(:active, :global([data-key-pressed])) {
    background-image: linear-gradient(var(--ink-wash), var(--ink-wash));
    box-shadow:
      var(--panel-recess),
      inset 0 1px var(--press-blur) var(--press-shade),
      var(--entry-ring);
  }
  /* Nothing in the row stands over the entry, and the floor band leaves its rim showing,
     so it goes the moment the row opens and returns only once the row has tucked into it
     (the base rule's step-end over the tuck's --dur-state). */
  .crumb-slot[data-covered] .search-entry {
    visibility: hidden;
    transition-property: none;
  }
  /* Its word goes where Versions' word does: keep in step with VersionComparePicker. */
  @container plan-header (width < 37.45rem) {
    .search-word {
      display: none;
    }
  }

  /* The outline's float: the column's list on a raised panel, dropped from the
     header's outline key. Unlayered, so it takes over the vendored popover's box. */
  :global(.outline-float) {
    z-index: 40;
    width: min(20rem, calc(100vw - 1rem));
    max-height: 27rem;
    padding: 0;
    gap: 0;
    overflow: hidden;
    background: var(--paper-raised);
    box-shadow: var(--float-surface-mid);
    /* A row's key runs the list's 4px side padding in from this corner. */
    border-radius: calc(var(--key-radius) + 4px);
  }

  /* The plan and the file drawer (EXC-937) divide this surface between them: a
     row when the drawer docks right, a column when it docks bottom. With no
     drawer open the plan pane is the only child and takes the whole thing. Both are
     panes set into the window's body, inset from its sides. */
  .diff-surface {
    flex: 1 1 auto;
    display: flex;
    min-width: 0;
    min-height: 0;
    position: relative;
    margin-inline: var(--pane-gap);
    /* Room for the panes' lip. */
    padding-bottom: 1px;
  }
  .diff-surface.dock-bottom {
    flex-direction: column;
  }
  .diff-surface.beside-outline {
    margin-inline-start: 0;
  }

  /* Everything that is the plan: its header, then the source view, which fills the rest
     and scrolls on its own. `display: flex` plus .diff-plan's `flex: 1` is what makes
     the source view fill it. It paints nothing itself: its floor and recess are layers of
     their own, which an outline move stretches to the plan's moving edge. */
  .plan-pane {
    position: relative;
    isolation: isolate;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-radius: var(--pane-radius);
    --plan-floor: var(--paper);
    --header-bed-floor: color-mix(in lab, var(--plan-floor), var(--bed-floor) var(--header-bed-mix));
  }
  /* Where the diff library draws the plan, the room past its rows takes the rows' floor,
     so the pane reads as one surface. Keep in step with --diffs-bg (styles/diffview.css). */
  .plan-pane:not([data-surface='preview']) {
    --plan-floor: var(--paper-sunk);
  }
  /* The plan's floor, under everything in the pane, with the body's lit edge below it. */
  .pane-floor {
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: var(--plan-floor);
    box-shadow: var(--pane-lip);
    transform-origin: left;
    transition: transform var(--slide-dur, var(--dur-state)) var(--ease-out);
  }
  /* The recess, on its own layer over the plan and its header, and the shade at the pane's
     foot. An idle shade stays an inset layer so it fades rather than snaps. */
  .pane-lip {
    --bottom-shade: inset 0 0 0 0 transparent;
    position: absolute;
    inset: 0;
    z-index: 5;
    border-radius: inherit;
    pointer-events: none;
    box-shadow:
      var(--bottom-shade),
      var(--pane-recess);
    transform-origin: left;
    transition:
      box-shadow var(--dur-state) var(--ease-out),
      transform var(--slide-dur, var(--dur-state)) var(--ease-out);
  }
  .plan-pane[data-more-below] .pane-lip {
    --bottom-shade: inset 0 -7px 8px -7px var(--pane-shade);
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
    /* The pane doesn't clip, so the scroller rounds the plan's foot itself. */
    border-radius: 0 0 var(--pane-radius) var(--pane-radius);
    background: var(--plan-floor);
    /* What the preview multiplies each --text-* step by: the base font size the settings
       set over --text-base, 13.12px at the 16px root. Here rather than on the preview, so
       the overlays sized to its rows scale with them. */
    --preview-scale: calc(var(--preview-font-size) / 13.12);
  }

  /* A source/preview flip fades the arriving view in. The scroller outlives the flip and
     an animation restarts only when its name changes, so each direction names its own.
     Opacity only: a transform would move the rects the overlays measure mid-flip. */
  .diff-plan[data-view-flip='source'] {
    animation: plan-view-in-source var(--dur-state) var(--ease-out);
  }
  .diff-plan[data-view-flip='preview'] {
    animation: plan-view-in-preview var(--dur-state) var(--ease-out);
  }
  @keyframes plan-view-in-source {
    from {
      opacity: 0;
    }
  }
  @keyframes plan-view-in-preview {
    from {
      opacity: 0;
    }
  }

  /* Scroll-beyond-last-line room (EXC-772): an in-flow spacer below the plan
     lets the reader scroll a third of a viewport past the end, so the last line
     can rest ~2/3 down the window instead of pinned to the bottom. A block
     ::after (not the container's own padding-bottom, which pre-2024 Chrome and
     Safari clip from the scrollable area) reliably extends scrollHeight. */
  .diff-plan::after {
    content: '';
    display: block;
    height: 33.333vh;
  }

  /* Translucent ink, so it reads as the source band over paper without hiding the
     text beneath it. */
  .preview-cursor {
    position: absolute;
    pointer-events: none;
    /* Keep in sync with coreStyles.ts's [data-caret-cursor] rules. */
    background: color-mix(in lab, var(--ink) 7%, transparent);
    box-shadow: inset 3px 0 0 0 var(--ink);
  }

  /* The source view's hover grey: the library mixes 3% (light) or 9% (dark) of
     --diffs-bg-hover-override, which diffview.css binds to --ink, into the row. */
  .preview-hover {
    position: absolute;
    pointer-events: none;
    background: color-mix(in lab, var(--ink) 9%, transparent);
  }
  :global([data-theme="light"]) .preview-hover {
    background: color-mix(in lab, var(--ink) 3%, transparent);
  }
  /* The keyboard visual selection's wash. */
  .preview-drag {
    position: absolute;
    pointer-events: none;
    background: var(--accent-wash);
  }
  /* The source gutter's selection ticks as one bar, centred in the "+" lane and inset at
     each end as a tick is in its row. Keep in sync with coreStyles.ts's
     [data-selected-line]::after rule. */
  .preview-drag-bar {
    position: absolute;
    display: flex;
    justify-content: center;
    padding-block: 0.22lh;
    font-size: calc(var(--text-base) * var(--preview-scale));
    pointer-events: none;
  }
  .preview-drag-bar::after {
    content: "";
    width: 3px;
    border-radius: var(--radius);
    background-color: var(--accent);
    opacity: 0.45;
  }
  /* One shape morphing between rows, on the tint-or-pop tier, in step with the cursor's
     follow scroll; the global reduced-motion rule collapses it to a jump. */
  :is(.preview-cursor, .preview-hover, .preview-drag, .preview-drag-bar, .preview-plus)[data-glide] {
    transition-property: top, left, width, height;
    transition-duration: var(--dur-state);
    transition-timing-function: var(--ease-out);
  }
  /* Centred in the preview's left padding, one preview line square. */
  .preview-plus {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  /* The accent key's recipe from atoms.css, on no tray. Keep in sync with coreStyles.ts's
     [data-utility-button] rules and the library's. */
  .preview-plus > button {
    --plus-face: var(--accent);
    --plus-side: color-mix(in lab, var(--plus-face), black var(--tinted-side));
    appearance: none;
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 1lh;
    block-size: 1lh;
    padding: 0;
    font-size: calc(var(--text-base) * var(--preview-scale));
    line-height: inherit;
    border: none;
    border-radius: var(--radius);
    background-color: var(--plus-face);
    background-image:
      linear-gradient(var(--tinted-lift), transparent 32%, transparent 55%, var(--tinted-foot)),
      var(--grain);
    background-size: auto, 128px;
    background-blend-mode: normal, soft-light;
    color: var(--accent-ink);
    fill: currentColor;
    cursor: pointer;
    pointer-events: auto;
    translate: 0 calc(-1 * var(--key-rise));
    box-shadow:
      inset 0 2px 2px -1px var(--rubber-gloss),
      0 calc(var(--key-side) - 1px) 0 var(--plus-side),
      0 var(--key-side) 1px var(--plus-side),
      0 calc(var(--key-side) * 5 / 3) calc(var(--key-side) * 2) -1px var(--rubber-cast-near),
      0 calc(var(--key-side) * 8 / 3) calc(var(--key-side) * 14 / 3) calc(var(--key-side) * -2)
        var(--rubber-cast);
  }
  .preview-plus > button:is(:hover, :focus-visible) {
    --plus-face: var(--accent-face-hover);
  }
  .preview-plus > button:active {
    --plus-face: var(--accent-face-press);
    translate: 0 var(--key-sink);
    background-image: linear-gradient(var(--tinted-foot), transparent 40%), var(--grain);
    box-shadow:
      inset 0 2px 4px var(--rubber-press),
      0 1px 1px var(--rubber-cast-near);
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
     pointer capture. On the chip-scale --shadow-chip — a readout this small is
     shorter than --shadow-card's own blur. */
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
    box-shadow: var(--shadow-chip);
    pointer-events: none;
    animation: readout-in var(--dur-state) var(--ease-out);
  }

  /* The one-time drag hint and the visual-select affordance hint share one chip:
     sticky at the bottom of the viewport so each reads as ambient guidance rather
     than blocking the surface it describes, in quiet paper-raised chrome — a nudge,
     not the amber action affordance. The visual-hint's inline Kbd keycaps flow in
     the sentence, picking up the chip's ink-soft colour, and both ride the
     chip-scale --shadow-chip. */
  .drag-hint,
  .visual-hint {
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
    box-shadow: var(--shadow-chip);
    animation: readout-in var(--dur-state) var(--ease-out);
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
