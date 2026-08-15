<script lang="ts">
  // Source-view plan surface: renders the active plan version's stored text as
  // line-numbered markdown source through the diffview SourceView wrapper, with
  // a heading breadcrumbs bar in the control row and a line gutter for creating
  // comments. The bar jumps the source view to a heading's line. Hovering a line
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
  // wrapper, switching the split/unified layout at runtime. The breadcrumbs bar,
  // gutter, and inline annotation cards belong to the single-version view only —
  // compare mode is a clean diff surface with none of them; the compared versions'
  // comments surface in the docked panel instead, revealing their line on the side
  // they belong to for the two rendered versions and listing non-interactively for
  // anything in between.
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
  import { resolveFileRefs } from "$lib/api.ts";
  import { shortCwd } from "$lib/cwd.ts";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { buildLinkLayer } from "$lib/diffview/links.ts";
  import { readDiffStyle, writeDiffStyle } from "$lib/diffStylePref.ts";
  import { readDiffIndicators, writeDiffIndicators } from "$lib/diffIndicatorsPref.ts";
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
  import { bind, defaultIsEditingContext, shortcuts } from "$lib/shortcuts/index.ts";
  import type { CursorMotion } from "$lib/diffview/lineCursor.ts";
  import { activeHeadingLine, extractHeadings, lineForSlug, slugForLine } from "$lib/toc.ts";
  import { NARROW_WIDTH_PX } from "$lib/layout.ts";
  import {
    clampDrawerSize,
    DEFAULT_DRAWER_SHARE,
    type DrawerEdge,
    readDrawerSize,
    writeDrawerSize,
  } from "$lib/fileDrawer.ts";
  import { lineAtReadingZone, REVEAL_MARGIN_BOTTOM, revealScrollDelta } from "$lib/diffview/scroll.ts";
  import {
    type Annotation,
    type ClientReview,
    type FileRefKind,
    isLegacyAnnotation,
    isLineAnnotation,
  } from "@core/lib/types";
  import SourceComposer from "@/components/SourceComposer.svelte";
  import SourceScratchMarker from "@/components/SourceScratchMarker.svelte";
  import SourceAnnotationThread from "@/components/SourceAnnotationThread.svelte";
  import LegacyAnnotationList from "@/components/LegacyAnnotationList.svelte";
  import PlanBreadcrumbs from "@/components/PlanBreadcrumbs.svelte";
  import PlanToc from "@/components/PlanToc.svelte";
  import CodeCopyButton from "@/components/CodeCopyButton.svelte";
  import FileDrawer from "@/components/FileDrawer.svelte";
  import FilePreview from "@/components/FilePreview.svelte";
  import FolderTree from "@/components/FolderTree.svelte";

  interface Props {
    /** The review whose current plan version is rendered. */
    review: ClientReview;
    /** Copy the review's working directory to the clipboard (EXC-850). App.svelte
     * does the write + fires the success alert; the compare-row path calls this
     * on click. */
    onCopyCwd: (cwd: string) => void;
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
    /** Hand the host a reveal(line, side) action once the source view mounts, so a
     * sibling (the comment navigator) can scroll to a commented line. The side is
     * read only while comparing, where a line number alone names a row on either
     * document; the single-version view ignores it. A call before the view paints
     * is a bounded-retry no-op. */
    onExposeReveal?: (reveal: (line: number, side?: DiffSide) => void) => void;
    /** Report the compared versions upward (null when not comparing), so App can
     * point the single CommentNavigator instance at the cross-version index.
     * `before`/`after` name the two documents the diff renders — not a sorted
     * range — so the panel can tell which side a comment's version is on. Compare
     * state lives here (compareStore), but the panel is a root sibling of .shell —
     * same expose-upward idiom as onExposeReveal. */
    onCompareChange?: (versions: { before: number; after: number } | null) => void;
    /** The active caret theme, forwarded to the shadow-DOM diff view so its shiki
     * highlighting is painted in the selected palette (EXC-730, EXC-752). Omitted
     * leaves the library on caret's pair following the system preference. */
    themeId?: ThemeId;
    /** Whether the shortcut-hint affordances are shown (EXC-826); gates the V-mode
     * "c comment · Esc cancel" chip. Defaults to shown; the shortcut still fires. */
    showShortcutHints?: boolean;
    /** A counter App bumps whenever a Setting is applied (EXC-843). It's the signal
     * to re-read the persisted diff-layout/marker prefs into the compare store so an
     * open diff reflows the moment those settings change (they live here, not in a
     * mirror App can resync). */
    settingsRev?: number;
  }

  let {
    review,
    onCopyCwd,
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
  // factory stays pure. Annotation display is never wired into the diff surface —
  // the compared versions' comments surface in the docked panel, which the host
  // drives off onCompareChange (EXC-872). The version/style
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

  // A Settings change to the diff prefs (App bumps settingsRev) re-reads them into the
  // reactive compare store, so an open diff reflows live — the immediate-apply promise
  // reaching the prefs that live in this view's own store rather than an App mirror.
  // Skipped on the initial mount (settingsRev starts 0; compare.init already seeded
  // these); the in-view picker mutates the store directly and never bumps settingsRev,
  // so its choice is never clobbered.
  $effect(() => {
    if (settingsRev === 0) return;
    compareStore.diffStyle = readDiffStyle();
    compareStore.diffIndicators = readDiffIndicators();
  });

  const canCompare = $derived(compare.canCompare(review.versions));
  const showDiff = $derived(canCompare && compareStore.comparing);

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
  // SCANNED out of the display text's inline code, and the ones the link layer
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
  // candidate map and the value-stable reviewId) hold their reference across a
  // poll tick, so an unchanged plan never re-resolves — which is what kept the
  // icons and the open hover preview from flickering every 2s. Cleared up front
  // so a plan edit or review switch drops stale icons at once.
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

  // The file reference whose preview is open (opened by clicking its token —
  // EXC-687/EXC-840), plus the token itself, which the reveal effect below
  // measures so the clicked filename stays visible beside the drawer. The
  // preview stays put once open; it closes on Escape (the dismissal effect
  // below), on the pane's own close button, and when a directory reference takes
  // its place. Compare mode hides the lane without clearing this — the dismissal
  // effect carries the matching guard.
  let filePreview = $state<
    { path: string; line?: number; endLine?: number; token: HTMLElement } | undefined
  >();

  // Dismissal plays the lane's wipe in reverse before the drawer leaves, so the
  // pane slides shut with the excerpt still in it instead of blinking out. The
  // drawer stays mounted for that beat and `drawerClosing` puts it in its closing
  // state; the timer then drops it. Must match FileDrawer's fd-close-* duration
  // (--dur-base = 180ms) — a timer rather than animationend because happy-dom
  // fires no animation events, so the unit env would strand the drawer forever.
  const CLOSE_ANIM_MS = 180;
  let drawerClosing = $state(false);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelDrawerClose(): void {
    if (closeTimer !== undefined) clearTimeout(closeTimer);
    closeTimer = undefined;
    drawerClosing = false;
  }

  /** Start the closing wipe, dropping the drawer once it has played. */
  function dismissFilePreview(): void {
    if (filePreview === undefined || drawerClosing) return;
    drawerClosing = true;
    closeTimer = setTimeout(() => {
      filePreview = undefined;
      cancelDrawerClose();
    }, CLOSE_ANIM_MS);
  }

  function openFilePreview(ref: FileRefSpan, tokenElement: HTMLElement): void {
    // Reopening mid-collapse: drop the pending unmount so the lane wipes back
    // open on the same instance rather than being torn out from under it.
    cancelDrawerClose();
    filePreview = { path: ref.path, line: ref.line, endLine: ref.endLine, token: tokenElement };
  }

  // The directory reference whose tree is open (EXC-918), plus the clicked
  // token's box. A viewport-fixed card rather than the file preview's lane: a
  // folder has no `:line` to bound it, so the surface is one to navigate rather
  // than to peek at, and it is dismissed rather than lived beside.
  //
  // The RECT rather than the element: the card places itself once and never
  // tracks the token, and the plan surface it belongs to is torn out whenever
  // compare mode opens — a detached element measures all zeros, which would park
  // the card in the viewport's corner and keep the dead subtree alive besides.
  let folderTree = $state<{ path: string; rect: DOMRect } | undefined>();

  // One reference click, two surfaces. The daemon said which this is (EXC-916),
  // so the branch is on the kind the span carries rather than on the path's shape
  // — the whole point of resolving server-side. Opening either dismisses the
  // other: the card's own effect below still swallows the clicks it dismisses on,
  // so a card left open beside a preview would put that swallow back over a lane
  // whose whole point is that clicks in the plan reach the plan.
  function openFileRef(ref: FileRefSpan, tokenElement: HTMLElement): void {
    if (ref.kind === "directory") {
      dismissFilePreview();
      folderTree = { path: ref.path, rect: tokenElement.getBoundingClientRect() };
      return;
    }
    folderTree = undefined;
    openFilePreview(ref, tokenElement);
  }

  $effect(() => () => cancelDrawerClose());

  // A review switch drops the open card. Its contents belong to the previous
  // review's cwd, and the 2s poll can swap the review under a reader who left
  // one open — so without this the card sits over a different plan describing a
  // directory tree that has nothing to do with it.
  $effect(() => {
    void reviewId;
    folderTree = undefined;
  });

  // The folder card's dismissal, mirroring the file preview's below: Escape, or a
  // click outside the card, both in the CAPTURE phase so they run before the
  // plan's own handlers. `composedPath` is what makes this work over a surface
  // behind a shadow root — a click on a tree row still carries the card.
  //
  // A click on another reference is let through UNSWALLOWED: the card closes, and
  // that same click reaches the token handler, which opens whichever surface the
  // reference it landed on calls for. Any other outside click is swallowed, so
  // dismissing the card never also opens a line comment.
  $effect(() => {
    if (folderTree === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      folderTree = undefined;
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      const path = e.composedPath();
      if (path.some((n) => n instanceof Element && n.matches("[data-folder-tree]"))) return;
      folderTree = undefined;
      if (path.some((n) => n instanceof Element && n.matches("[data-file-ref]"))) return;
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
  // own handlers. It is the keyboard half of a pair with the pane's close circle;
  // `openFileRef` dismisses too when the reader opens a directory instead. A click
  // OUTSIDE the lane deliberately does nothing here (EXC-1067) — the preview is a
  // docked lane rather than a popover, so it takes layout space beside the plan
  // instead of covering it and there is no "outside" in the modal sense to click
  // away from. The reader works in the plan with the excerpt beside them, and every
  // click they spend there does its own job on the first press. The folder card's
  // effect above keeps its outside-click dismissal: that surface IS viewport-fixed
  // over the plan, so the divergence tracks the two surfaces' shapes rather than
  // being drift.
  //
  // Gated on `showDiff` to match the pane's own render condition below, not just on
  // the state: compare mode hides the lane while leaving `filePreview` set, and an
  // unrendered pane's handler would swallow Escape from whatever the reader is
  // actually looking at.
  $effect(() => {
    if (showDiff || filePreview === undefined) return;
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
  // or after the lane's opening wipe. Its size is *bound* (a ResizeObserver under
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
    clampDrawerSize(chosenSize[drawerEdge] ?? drawerAxis * DEFAULT_DRAWER_SHARE, drawerAxis),
  );
  function setDrawerSize(px: number): void {
    chosenSize[drawerEdge] = px;
    writeDrawerSize(drawerEdge, px);
  }

  // Scroll the clicked filename clear of the drawer. Only the bottom dock can
  // cover it — a right dock shortens the plan's width, never its reading height —
  // so the inset is the lane's height there and zero otherwise. The guarantee is
  // free rather than a spacer trick: shortening .diff-plan raises its max scroll
  // by the same amount, and the EXC-772 scroll-past-the-end room means even a
  // reference on the plan's last line has somewhere to go. `drawerSize` is read
  // untracked so dragging the handle resizes the lane without also scrolling the
  // plan on every frame. `behavior: "auto"` because the lane is already
  // animating, and a competing smooth scroll reads as two motions.
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
    if (delta !== 0) scroller.scrollBy({ top: delta, behavior: "auto" });
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
  // The compare view's counterpart, captured the same way. Undefined until the
  // diff mounts, and it keeps the last instance after compare mode closes — the
  // reveal below only reaches for it while showDiff, so a stale one is inert.
  let diffApi = $state<SourceDiffViewApi | undefined>();

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

  // Re-hover the row under a stationary cursor as the plan scrolls (EXC-836). The
  // browser re-evaluates hover only on pointer MOVE, never on scroll, and the
  // @pierre/diffs view drives its row highlight (data-hovered) and gutter "+" off its
  // own pointermove — not CSS :hover — with no scroll listener of its own. So scrolling
  // the plan under a still pointer leaves both glued to the row that scrolled away.
  // Re-fire the real gesture: on scroll, synthesize a pointermove at the retained cursor
  // position into the row now beneath it. The library re-hovers that row (highlight +
  // "+"), and the composed event bubbles out to .diff-plan so the code-block copy effect
  // above re-anchors too — one re-fire drives every hover-dependent affordance.
  // rAF-throttled, and gated on pointer presence so a programmatic scroll (a vim j/k
  // motion) with the pointer away can't resurrect a stale hover.
  $effect(() => {
    const scroller = scrollEl;
    const el = host;
    if (scroller == null || el == null) return;
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
  // could clear the param before onSourceReady reads it, depending on which
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
  // two documents the line names; otherwise it is ignored and the single-version
  // view scrolls. Both read their live api, so a call before the view mounts is a
  // no-op, and both spend the same paint budget waiting for the row.
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
    retryScrollTo(line);
  }

  // Take the reviewer to a heading they picked in the breadcrumbs bar. The line
  // cursor goes with them: a pick is a deliberate move, so it relocates the cursor
  // exactly as a line click does in openRange below, and the reviewer's next
  // motion, comment or visual selection starts from the heading they chose.
  // Scrolling never lands here — the trail re-roots on the scroll observer, and
  // only a pick calls onJump — so reading around leaves the cursor untouched.
  function pickHeading(line: number): void {
    keyboardStore.cursorLine = line;
    api?.scrollToLine(line);
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

  // Hand the host the reveal(line) action once. `untrack` keeps onExposeReveal from
  // becoming a reactive dependency; revealLine closes over the live `api`, so exposing
  // it before the view paints is safe (the reveal simply no-ops until the api lands).
  $effect(() => {
    untrack(() => onExposeReveal)?.(revealLine);
  });

  // The source line of the heading currently in the reading zone. Tracked from
  // the scroll container's topmost rendered line so the breadcrumbs bar reports
  // the section being read.
  let activeLine = $state<number | null>(null);
  // The scroll container (the .diff-plan element), used by the heading tracking to
  // read the topmost visible line.
  let scrollEl = $state<HTMLElement | undefined>();
  // Opens the breadcrumbs bar's trailing crumb, handed over by the bar itself
  // (EXC-947). Undefined until the bar first mounts, and it keeps the last closure
  // afterwards — entering compare mode unmounts the bar without clearing this. What
  // makes `b` inert there is the binding's own !showDiff guard; the closure would
  // no-op anyway, since it reads a `barEl` the unmount set back to null.
  let openHeadingNav: (() => void) | undefined;

  // The plan's keyboard surface (EXC-875): the vim line cursor (EXC-788), visual
  // line-select (EXC-790), and the `/` full-text search HUD (EXC-832) in one
  // unit-testable factory (state/planKeyboard). The component owns the reactive store —
  // the runes live here — and the factory sequences the transitions over it; single-
  // version view only (compare mode is a read-only diff with no cursor). The DOM effects
  // are injected: the rendered lines, heading lines, the reading position, the half-page
  // size, scroll-follow, the composer open, and focus/blur.
  let keyboardStore = $state<PlanKeyboardStore>({
    cursorLine: null,
    visualAnchor: null,
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
    openComposer: openRange,
    focusField: focusSearchField,
    blur: () => (document.activeElement as HTMLElement | null)?.blur(),
    hintsShown: () => showShortcutHints,
  });

  // The live visual selection, ascending — mirrored into SourceView's amber band through
  // `selectedRange` while visual mode is active, so extending it with j/k grows the
  // highlight in step.
  const visualSelection = $derived(
    keyboardStore.visualAnchor != null && keyboardStore.cursorLine != null
      ? normalizeRange({ start: keyboardStore.visualAnchor, end: keyboardStore.cursorLine })
      : undefined,
  );

  // Matches for the current query over the rendered text (linkLayer.text) — the pill
  // counter, the strong highlight, and the cursor jump all read the SAME lines the
  // cursor uses, so a match's line maps straight onto the line cursor and its row.
  const searchMatches = $derived(keyboard.matches());

  // Re-track the current match to the nearest one at the reading position whenever the
  // QUERY changes while the field is being edited (search open, not yet committed) — so
  // the counter and the strong highlight follow the query live as you type or reopen.
  // Gated on !searchCommitted so a resume seed (n/N with the pill closed sets the query
  // AND commits) is not clobbered back to "nearest"; the seed (cursor / reading position)
  // is read UNTRACKED so a same-query n/N step never re-runs this.
  $effect(() => {
    void searchMatches;
    if (!keyboardStore.searchOpen || keyboardStore.searchCommitted) return;
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
  });

  // Recompute the active heading from the source line at the top of the reading
  // zone, throttled with rAF so a scroll burst settles into one read. The view
  // paints each line as <div data-line="N"> in a shadow root; lineAtReadingZone
  // picks the line sitting at the same offset jumps park headings at, so the
  // tracked section matches where a crumb jump lands rather than the heading above it.
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
  // `/` reopens the search prefilled with the last committed query and its text selected,
  // so it comes right back where you left it, yet typing immediately replaces it (like
  // browser find). On the FIRST open the pill isn't mounted yet, so this focus/select is
  // a no-op and PlanSearch's own mount step lands the caret and selection; on a REOPEN
  // over a committed HUD the pill is already mounted (its mount step won't re-fire), so
  // focusing/selecting here is what brings the field forward. Injected into the keyboard
  // factory as its focusField dep.
  function focusSearchField(): void {
    const el = document.querySelector<HTMLInputElement>("input[aria-label='Search plan']");
    el?.focus();
    el?.select();
  }
  // Clear a pending close timer if the view unmounts mid-collapse — the factory owns the
  // timer, and cancelClose tears it down.
  $effect(() => () => keyboard.cancelClose());

  // Register the live motion + commenting shortcuts while the single-version view is
  // up; teardown unregisters them, so motion is gone in compare mode. Depends only
  // on showDiff — the closures read cursorLine/headings/api live at dispatch, so a
  // cursor move never re-runs this effect (which would churn the registry).
  // Ctrl+d/Ctrl+u are non-bare, so the dispatcher does not suppress them in an
  // editing context; the enabled guard does, so half-page motions don't fire while
  // the composer is focused.
  $effect(() => {
    if (showDiff) return;
    const offs: Array<() => void> = [];
    for (const [id, motion] of Object.entries(CURSOR_MOTIONS)) {
      offs.push(
        shortcuts.register(
          bind(id, {
            run: () => keyboard.moveCursor(motion),
            enabled: () => !defaultIsEditingContext(),
          }),
        ),
      );
    }
    // Commenting on the focused line / a keyboard-selected range (EXC-790): live entries
    // bound over EXC-786's reservations, registered in this same effect so they share its
    // compare-mode gating (unregistered once showDiff) and editing-context guard. c
    // comments the cursor line (or, in visual mode, the whole selection); V enters visual
    // line-select; Esc closes search / exits visual mode but never clears the line cursor
    // (EXC-834, narrowing EXC-790's Esc reconciliation).
    offs.push(
      shortcuts.register(
        bind("commenting.comment", {
          run: () => keyboard.commentCursorLine(),
          enabled: () => !defaultIsEditingContext(),
        }),
      ),
    );
    offs.push(
      shortcuts.register(
        bind("commenting.visualLine", {
          run: () => keyboard.enterVisualMode(),
          enabled: () => !defaultIsEditingContext(),
        }),
      ),
    );
    // Gated on something to clear so Esc neither shadows other Esc handlers nor
    // preventDefaults with nothing to do; a focused editor keeps Esc regardless
    // (the dispatcher suppresses bare keys in an editing context).
    offs.push(
      shortcuts.register(
        bind("commenting.clear", {
          run: () => keyboard.clearSelectionOrCursor(),
          enabled: () => keyboardStore.searchOpen || keyboardStore.visualAnchor != null,
        }),
      ),
    );
    return () => {
      for (const off of offs) off();
    };
  });

  // Mirror the active heading's slug into `?heading=` so a copied URL reopens the
  // review at the section being read (composing with deepLink.ts's `?review=`).
  // Compare mode tracks no heading (and drops the breadcrumbs bar), so the param
  // clears there.
  // Held until restore consumes any incoming `?heading=` (see `restored`).
  $effect(() => {
    if (!restored) return;
    const slug = activeLine != null ? slugForLine(headings, activeLine) : null;
    setHeadingSlug(showDiff ? null : slug);
  });

  // The compare-toggle + plan-search shortcuts, live entries over EXC-786's
  // reservations. Registered while the single-version view is mounted (i.e. an active
  // review), so they no-op with no review; the enabled guards mirror each control's
  // own availability — `d` toggles compare only when there are versions to compare,
  // `/` opens search only in the single-version plan view, and n/N cycle only while a
  // search is committed. Mount-once: the closures read compareStore/showDiff/search*
  // live at dispatch, so a version or view change never churns the registry.
  $effect(() => {
    const offs: Array<() => void> = [];
    offs.push(
      shortcuts.register(
        bind("actions.toggleDiff", {
          run: () => compare.setComparing(!compareStore.comparing),
          enabled: () => canCompare,
        }),
      ),
    );
    // `/` opens the plan search (EXC-832), repurposed from EXC-789's focus-filter.
    // Plan-content only; not gated on the plan having headings — search is over
    // text, not structure.
    offs.push(
      shortcuts.register(
        bind("actions.search", {
          run: () => keyboard.openSearch(),
          enabled: () => !showDiff,
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
            !showDiff &&
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
            !showDiff &&
            !defaultIsEditingContext() &&
            (keyboardStore.searchCommitted || keyboardStore.lastQuery !== ""),
        }),
      ),
    );
    // `b` opens the heading breadcrumbs bar's trailing crumb (EXC-947), and `\`
    // does the same since EXC-949 retired the ToC rail it used to toggle — two
    // reservations over one action, which is how the keymap spells alternative
    // keys (see keymap.ts). Both are gated on the same `!showDiff` the bar's own
    // render condition uses, so they are inert in compare mode. The optional call
    // covers a heading-less plan too, where the bar renders nothing and never
    // handed an open action back.
    const openBar = { run: () => openHeadingNav?.(), enabled: () => !showDiff };
    offs.push(shortcuts.register(bind("actions.headingNav", openBar)));
    offs.push(shortcuts.register(bind("actions.toggleSidebar", openBar)));
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

<!-- Control row above the surface. The version-compare picker is always shown; its
     toggle disables itself when there are no other versions to compare (EXC-664).
     The heading breadcrumbs and the working-directory path each earn their place
     conditionally alongside it. -->
<div class="control-row" class:comparing={compareStore.comparing}>
  <!-- The plan's table of contents (EXC-1095): every heading at once, the
       see-the-whole-shape surface the breadcrumbs bar beside it is not. It reads
       the SAME headings and activeLine that bar does, so neither tracks a scroll
       of its own, and it is gated on the same !showDiff — compare mode tracks no
       heading, so a contents popup there would open on a stale plan. -->
  {#if !showDiff}
    <PlanToc {headings} {activeLine} onJump={pickHeading} />
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
  <!-- Heading breadcrumbs (EXC-946): where in the plan the reviewer is, and the
       menus to move sideways or deeper — the plan's only heading-navigation
       surface since EXC-949 retired the contents rail. It rides the activeLine
       the scroll observer below tracks and jumps through scrollToLine. Compare
       mode tracks no heading (and clears `?heading=`), so the bar is dropped
       there rather than left showing a stale trail. -->
  {#if !showDiff}
    <PlanBreadcrumbs
      {headings}
      {activeLine}
      {showShortcutHints}
      onJump={pickHeading}
      onExposeOpen={(open) => (openHeadingNav = open)}
    />
  {/if}
  {#if !compareStore.comparing}
    <!-- Working-directory path (EXC-807 relocated it here from the TopBar; EXC-850
         makes it click-to-copy). The row shows the abbreviated path and copies the
         full absolute path on click — no hover popup. Right-aligned by its own
         margin-left, and dropped in compare mode so the picker's display toggles
         reclaim the right edge. -->
    <button
      type="button"
      class="cwd mono"
      aria-label={`Copy path ${review.cwd} to the clipboard`}
      onclick={() => onCopyCwd(review.cwd)}>{shortCwd(review.cwd)}</button>
  {/if}
</div>

<div
  class="diff-surface"
  class:dock-bottom={drawerEdge === "bottom"}
  bind:this={surfaceEl}
  bind:clientWidth={surfaceWidth}
  bind:clientHeight={surfaceHeight}
>
  <div class="plan-pane">
    <!-- The vim `/` search dock (EXC-832), top-right of the plan (single-version only).
         Absolutely positioned within .plan-pane so it stays put over the scrolling
         plan, and so it tracks the plan's edge rather than the drawer's when one is
         open. Holds either the "/ to search" hint chip (Show Hints on) or the open search
         pill; pressing `/` swaps the chip for the pill, which expands from this same
         top-right corner (its CSS enter animation), reading as the chip growing into the
         field. Esc/✕ swaps back to the chip. -->
    {#if !showDiff}
      <div class="search-dock">
        {#if keyboardStore.searchOpen}
          <PlanSearch
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
        {:else if showShortcutHints}
          <div class="search-hint" role="note">
            <Kbd class="kbd-sm">/</Kbd>
            <span>to search</span>
          </div>
        {/if}
      </div>
    {/if}
    <!-- The gutter composer is the single-version surface only. The compare diff
         is a clean surface with no gutter and no inline annotations; the compared
         versions' comments read in the docked panel instead (EXC-872). -->
    <div class="diff-plan" bind:this={scrollEl} onmouseenter={showDragHint} role="presentation">
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
        {#if keyboardStore.visualAnchor != null && showShortcutHints}
          <div class="visual-hint" role="note">
            Selecting lines — <Kbd class="kbd-sm">c</Kbd> comment · <Kbd class="kbd-sm">Esc</Kbd> cancel
          </div>
        {/if}
      {/if}
    </div>
  </div>
  <!-- The filename-reference preview (EXC-687, docked since EXC-937): a lane
       beside the plan holding the referenced file's excerpt. It takes layout
       space rather than covering the plan, and wipes in from whichever edge it
       docked to. Only appears for references the daemon resolved to a real file;
       compare mode has no preview, so it is gated on the single-version view. -->
  {#if !showDiff && filePreview}
    <!-- Bound here because the {#if}'s narrowing does not reach into a snippet body. -->
    {@const openRef = filePreview}
    <FileDrawer
      edge={drawerEdge}
      size={drawerSize}
      available={drawerAxis}
      onResize={setDrawerSize}
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

<!-- The folder-reference tree (EXC-918). A viewport-fixed card rather than a lane
     in the surface above, so it sits outside that flex row entirely; compare mode
     has no reference affordances, so it is gated on the single-version view like
     the preview is. -->
{#if !showDiff && folderTree}
  {@const openDir = folderTree}
  <FolderTree reviewId={reviewId} path={openDir.path} anchor={openDir.rect} {showShortcutHints} />
{/if}

{#if legacyAnnotations.length > 0}
  <LegacyAnnotationList annotations={legacyAnnotations} />
{/if}

<style>
  /* The control bar above the surface. Carries the bar chrome (raised paper,
     hairline rule) for the version-compare picker: the "Compare versions" toggle
     sits at the left, and (in compare mode) the layout / indicator toggles are
     pushed to the right edge. The horizontal inset is the app's shared --bar-inset
     (the same the TopBar and the shell use), symmetric now that EXC-949 removed
     the contents rail the left edge used to align with. */
  .control-row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.5rem var(--bar-inset);
    border-bottom: 1px solid var(--rule);
    background: var(--paper-raised);
    /* The shared control height every child in the row sizes to. */
    --ctl-h: 1.75rem;
    /* As a .shell grid item this row defaults to min-width:auto, which floors it
       at its content's intrinsic width — so a long .cwd would push the whole app
       past the MIN_APP_WIDTH_PX (480) floor instead of ellipsising. min-width:0
       lets the row shrink so the .cwd's own overflow:ellipsis takes over — the
       same automatic-minimum footgun the topbar's min-width:0 fix addressed
       (EXC-810/EXC-814). */
    min-width: 0;
  }

  /* In compare mode the picker owns the bar: it spans the row so the "Compare
     versions" toggle sits at the left and its display toggles (margin-left: auto)
     reach the right edge. Reading a single version it sizes to its toggle instead,
     so the breadcrumbs sit directly beside that toggle rather than being shoved to
     the right edge by a stretched picker. The modifier tracks
     `compareStore.comparing` — the same flag the .controls cluster renders on. */
  .control-row :global(.compare-picker) {
    flex: 0 1 auto;
  }
  .control-row.comparing :global(.compare-picker) {
    flex: 1;
  }
  /* The heading breadcrumbs (EXC-946) take the row's middle and give it back
     first: min-width: 0 lets the bar shrink so its crumbs ellipsise, keeping the
     row inside the app's MIN_APP_WIDTH_PX floor the same way .cwd does below.
     It GROWS into that middle rather than sizing to its trail (EXC-957), which
     the bar's own collapse depends on: sized to content, giving a level up would
     shrink the bar, which would free room, which would bring the level back.
     Nothing moves on screen — the crumbs stay left-aligned inside the wider box,
     and the free space .cwd's margin used to absorb is now absorbed by the bar,
     which leaves .cwd on the same right edge either way. */
  .control-row :global(.plan-breadcrumbs) {
    flex: 1 1 auto;
    min-width: 0;
  }
  /* The working-directory path, relocated from the TopBar (EXC-807). It pins
     itself to the row's right edge with margin-left: auto rather than relying on a
     stretched neighbour: the picker stretches only in compare mode, and the
     breadcrumbs beside it are absent on a heading-less plan. It shrinks to an
     ellipsis on narrow widths. Muted .mono chrome, matching its former TopBar
     treatment. */
  .cwd {
    flex: 0 1 auto;
    margin-left: auto;
    min-width: 0;
    /* Button reset — it was an inline div until EXC-850 made it click-to-copy;
       .mono owns the family, so only the size is inherited here. */
    appearance: none;
    background: none;
    border: none;
    padding: 0;
    font-size: inherit;
    color: var(--ink-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* Brightens on hover to read as clickable — the affordance that replaces the
       removed full-path tooltip. */
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out);
    /* Returning to plan review (leaving compare mode) re-mounts the path, so it
       reveals with the same quick slide-in the compare controls use when
       entering (VersionComparePicker's compare-reveal, EXC-808) — the switch now
       reads symmetric in both directions. The global #app reduced-motion guard
       zeroes it. */
    animation: cwd-reveal var(--dur-base) var(--ease-out);
  }
  .cwd:hover {
    color: var(--ink-soft);
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

  /* The plan and the file drawer (EXC-937) divide this surface between them: a
     row when the drawer docks right, a column when it docks bottom. With no
     drawer open the plan pane is the only child and takes the whole thing. */
  .diff-surface {
    display: flex;
    min-height: 0;
    overflow: hidden;
  }
  .diff-surface.dock-bottom {
    flex-direction: column;
  }

  /* Everything that is the plan: the source view fills this pane and scrolls on
     its own, with the search dock floating over it. `display: flex` plus
     .diff-plan's `flex: 1` is what makes the source view fill it. The pane carries
     the positioning context rather than .diff-surface, so the dock anchors to the
     plan's own corner instead of the drawer's. */
  .plan-pane {
    position: relative;
    flex: 1 1 auto;
    display: flex;
    min-width: 0;
    min-height: 0;
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
     wearing the same sheer --paper-veil surface so `/` reads as expanding this chip
     into the field. Shown only with the Show Hints setting on; fades in on mount. */
  .search-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.6rem;
    background: var(--paper-veil);
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
