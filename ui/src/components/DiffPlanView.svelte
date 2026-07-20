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
  import SourceView from "$lib/diffview/SourceView.svelte";
  import SourceDiffView from "$lib/diffview/SourceDiffView.svelte";
  import {
    groupAnnotationsByLine,
    slotInto,
    toLineAnnotations,
  } from "$lib/diffview/annotationSlot.ts";
  import { type BracketSpan, bracketLayer } from "$lib/diffview/bracket.ts";
  import { type CodeBlockRange, codeBlockRanges, codeBlockText } from "$lib/diffview/codeBlocks.ts";
  import { codeBlockAtPoint, copyAnchor } from "$lib/diffview/codeCopy.ts";
  import {
    type ComposerScratch,
    createSourceCommenting,
    normalizeRange,
    rangeLabel,
  } from "$lib/diffview/commenting.ts";
  import { dismissDragHint, isDragHintDismissed } from "$lib/diffview/dragHint.ts";
  import { buildFileRefLayer, type FileRefSpan, type FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
  import { createHoverIntent } from "$lib/diffview/hoverIntent.ts";
  import { resolveFileRefs } from "$lib/api.ts";
  import { shortCwd } from "$lib/cwd.ts";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { buildLinkLayer } from "$lib/diffview/links.ts";
  import { readDiffStyle, writeDiffStyle } from "$lib/diffStylePref.ts";
  import { readDiffIndicators, writeDiffIndicators } from "$lib/diffIndicatorsPref.ts";
  import { type CompareStore, createCompare } from "@/state/compare.svelte.ts";
  import { setHeadingSlug, takeHeadingSlug } from "@/state/headingLink.ts";
  import VersionComparePicker from "@/components/VersionComparePicker.svelte";
  import PlanSearch from "@/components/PlanSearch.svelte";
  import type { SourceViewGutter } from "$lib/diffview/options.ts";
  import type { SourceViewApi, SourceViewOptions } from "$lib/diffview/types.ts";
  import { CANONICAL_KEYMAP, defaultIsEditingContext, shortcuts } from "$lib/shortcuts/index.ts";
  import { type CursorMotion, resolveCursorLine } from "$lib/diffview/lineCursor.ts";
  import {
    findMatches,
    matchStepFromLine,
    nearestMatchIndex,
    stepIndex,
  } from "$lib/diffview/planSearch.ts";
  import { activeHeadingLine, extractHeadings, lineForSlug, shouldShowToc, slugForLine } from "$lib/toc.ts";
  import { NARROW_WIDTH_PX, TIGHT_WIDTH_PX } from "$lib/layout.ts";
  import { readTocOpen, writeTocOpen } from "$lib/tocPref.ts";
  import { lineAtReadingZone } from "$lib/diffview/scroll.ts";
  import {
    type Annotation,
    type ClientReview,
    isLegacyAnnotation,
    isLineAnnotation,
  } from "@core/lib/types";
  import SourceComposer from "@/components/SourceComposer.svelte";
  import SourceScratchMarker from "@/components/SourceScratchMarker.svelte";
  import SourceAnnotationThread from "@/components/SourceAnnotationThread.svelte";
  import LegacyAnnotationList from "@/components/LegacyAnnotationList.svelte";
  import SourceToc from "@/components/SourceToc.svelte";
  import CodeCopyButton from "@/components/CodeCopyButton.svelte";
  import FilePreview from "@/components/FilePreview.svelte";
  import Icon from "@/components/Icon.svelte";

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
    /** Hand the host the controller's per-scratch Save/Discard/Draft actions, once,
     * so the dialog can graduate, drop, or demote-into a scratch without owning the
     * controller. `draft` is how the dialog marks a committed inline comment as an
     * unsent draft (EXC-762). */
    onExposeScratchActions?: (actions: {
      save: (key: string) => void;
      discard: (key: string) => void;
      draft: (scratch: { startLine: number; endLine: number; text: string }) => void;
    }) => void;
    /** Hand the host a reveal(line) action once the source view mounts, so a sibling
     * (the comment navigator) can scroll the plan to a commented line. A call before
     * the view paints is a bounded-retry no-op. */
    onExposeReveal?: (reveal: (line: number) => void) => void;
    /** The active caret theme's color scheme, forwarded to the shadow-DOM diff
     * view so its shiki highlighting follows the selected theme (EXC-730). Omitted
     * leaves the library following the system preference. */
    scheme?: "light" | "dark";
    /** Whether the shortcut-hint affordances are shown (EXC-826); gates the V-mode
     * "c comment · Esc cancel" chip. Defaults to shown; the shortcut still fires. */
    showShortcutHints?: boolean;
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
    onExposeReveal,
    scheme,
    showShortcutHints = true,
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

  // Below --w-narrow, split's two side-by-side columns can't fit, so the compare
  // diff is forced to unified (EXC-811). This overrides the rendered layout only —
  // the persisted diffStyle preference is never written, so widening back above
  // the breakpoint restores the reviewer's split choice. The matchMedia guard
  // defends any DOM env lacking matchMedia; the happy-dom unit env provides one
  // that reports no match, so units stay on the wide default either way. The
  // effect subscribes once and its listener flips the layout live when a resize
  // crosses the breakpoint. The px literal mirrors NARROW_WIDTH_PX (layout.ts) —
  // @media/matchMedia can't read the --w-* token — matching TopBar's
  // narrow-consolidation query (EXC-810).
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
  // line-number gutter is always shown. These were once user toggles (EXC-606),
  // but that configurability was removed, so the former defaults are now the only
  // behavior.
  // Reactive on `scheme` so a theme switch yields a new options reference — both
  // the reader (SourceView) and the compare view (which spreads this) re-apply it
  // through their existing `lifecycle.sync`, re-highlighting in the chosen theme.
  const readerOptions = $derived<SourceViewOptions>({
    overflow: "scroll",
    disableLineNumbers: false,
    scheme,
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

  // The filename-reference layer (EXC-687). Candidates are parsed from the SAME
  // display text the view renders (linkLayer.text), so their columns line up with
  // the tokens; memoized on that text like the link layer so a poll tick yields a
  // stable reference.
  let fileRefMemo: { text: string; layer: FileRefSpanMap } | undefined;
  const fileRefCandidates = $derived.by(() => {
    const text = linkLayer.text;
    if (fileRefMemo?.text !== text) {
      fileRefMemo = { text, layer: buildFileRefLayer(text) };
    }
    return fileRefMemo.layer;
  });

  // The review's id as a value-stable derived: the 2s poll hands us a fresh review
  // object every tick, so reading `review.id` directly in an effect re-runs it each
  // tick even when the id is unchanged. A $derived short-circuits on the equal
  // string, so effects keyed on it fire only when the review actually switches.
  const reviewId = $derived(review.id);

  // Which candidate paths resolve to a real file in the review's cwd — the daemon
  // is the existence gate, so only these get the icon + hover. Resolved once per
  // candidate-set change: both dependencies below (the memoized candidate map and
  // the value-stable reviewId) hold their reference across a poll tick, so an
  // unchanged plan never re-resolves — which is what kept the icons and the open
  // hover preview from flickering every 2s. Cleared up front so a plan edit or
  // review switch drops stale icons at once.
  let resolvedPaths = $state<Set<string>>(new Set());
  $effect(() => {
    const candidates = fileRefCandidates;
    const id = reviewId;
    const paths = [...new Set([...candidates.values()].flat().map((s) => s.path))];
    resolvedPaths = new Set();
    if (paths.length === 0) return;
    let cancelled = false;
    void resolveFileRefs(id, paths).then((resolved) => {
      if (!cancelled) resolvedPaths = new Set(resolved);
    });
    return () => {
      cancelled = true;
    };
  });

  // The active file-reference spans: candidates confirmed real. Undefined when
  // none resolve, so SourceView wires no file-ref affordance in that common case.
  const fileRefs = $derived.by(() => {
    const resolved = resolvedPaths;
    if (resolved.size === 0) return undefined;
    const active: FileRefSpanMap = new Map();
    for (const [line, spans] of fileRefCandidates) {
      const keep = spans.filter((s) => resolved.has(s.path));
      if (keep.length > 0) active.set(line, keep);
    }
    return active.size > 0 ? active : undefined;
  });

  // The file reference the pointer is over, plus the token rect the preview
  // anchors to. Opening the preview arms the hover-intent tracker below, which owns
  // dismissal: it keeps the card open while the pointer heads toward it and closes
  // it only on a conclusive stop outside it (EXC-799).
  let hoveredFileRef = $state<{ path: string; line?: number; anchor: DOMRect } | undefined>();
  function showFileRef(ref: FileRefSpan, tokenElement: HTMLElement): void {
    hoveredFileRef = {
      path: ref.path,
      line: ref.line,
      anchor: tokenElement.getBoundingClientRect(),
    };
  }

  // Trajectory-aware hover intent (EXC-799): while a preview is open, sample the
  // pointer and let the tracker decide keep-vs-dismiss from its projected path.
  // Runs only while a ref is hovered; the listener + timers are torn down when the
  // preview closes or the hovered ref switches (the effect re-runs). Sampling is
  // coalesced to one frame so it never sits on the input path.
  $effect(() => {
    const ref = hoveredFileRef;
    if (ref === undefined) return;
    const intent = createHoverIntent({
      anchorRect: () => ref.anchor,
      cardRect: () =>
        document.querySelector("[data-file-preview]")?.getBoundingClientRect() ?? null,
      onDismiss: () => {
        hoveredFileRef = undefined;
      },
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (h) => {
        window.clearTimeout(h);
      },
    });
    // Seed from the anchor's centre — the pointer sits on the token at open.
    intent.seed(
      { x: (ref.anchor.left + ref.anchor.right) / 2, y: (ref.anchor.top + ref.anchor.bottom) / 2 },
      performance.now(),
    );
    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    const flush = () => {
      raf = 0;
      intent.sample({ x: lastX, y: lastY }, performance.now());
    };
    const onMove = (e: PointerEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (raf === 0) raf = requestAnimationFrame(flush);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    // Escape dismisses the open preview at once, and destroys the tracker up front
    // so its pending grace/idle timers can't fire after the card is gone (EXC-799).
    // The teardown below also destroys — destroy() is idempotent.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      intent.destroy();
      hoveredFileRef = undefined;
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      intent.destroy();
    };
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
    if (scroller == null || el == null || blocks.length === 0) {
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

  // Scroll to a 1-based line, retrying across a bounded number of frames until the
  // library has painted the target row (scrollToLine returns true). The rows paint
  // asynchronously after the container is ready, so a fresh target may not exist on
  // the first frame; the retry lets a jump land even on a long, highlight-heavy plan.
  // Shared by the deep-link restore and the comment navigator's reveal.
  function retryScrollTo(line: number): void {
    const a = api;
    if (a == null) return;
    let tries = 0;
    const attempt = () => {
      if (a.scrollToLine(line) || ++tries >= 30) return;
      requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }

  // Reveal a commented line for the host (the comment navigator): scroll the plan to
  // it. Reads the live `api`, so a call before the view mounts is a no-op.
  function revealLine(line: number): void {
    retryScrollTo(line);
  }

  // Captures the imperative API and, on the first ready, restores a deep-linked
  // heading (`?heading=<slug>`) by resolving the slug to its source line and
  // scrolling to it once. takeHeadingSlug() clears the param, so a later SourceView
  // remount (a version switch) won't re-jump — the live `?heading=` mirror takes
  // over from there. An unknown or stale slug resolves to null and is a no-op.
  function onSourceReady(a: SourceViewApi) {
    api = a;
    const slug = takeHeadingSlug();
    const line = slug != null ? lineForSlug(headings, slug) : null;
    if (line != null) retryScrollTo(line);
    restored = true;
  }

  // Hand the host the reveal(line) action once, mirroring the scratch-actions
  // hand-off. `untrack` keeps onExposeReveal from becoming a reactive dependency;
  // revealLine closes over the live `api`, so exposing it before the view paints is
  // safe (the reveal simply no-ops until the api lands).
  $effect(() => {
    untrack(() => onExposeReveal)?.(revealLine);
  });

  // The source line of the heading currently in the reading zone. Tracked from
  // the scroll container's topmost rendered line so the pane highlights the
  // section being read.
  let activeLine = $state<number | null>(null);
  // The scroll container (the .diff-plan element), used by the ToC tracking to
  // read the topmost visible line.
  let scrollEl = $state<HTMLElement | undefined>();

  // The keyboard line cursor (EXC-788): the focused line the vim motion moves and
  // a line click relocates. Single-version view only — compare mode is a
  // read-only diff with no cursor. Passed to SourceView, which tags its shadow row
  // so the override sheet paints the cursor band.
  let cursorLine = $state<number | null>(null);

  // The visual line-select anchor (EXC-790): the fixed end of a `V` selection. The
  // motions move `cursorLine` as usual; the span from the anchor to the cursor is
  // the live selection. null when not in visual mode.
  let visualAnchor = $state<number | null>(null);

  // The live visual selection, ascending — mirrored into SourceView's amber band
  // through `selectedRange` while visual mode is active, so extending it with j/k
  // grows the highlight in step.
  const visualSelection = $derived(
    visualAnchor != null && cursorLine != null
      ? normalizeRange({ start: visualAnchor, end: cursorLine })
      : undefined,
  );

  // ----- Plan search (/) (EXC-832) -----
  // The vim `/` full-text search of the plan content: the pill's open/committed
  // state, the live query, and the derived match set + current index. Matches are
  // computed over the SAME rendered text the cursor uses (linkLayer.text), so a
  // match's line maps straight onto the line cursor and its shadow-row highlight.
  let searchOpen = $state(false);
  let searchCommitted = $state(false);
  let searchQuery = $state("");
  let searchIndex = $state(-1);
  // The last COMMITTED (Enter) query, remembered for the session so `/` reopens with
  // it prefilled (EXC-832 follow-up) and n/N can resume it while the pill is closed.
  // Held separately from searchQuery so a content switch (resetSearch) never clears it.
  let lastQuery = $state("");
  const searchMatches = $derived(
    searchQuery === "" ? [] : findMatches(linkLayer.text.split("\n"), searchQuery),
  );

  // Re-track the current match to the nearest one at the reading position whenever the
  // QUERY changes while the field is being edited (search open, not yet committed) — so
  // the counter and the strong highlight follow the query live as you type or reopen.
  // Gated on !searchCommitted so a resume seed (n/N with the pill closed sets the query
  // AND commits) is not clobbered back to "nearest"; the cursor / reading position is
  // read UNTRACKED so a same-query n/N step (same matches reference) never re-runs this.
  $effect(() => {
    const matches = searchMatches;
    if (!searchOpen || searchCommitted) return;
    searchIndex = untrack(() => nearestMatchIndex(matches, cursorLine ?? topVisibleLine() ?? 1));
  });

  // Drop the cursor (and any visual selection) when the rendered content changes (a
  // new version or a review switch) so a later motion never steps from a line that
  // belonged to the prior plan. contentKey short-circuits on an unchanged poll tick,
  // so this fires only on a real switch, not every 2s poll re-delivering the same
  // version. A new version also invalidates the search, so reset it too.
  $effect(() => {
    void contentKey;
    cursorLine = null;
    visualAnchor = null;
    resetSearch();
  });

  // Recompute the active heading from the source line at the top of the reading
  // zone, throttled with rAF so a scroll burst settles into one read. The view
  // paints each line as <div data-line="N"> in a shadow root; lineAtReadingZone
  // picks the line sitting at the same offset jumps park headings at, so the
  // tracked section matches where a ToC click lands rather than the row above it.
  function topVisibleLine(): number | null {
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

  // Lines the cursor may occupy: the rendered plan text (what the view paints),
  // trailing newline trimmed so `G` lands on a real row.
  function cursorLineCount(): number {
    const text = linkLayer.text;
    const n = text.split("\n").length;
    return Math.max(1, text.endsWith("\n") ? n - 1 : n);
  }

  // The blank (empty or whitespace-only) source lines the `{` / `}` motions jump
  // between — the plan's paragraph boundaries. Read from the same rendered text
  // as the line count, capped to real rows so a trailing newline is not a target.
  function cursorBlankLines(): number[] {
    const count = cursorLineCount();
    return linkLayer.text
      .split("\n")
      .slice(0, count)
      .flatMap((line, i) => (line.trim() === "" ? [i + 1] : []));
  }

  // Half-page size from the scroller height over a rendered row's height, with a
  // constant fallback before the view paints. Measured per motion — cheap at
  // keyboard cadence.
  function cursorHalfPage(): number {
    const rowH =
      scrollEl
        ?.querySelector(".diffview")
        ?.shadowRoot?.querySelector<HTMLElement>("[data-line]")
        ?.getBoundingClientRect().height ?? 0;
    if (scrollEl == null || rowH <= 0) return 10;
    return Math.max(1, Math.floor(scrollEl.clientHeight / rowH / 2));
  }

  function moveCursor(motion: CursorMotion): void {
    const next = resolveCursorLine(motion, {
      cursor: cursorLine,
      lineCount: cursorLineCount(),
      headingLines: headings.map((h) => h.line),
      blankLines: cursorBlankLines(),
      halfPage: cursorHalfPage(),
      seed: topVisibleLine() ?? 1,
    });
    cursorLine = next;
    api?.followCursorLine(next);
  }

  // Comment the cursor line (EXC-790): open the composer on the cursor line, or —
  // in visual mode — over the whole anchored selection, exiting visual mode as it
  // opens. Reuses openRange, so an in-progress composer's text is retained and the
  // cursor tracks the anchored line; seeds an unplaced cursor at the reading
  // position, mirroring the motions.
  function commentCursorLine(): void {
    if (visualAnchor != null) {
      const { startLine, endLine } = normalizeRange({
        start: visualAnchor,
        end: cursorLine ?? visualAnchor,
      });
      visualAnchor = null;
      openRange(startLine, endLine);
    } else {
      const line = cursorLine ?? topVisibleLine() ?? 1;
      openRange(line, line);
    }
  }

  // Toggle visual line-select (EXC-790): on entry, anchor the selection at the
  // cursor (seeded at the reading position when unplaced) so j/k then extend the
  // span; pressing V again exits, as vim's V does, keeping the cursor placed.
  function enterVisualMode(): void {
    if (visualAnchor != null) {
      visualAnchor = null;
      return;
    }
    const anchor = cursorLine ?? topVisibleLine() ?? 1;
    cursorLine = anchor;
    visualAnchor = anchor;
    api?.followCursorLine(anchor);
  }

  // Esc reconciliation (EXC-790, superseding EXC-788's motion.clearCursor): close the
  // search HUD if open (EXC-832), else exit visual mode if active (keeping the cursor),
  // else clear the cursor. One handler, because the dispatcher fires only the first
  // matching Escape entry — layering the three Esc meanings in priority order.
  function clearSelectionOrCursor(): void {
    if (searchOpen) {
      closeSearch();
      return;
    }
    if (visualAnchor != null) visualAnchor = null;
    else cursorLine = null;
  }

  // ----- Plan search actions (EXC-832) -----
  // `/` opens the search prefilled with the last committed query and its text
  // selected, so it comes right back where you left it, yet typing immediately
  // replaces it (like browser find). On the FIRST open the pill isn't mounted yet, so
  // this focus/select is a no-op and PlanSearch's own mount step lands the caret and
  // selection; on a REOPEN over a committed HUD the pill is already mounted (its mount
  // step won't re-fire), so focusing/selecting here is what brings the field forward.
  function focusSearchField(): void {
    const el = document.querySelector<HTMLInputElement>("input[aria-label='Search plan']");
    el?.focus();
    el?.select();
  }
  function openSearch(): void {
    searchOpen = true;
    searchCommitted = false;
    searchQuery = lastQuery;
    searchIndex = -1;
    focusSearchField();
  }
  // Reset the search state without touching focus — used on a content switch.
  function resetSearch(): void {
    searchOpen = false;
    searchCommitted = false;
    searchQuery = "";
    searchIndex = -1;
  }
  // Dismiss the pill: clearing the query empties the match set (which clears the
  // highlights), the cursor stays where it landed, and blurring the field returns
  // focus to the plan.
  function closeSearch(): void {
    resetSearch();
    (document.activeElement as HTMLElement | null)?.blur();
  }
  // Move the line cursor to the match at searchIndex and scroll it into view.
  function revealMatch(): void {
    const m = searchMatches[searchIndex];
    if (m == null) return;
    cursorLine = m.line;
    api?.followCursorLine(m.line);
  }
  // Enter commits: remember the query for the session (so `/` reopens it and n/N can
  // resume it), land the cursor on the nearest match, keep the pill as a HUD, and blur
  // the field so bare n/N/Esc fire globally. No matches → nothing to commit.
  function commitSearch(): void {
    if (searchMatches.length === 0) return;
    lastQuery = searchQuery;
    searchIndex = nearestMatchIndex(searchMatches, cursorLine ?? topVisibleLine() ?? 1);
    revealMatch();
    searchCommitted = true;
    (document.activeElement as HTMLElement | null)?.blur();
  }
  // n / N. While a search is up (typing or committed HUD) they step the current index
  // with wrap. With the pill CLOSED but a remembered query, they RESUME it: restore the
  // query, re-show the pill as a committed HUD, and seed the match from the cursor's
  // reading position (matchStepFromLine — next/previous relative to where you are).
  function stepSearch(delta: number): void {
    if (!searchOpen) {
      if (lastQuery === "") return;
      searchQuery = lastQuery;
      searchOpen = true;
      searchCommitted = true;
      searchIndex = matchStepFromLine(searchMatches, cursorLine ?? topVisibleLine() ?? 1, delta);
      revealMatch();
      return;
    }
    if (searchMatches.length === 0) return;
    searchIndex = stepIndex(searchMatches.length, searchIndex, delta);
    revealMatch();
  }

  // Register the live motion + commenting shortcuts while the single-version view is
  // up; teardown unregisters them, so motion is gone in compare mode. Depends only
  // on showDiff — the closures read cursorLine/headings/api live at dispatch, so a
  // cursor move never re-runs this effect (which would churn the registry).
  // Ctrl+d/Ctrl+u are non-bare, so the dispatcher does not suppress them in an
  // editing context; the enabled guard does, so half-page motions don't fire while
  // the composer is focused.
  $effect(() => {
    if (showDiff) return;
    const reserved = new Map(CANONICAL_KEYMAP.map((e) => [e.id, e] as const));
    const offs: Array<() => void> = [];
    for (const [id, motion] of Object.entries(CURSOR_MOTIONS)) {
      const base = reserved.get(id);
      if (base == null) continue;
      offs.push(
        shortcuts.register({
          ...base,
          run: () => moveCursor(motion),
          enabled: () => !defaultIsEditingContext(),
        }),
      );
    }
    // Commenting on the focused line / a keyboard-selected range (EXC-790): live
    // entries over EXC-786's reservations, registered in this same effect so they
    // share its compare-mode gating (unregistered once showDiff) and editing-context
    // guard. c comments the cursor line (or, in visual mode, the whole selection);
    // V enters visual line-select; Esc reconciles the two Escapes — exit visual mode
    // if active, else clear the cursor (superseding EXC-788's motion.clearCursor).
    const commentBase = reserved.get("commenting.comment");
    if (commentBase != null) {
      offs.push(
        shortcuts.register({
          ...commentBase,
          run: commentCursorLine,
          enabled: () => !defaultIsEditingContext(),
        }),
      );
    }
    const visualBase = reserved.get("commenting.visualLine");
    if (visualBase != null) {
      offs.push(
        shortcuts.register({
          ...visualBase,
          run: enterVisualMode,
          enabled: () => !defaultIsEditingContext(),
        }),
      );
    }
    // Gated on something to clear so Esc neither shadows other Esc handlers nor
    // preventDefaults with nothing to do; a focused editor keeps Esc regardless
    // (the dispatcher suppresses bare keys in an editing context).
    const clearBase = reserved.get("commenting.clear");
    if (clearBase != null) {
      offs.push(
        shortcuts.register({
          ...clearBase,
          run: clearSelectionOrCursor,
          enabled: () => searchOpen || cursorLine != null,
        }),
      );
    }
    return () => {
      for (const off of offs) off();
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

  // Collapsible ToC rail (EXC-809). The toggle is always available (whenever the
  // plan has a contents pane), and the reviewer's open/collapsed choice persists
  // across plans and reloads (tocPref.ts). Absent a saved choice, the first load
  // defaults by width — collapsed below --w-tight so a narrow window isn't
  // crushed, open otherwise. That width default is read ONCE at mount, so a later
  // resize never yanks the rail away from a reviewer mid-read; only their toggle
  // (or a saved choice) changes it. The matchMedia guard keeps the happy-dom unit
  // env (no matchMedia) on the open default.
  const tocDefaultOpen = !(
    typeof matchMedia === "function" &&
    matchMedia(`(max-width: ${TIGHT_WIDTH_PX - 1}px)`).matches
  );
  let tocPref = $state<boolean | null>(readTocOpen());
  const tocShown = $derived(tocPref ?? tocDefaultOpen);

  // The toggle only earns a place when there is a contents pane to toggle — the
  // same >=2-heading gate SourceToc self-applies (toc.ts § shouldShowToc).
  const hasToc = $derived(shouldShowToc(headings));

  function toggleToc(): void {
    tocPref = !tocShown;
    writeTocOpen(tocPref);
  }

  // The compare-toggle + plan-search shortcuts, live entries over EXC-786's
  // reservations. Registered while the single-version view is mounted (i.e. an active
  // review), so they no-op with no review; the enabled guards mirror each control's
  // own availability — `d` toggles compare only when there are versions to compare,
  // `/` opens search only in the single-version plan view, and n/N cycle only while a
  // search is committed. Mount-once: the closures read compareStore/showDiff/search*
  // live at dispatch, so a version or view change never churns the registry.
  $effect(() => {
    const reserved = new Map(CANONICAL_KEYMAP.map((e) => [e.id, e] as const));
    const offs: Array<() => void> = [];
    const toggleDiff = reserved.get("actions.toggleDiff");
    if (toggleDiff != null) {
      offs.push(
        shortcuts.register({
          ...toggleDiff,
          run: () => compare.setComparing(!compareStore.comparing),
          enabled: () => canCompare,
        }),
      );
    }
    // `/` opens the plan search (EXC-832), repurposed from EXC-789's focus-filter.
    // Plan-content only; not gated on the ToC — search needs no rail.
    const search = reserved.get("actions.search");
    if (search != null) {
      offs.push(
        shortcuts.register({
          ...search,
          run: openSearch,
          enabled: () => !showDiff,
        }),
      );
    }
    // n / N cycle matches, live while a search is committed (the field is blurred
    // then, so these bare keys reach the global dispatcher) OR when a remembered query
    // exists so they can RESUME a closed search from the cursor. Single-version only,
    // and never while an editor is focused.
    const searchNext = reserved.get("actions.searchNext");
    if (searchNext != null) {
      offs.push(
        shortcuts.register({
          ...searchNext,
          run: () => stepSearch(1),
          enabled: () =>
            !showDiff && !defaultIsEditingContext() && (searchCommitted || lastQuery !== ""),
        }),
      );
    }
    const searchPrev = reserved.get("actions.searchPrev");
    if (searchPrev != null) {
      offs.push(
        shortcuts.register({
          ...searchPrev,
          run: () => stepSearch(-1),
          enabled: () =>
            !showDiff && !defaultIsEditingContext() && (searchCommitted || lastQuery !== ""),
        }),
      );
    }
    // `\` toggles the ToC rail (EXC-830), the same toggleToc the float-chip runs.
    // Same guard as the toggle button's `{#if !showDiff && hasToc}`: inert in
    // compare mode or when the plan has no contents pane.
    const toggleSidebar = reserved.get("actions.toggleSidebar");
    if (toggleSidebar != null) {
      offs.push(
        shortcuts.register({
          ...toggleSidebar,
          run: toggleToc,
          enabled: () => !showDiff && hasToc,
        }),
      );
    }
    return () => {
      for (const off of offs) off();
    };
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
    untrack(() => onExposeScratchActions)?.({
      save: commenting.save,
      discard: commenting.discard,
      draft: commenting.draft,
    });
  });

  // The open composer's live text, reported by SourceComposer.onInput. Held here
  // so opening a different range (gutter +, a line click, a Resume marker) first
  // retains the in-progress text as a scratch instead of dropping it on the floor.
  let liveText = "";
  function openRange(start: number, end: number): void {
    commenting.cancel(liveText); // retain any in-progress text; no-op when closed
    commenting.open({ start, end });
    cursorLine = end; // a line click relocates the cursor (keyboard + mouse coherent)
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

<!-- Control row above the surface: the version-compare picker. The picker is
     always shown; its toggle disables itself when there are no other versions to
     compare (EXC-664). -->
<div class="control-row">
  <!-- Contents toggle (EXC-809): always available when the single-version surface
       has a ToC to toggle, so the reviewer can hide the outline at any width. A
       float-chip icon button matching the compare control's chrome, with its
       colour logic inverted from that control: a collapsed rail carries the
       --accent-wash marker to advertise the hidden outline, and an open rail drops
       back to the resting float-chip (see the .toc-toggle rule). -->
  {#if !showDiff && hasToc}
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="toc-toggle float-chip"
              aria-label="Toggle sidebar"
              aria-keyshortcuts={"\\"}
              aria-expanded={tocShown}
              aria-controls="plan-toc"
              onclick={toggleToc}
            >
              <Icon name="panel-left" size={14} />
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>
          {tocShown ? "Hide sidebar" : "Show sidebar"} <Kbd class="kbd-sm">\</Kbd>
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  {/if}
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
    onSetComparing={compare.setComparing}
    onSelectBase={compare.setBase}
    onSelectTarget={compare.setTarget}
    onSetDiffStyle={compare.setDiffStyle}
    onSetDiffIndicators={compare.setDiffIndicators}
  />
  {#if !compareStore.comparing}
    <!-- Working-directory path (relocated from the TopBar, EXC-807). Full cwd on
         hover; the row shows the abbreviated path. Right-aligned by the
         compare-picker's flex:1, and dropped in compare mode so the picker's own
         display toggles reclaim the right edge. -->
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <div {...props} class="cwd mono">{shortCwd(review.cwd)}</div>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{review.cwd}</Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  {/if}
</div>

<div class="diff-surface">
  <!-- The vim `/` search dock (EXC-832), top-right of the plan (single-version only).
       Absolutely positioned within .diff-surface so it stays put over the scrolling
       plan. Holds either the "/ to search" hint chip (Show Hints on) or the open search
       pill; pressing `/` swaps the chip for the pill, which expands from this same
       top-right corner (its CSS enter animation), reading as the chip growing into the
       field. Esc/✕ swaps back to the chip. -->
  {#if !showDiff}
    <div class="search-dock">
      {#if searchOpen}
        <PlanSearch
          bind:query={searchQuery}
          matchCount={searchMatches.length}
          currentIndex={searchIndex}
          committed={searchCommitted}
          oncommit={commitSearch}
          onnext={() => stepSearch(1)}
          onprev={() => stepSearch(-1)}
          onclose={closeSearch}
        />
      {:else if showShortcutHints}
        <div class="search-hint" role="note">
          <Kbd class="kbd-sm">/</Kbd>
          <span>to search</span>
        </div>
      {/if}
    </div>
  {/if}
  <!-- The contents pane and gutter composer are the single-version surface only.
       Compare mode is a clean diff with no ToC, no gutter, no annotations. -->
  {#if !showDiff && hasToc}
    <div id="plan-toc" class="toc-rail" class:collapsed={!tocShown}>
      <SourceToc {headings} {activeLine} onJump={(line) => api?.scrollToLine(line)} />
    </div>
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
          diffStyle: effectiveDiffStyle,
          diffIndicators: compareStore.diffIndicators,
        }}
      />
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
        {fileRefs}
        onFileRefEnter={showFileRef}
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
        {cursorLine}
        {searchMatches}
        currentMatchIndex={searchIndex}
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
      <!-- The filename-reference hover preview (EXC-687): a viewport-fixed card
           showing the referenced file's excerpt, anchored to the hovered token.
           Only appears for references the daemon resolved to a real file. -->
      {#if hoveredFileRef}
        <FilePreview
          reviewId={reviewId}
          path={hoveredFileRef.path}
          line={hoveredFileRef.line}
          anchor={hoveredFileRef.anchor}
        />
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
          <div use:slotInto={{ host, line: pending.endLine }}>
            <SourceComposer
              startLine={pending.startLine}
              endLine={pending.endLine}
              initial={pendingText}
              onInput={(text) => (liveText = text)}
              onSubmit={(comment) => commenting.submit(comment)}
              onKeep={(text) => commenting.cancel(text)}
              onDiscard={() => commenting.discardOpen()}
            />
          </div>
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
      {#each scratches as scratch (scratch.key)}
        {#if pending?.endLine !== scratch.endLine}
          <div use:slotInto={{ host, line: scratch.endLine }}>
            <SourceScratchMarker text={scratch.text} onResume={() => resumeScratch(scratch.key)} />
          </div>
        {/if}
      {/each}
      <!-- One-time hint: rendered last so it sticks to the bottom of the scroll
           viewport, reading as ambient guidance. Surfaces the drag-to-comment
           gesture on first gutter hover, retired for good once the reviewer drags. -->
      {#if hintVisible}
        <div class="drag-hint" role="note">Drag across lines to comment on a range — hold Shift to select text.</div>
      {/if}
      <!-- Visual line-select affordance (EXC-790): while V mode is active, a quiet
           bottom-pinned chip names the two keys — c commits the selection to a
           comment, Esc cancels — rendered as shadcn Kbd keycaps. Shares the
           drag-hint's chip chrome; the amber selection band already shows the range. -->
      {#if visualAnchor != null && showShortcutHints}
        <div class="visual-hint" role="note">
          Selecting lines — <Kbd class="kbd-sm">c</Kbd> comment · <Kbd class="kbd-sm">Esc</Kbd> cancel
        </div>
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
     pushed to the right edge. The left padding is the rail's inner padding
     (SourceToc's 0.75rem), not the row's usual clamp inset, so the first control
     (the contents toggle) left-aligns with the filter input directly below it —
     both then sit 0.75rem from the shared surface edge. */
  .control-row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.5rem clamp(1rem, 3vw, 2rem) 0.5rem 0.75rem;
    border-bottom: 1px solid var(--rule);
    background: var(--paper-raised);
    /* As a .shell grid item this row defaults to min-width:auto, which floors it
       at its content's intrinsic width — so a long .cwd would push the whole app
       past the MIN_APP_WIDTH_PX (480) floor instead of ellipsising. min-width:0
       lets the row shrink so the .cwd's own overflow:ellipsis takes over — the
       same automatic-minimum footgun the topbar's min-width:0 fix addressed
       (EXC-810/EXC-814). */
    min-width: 0;
  }

  /* The narrow-width contents toggle (EXC-809): a float-chip icon button sized to
     the compare row's control height (1.75rem). The two states below invert the
     compare toggle's colour logic (see there) — the box and centering are all
     that's set here. flex: none keeps it from shrinking as the row tightens. */
  .toc-toggle {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
  }
  /* Inverted from the compare toggle on purpose: a HIDDEN rail (aria-expanded
     false) wears the amber active marker (--accent-wash) to advertise the tucked-
     away outline, while a SHOWN rail drops to the resting float-chip so the open,
     expected state reads quiet. The .control-row prefix lifts specificity over
     app.css's neutral button.float-chip[aria-expanded="true"] brightening (which
     would otherwise light up the shown state); each state keeps a :hover variant
     so the button still responds to the pointer. */
  .control-row .toc-toggle[aria-expanded="false"]:not(:disabled),
  .control-row .toc-toggle[aria-expanded="false"]:not(:disabled):hover {
    background: var(--accent-wash);
    color: var(--ink);
  }
  .control-row .toc-toggle[aria-expanded="true"]:not(:disabled) {
    background: var(--chip);
    color: var(--ink-soft);
  }
  .control-row .toc-toggle[aria-expanded="true"]:not(:disabled):hover {
    background: var(--chip-hover);
    color: var(--ink);
  }
  /* The compare picker now owns the bar: it spans the row so the "Compare
     versions" toggle sits at the left, and its display toggles (margin-left: auto,
     in compare mode) reach the right edge. */
  .control-row :global(.compare-picker) {
    flex: 1;
  }
  /* The working-directory path, relocated from the TopBar (EXC-807). The
     compare-picker's flex:1 pushes it to the row's right edge; it shrinks to an
     ellipsis on narrow widths (the tooltip still carries the full path). Muted
     .mono chrome, matching its former TopBar treatment. */
  .cwd {
    flex: 0 1 auto;
    min-width: 0;
    color: var(--ink-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
    /* Returning to plan review (leaving compare mode) re-mounts the path, so it
       reveals with the same quick slide-in the compare controls use when
       entering (VersionComparePicker's compare-reveal, EXC-808) — the switch now
       reads symmetric in both directions. The global #app reduced-motion guard
       zeroes it. */
    animation: cwd-reveal var(--dur-base) var(--ease-out);
  }
  @keyframes cwd-reveal {
    from {
      opacity: 0;
      transform: translateX(-4px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  /* The contents pane and source view share one row; the pane is a fixed-width
     left lane, the source view takes the rest and scrolls on its own. */
  .diff-surface {
    display: flex;
    min-height: 0;
    overflow: hidden;
    /* Positioning context for the search dock (EXC-832), which floats over the plan. */
    position: relative;
  }

  /* The search dock: pinned to the top-right of the plan area, clear of the scrollbar,
     above the plan's own sticky rails (drag readout/hints are z-index 3). It sits
     outside the .diff-plan scroller so it never scrolls with the content. Right-anchored
     so the hint chip and the (wider) search pill grow from the same corner. */
  .search-dock {
    position: absolute;
    top: 0.5rem;
    right: 0.85rem;
    z-index: 4;
  }

  /* The "/ to search" discovery chip (EXC-832): the collapsed state of the search pill,
     wearing the same float-chip surface so `/` reads as expanding this chip into the
     field. Shown only with the Show Hints setting on; fades in on mount. */
  .search-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.6rem;
    background: color-mix(in lab, var(--paper-raised), transparent 6%);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    color: var(--ink-soft);
    font-size: var(--text-sm);
    white-space: nowrap;
    user-select: none;
    animation: search-hint-in var(--dur-fast) var(--ease-out);
  }
  @keyframes search-hint-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* The ToC rail lane (EXC-809). A fixed 15rem flex lane whose width animates to 0
     on collapse, so the flex row reflows every frame and .diff-plan (flex: 1)
     slides in to fill the space rather than jumping. overflow: hidden clips the
     rail as the lane narrows (a wipe, not a squish) — the inner .source-toc is
     pinned to its full width below so it stays put while the lane closes over it.
     Collapsing by width (not display:none / unmount) keeps the rail's filter and
     the parent's active-line tracking intact across a round-trip. The global #app
     reduced-motion guard zeroes the transition, so it snaps when the OS asks. */
  .toc-rail {
    flex: none;
    display: flex;
    width: 15rem;
    overflow: hidden;
    transition: width var(--dur-base) var(--ease-out);
  }
  .toc-rail.collapsed {
    width: 0;
  }
  /* Pin the rail to its full width so the animating lane clips it rather than
     flex-shrinking its content; the flex parent stretches it to full height. */
  .toc-rail > :global(.source-toc) {
    flex: 0 0 15rem;
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

  /* The one-time drag hint and the visual-select affordance hint share one chip:
     sticky at the bottom of the viewport so each reads as ambient guidance rather
     than blocking the surface it describes, in quiet paper-raised chrome — a nudge,
     not the amber action affordance. The visual-hint's inline Kbd keycaps flow in
     the sentence, picking up the chip's ink-soft colour. */
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
