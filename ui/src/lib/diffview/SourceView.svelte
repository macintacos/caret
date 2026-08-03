<script lang="ts">
  // Single-document source view: a thin Svelte shell over @pierre/diffs'
  // File class. All imperative lifecycle work lives in the controller
  // (instance.ts); this component only binds the container and feeds prop
  // changes through sync().
  import { File, type FileContents } from "@pierre/diffs";
  import { createDiffViewLifecycle } from "$lib/diffview/instance.ts";
  import { createLineDrag } from "$lib/diffview/lineDrag.ts";
  import { shouldCommentOnLineClick } from "$lib/diffview/annotationSlot.ts";
  import type { FileRefSpan, FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
  import { tagFileRefTokens } from "$lib/diffview/fileRefTag.ts";
  import { type ComposedTokenHandlers, composeTokenHandlers } from "$lib/diffview/linkInteractions.ts";
  import { clearLinkHighlights, paintLinkHighlights } from "$lib/diffview/linkHighlight.ts";
  import { type LinkSpanMap, openLinkInNewTab } from "$lib/diffview/links.ts";
  import { type SourceViewGutter, type SourceViewLibOptions, toFileOptions } from "$lib/diffview/options.ts";
  import { followCursorLine, scrollToLine } from "$lib/diffview/scroll.ts";
  import { tagCursorRow } from "$lib/diffview/lineCursor.ts";
  import { clearSearchHighlights, paintSearchHighlights } from "$lib/diffview/searchHighlight.ts";
  import type { SearchMatch } from "$lib/diffview/planSearch.ts";
  import { type CodeBlockRange, codeBlockRanges, tagCodeBlockRows } from "$lib/diffview/codeBlocks.ts";
  import { syncCodeBlockCards } from "$lib/diffview/codeBlockScroll.ts";
  import { preloadFenceLanguages, scanFenceLanguages } from "$lib/diffview/languages.ts";
  import { registerCaretDiffThemes } from "$lib/diffview/theme.ts";
  import type {
    SourceDocument,
    SourceLineAnnotation,
    SourceViewApi,
    SourceViewOptions,
  } from "$lib/diffview/types.ts";

  // Teach the library's highlighter caret's themes before the first render
  // selects them. Idempotent, so calling it from each wrapper is safe.
  registerCaretDiffThemes();

  interface Props {
    /** The document to render. */
    doc: SourceDocument;
    /** Content identity (e.g. review id + version). Changing it recreates
     * the underlying view instance; any other prop change updates it in
     * place, preserving scroll and DOM state. */
    contentKey: string;
    options?: SourceViewOptions;
    annotations?: SourceLineAnnotation[];
    /** Opt-in link layer: per-line clickable spans for the rendered display
     * text (from buildLinkLayer). When present, a click on a link token opens
     * its URL and hovering reveals the full URL. Omit it to render plain. */
    links?: LinkSpanMap;
    /** Opens a clicked link. Defaults to a new tab with noopener,noreferrer;
     * overridable for testing. */
    openUrl?: (href: string) => void;
    /** Opt-in filename-reference layer (EXC-687): per-line spans for the resolved
     * file references in the display text. When present, the token starting each
     * reference is tagged (data-file-ref) so the override sheet draws the file
     * icon and the hover highlight; a reference whose label hides its path also
     * reveals that path in the link tooltip on hover (EXC-954). Clicking one
     * reports up so the host can show the excerpt preview (EXC-840). */
    fileRefs?: FileRefSpanMap;
    /** A token over a file reference was clicked, with the token element to
     * anchor the preview to. */
    onFileRefClick?: (ref: FileRefSpan, tokenElement: HTMLElement) => void;
    /** Fires once the view's container is bound, handing the parent an
     * imperative API (currently scroll-to-line) that closes over the container.
     * Lets callers jump the view without reaching into the library's DOM. */
    onReady?: (api: SourceViewApi) => void;
    /** Opt-in line-comment gutter: enables the built-in hover `+`, reports the
     * selected range, and renders inline annotation/composer DOM per line.
     * Omit it for a read-only view (no gutter affordance). */
    gutter?: SourceViewGutter;
    /** Opt-in row-click commenting: a plain click anywhere on a line opens a
     * comment on it. Skipped when the click lands on a link or while the reviewer
     * is selecting text. Omit it to leave lines non-interactive. */
    onLineComment?: (line: number) => void;
    /** Opt-in content-drag range commenting (EXC-639): a plain click-drag across
     * the code body selects a line span and, on release, opens a range comment for
     * it. While such a drag is active the competing native text-selection is
     * suppressed; holding Shift bows out so the browser selects text natively (the
     * copy escape-hatch). Omit it to leave content drags as plain text selection. */
    onLineRangeComment?: (startLine: number, endLine: number) => void;
    /** Reports the live drag range (ascending) on every change, or null when the
     * gesture ends, so the host can mirror it in a readout. Optional. */
    onLineRangePreview?: (range: { startLine: number; endLine: number } | null) => void;
    /** The range to keep highlighted in the library's own selection (the amber
     * selected-line bars) — typically the open composer's range. null clears it.
     * The library highlights its gutter/+ selection on its own, but never clears it
     * when caret's composer closes; mirroring the composer range here (and clearing
     * on close) keeps the highlight tied to the composer's lifetime. */
    selectedRange?: { startLine: number; endLine: number } | null;
    /** The 1-based line the keyboard cursor sits on, tagged data-caret-cursor on
     * its shadow row so the override sheet paints the cursor band (EXC-788). null
     * clears it. Distinct from selectedRange: the cursor is a persistent, neutral
     * focus marker, not the amber composer selection. */
    cursorLine?: number | null;
    /** The vim `/` search matches to highlight (EXC-832): 0-based-column spans over
     * the rendered source, painted via the CSS Custom Highlight API in the repaint
     * pass. Empty or omitted clears the highlights. */
    searchMatches?: SearchMatch[];
    /** Index of the current (active) match within `searchMatches` — painted with the
     * strong highlight while the others get the dim underlay. -1 (default) = none. */
    currentMatchIndex?: number;
  }

  let {
    doc,
    contentKey,
    options = {},
    annotations,
    links,
    openUrl = openLinkInNewTab,
    fileRefs,
    onFileRefClick,
    onReady,
    gutter,
    onLineComment,
    onLineRangeComment,
    onLineRangePreview,
    selectedRange = null,
    cursorLine = null,
    searchMatches,
    currentMatchIndex = -1,
  }: Props = $props();

  // The container div is component markup, so the instance must not remove
  // it on cleanUp — construct container-managed (third constructor arg).
  const lifecycle = createDiffViewLifecycle<
    SourceViewLibOptions,
    SourceLineAnnotation,
    { file: FileContents }
  >({ create: (libOptions) => new File(libOptions, undefined, true) });

  let container: HTMLElement | undefined = $state();

  // Hand the parent the scroll-to-line API + host once the container exists. The
  // container is stable for the component's life, and `notified` keeps this to a
  // single hand-off even though `onReady`'s identity can change across parent
  // re-renders (the parent passes an inline arrow).
  let notified = false;
  $effect(() => {
    if (container == null || notified) return;
    notified = true;
    const el = container;
    onReady?.({
      scrollToLine: (line) => scrollToLine(el, line),
      followCursorLine: (line) => followCursorLine(el, line),
      host: el,
    });
  });

  // All token-handler composition lives in composeTokenHandlers — the single
  // owner of the library's one enter/leave/click slot, the useTokenTransformer
  // flag those handlers need, and the link-click/row-click race coordination
  // (its wasLinkClick is read in handleLineClick below). The composed object
  // closes over the span map and opener, so it only changes when the link layer
  // does — a stable `links` reference keeps it referentially stable, so
  // libOptions stays change-detectable by the lifecycle.
  const token = $derived<ComposedTokenHandlers | undefined>(
    composeTokenHandlers(links, fileRefs, { openUrl, onFileRefClick }),
  );

  const handleLineClick: NonNullable<SourceViewLibOptions["onLineClick"]> = (props) => {
    // The code renders in an open shadow root; window.getSelection() can't observe
    // a selection inside it, so prefer the shadow root's own getSelection() (a
    // Chromium extension) and fall back to the document selection. In practice a
    // drag-select also suppresses the click that drives this handler, so the guard
    // is a backstop rather than the sole defense.
    const root = container?.shadowRoot as
      | (ShadowRoot & { getSelection?: () => Selection | null })
      | undefined;
    const selection = root?.getSelection?.() ?? (typeof getSelection === "function" ? getSelection() : null);
    const open = shouldCommentOnLineClick({
      numberColumn: props.numberColumn,
      linkConsumed: token?.wasLinkClick(props.event) ?? false,
      selectionCollapsed: selection == null || selection.isCollapsed,
    });
    if (open) onLineComment?.(props.lineNumber);
  };
  const lineClick = $derived(onLineComment == null ? undefined : handleLineClick);

  const libOptions = $derived(toFileOptions(options, token, gutter, lineClick));

  // Mount-once effect: reads no reactive state, returns the teardown.
  $effect(() => () => lifecycle.destroy());

  $effect(() => {
    if (container == null) return;
    lifecycle.sync({
      contentKey,
      container,
      content: { file: { name: doc.name, contents: doc.text } },
      options: libOptions,
      annotations,
    });
  });

  // Fenced-code highlighting. The library highlights the doc as one "markdown"
  // file and never attaches the grammars its fenced blocks reference, so code
  // fences render as a single un-tokenized color. Scan the rendered text for the
  // languages its fences use, attach those grammars to the shared highlighter,
  // then force one re-highlight so the now-resolvable fences light up. Re-runs on
  // content change; a no-op when the plan has no code or the grammars are already
  // attached (preload reports nothing newly loaded). See languages.ts.
  $effect(() => {
    const langs = scanFenceLanguages(doc.text);
    if (langs.length === 0) return;
    let cancelled = false;
    void preloadFenceLanguages(langs).then((loaded) => {
      if (loaded && !cancelled) lifecycle.rehighlight();
    });
    return () => {
      cancelled = true;
    };
  });

  // Content-drag range commenting (EXC-639). The @pierre/diffs view only starts a
  // line selection from the gutter and never opens the composer, so caret owns the
  // drag across the code *body*: the pure lineDrag controller decides the range,
  // this effect feeds it real pointer events, mirrors the live range into the
  // library's own selection highlight (lifecycle.select) so it reads identically
  // to a gutter drag, suppresses the competing native text-selection for a plain
  // drag, and reports preview + commit up. Holding Shift bows out so the browser
  // selects text natively (the copy escape-hatch).
  // Range commenting is opt-in: a read-only view passes no onLineRangeComment. The
  // derived (not the raw prop) keeps the effect below tracking a stable boolean, so
  // it sets up once instead of re-running each time the parent re-renders and the
  // inline onLineRangeComment arrow gets a fresh identity.
  const rangeCommentingEnabled = $derived(onLineRangeComment != null);

  function lineAtPoint(clientX: number, clientY: number): number | null {
    const root = container?.shadowRoot;
    if (root == null) return null;
    const el = root.elementFromPoint(clientX, clientY);
    if (!(el instanceof Element)) return null;
    // The gutter number column is the library's own drag; the body initiates ours.
    if (el.closest("[data-column-number],[data-gutter-utility-slot]")) return null;
    const row = el.closest("[data-line]");
    const n = row == null ? Number.NaN : Number.parseInt(row.getAttribute("data-line") ?? "", 10);
    return Number.isFinite(n) ? n : null;
  }

  $effect(() => {
    const host = container;
    if (host == null || !rangeCommentingEnabled) return;
    const drag = createLineDrag({
      lineFromPoint: lineAtPoint,
      onPreview: (range) => {
        lifecycle.select(range == null ? null : { start: range.startLine, end: range.endLine });
        onLineRangePreview?.(range);
      },
      onCommit: (range) => {
        // The controller already cleared the drag highlight via onPreview(null); the
        // composer that opens here re-highlights the range through `selectedRange`.
        onLineRangeComment?.(range.startLine, range.endLine);
      },
    });

    // A plain body drag must not paint the browser's native text selection over the
    // span it is range-selecting. selectstart is not a composed event, so a document
    // listener never sees selections that begin inside the library's shadow root;
    // instead user-select:none is set on the host for the drag's lifetime. user-select
    // is inherited, so it reaches the shadow content (the library only sets it on its
    // change-indicator pseudo, never the code body). Shift+drag never arms, so it
    // still selects text natively (the copy escape-hatch); suppression is cleared on
    // every terminator — pointerup, pointercancel, window blur (release outside the
    // window) — so it can never wedge on. The controller owns the arm decision.
    const onMove = (e: PointerEvent) => drag.pointermove(e);
    function suppressNativeSelect(on: boolean): void {
      // host is null-checked at the guard above and is const, but TS doesn't carry
      // that narrowing into this nested closure, so assert it here.
      for (const prop of ["user-select", "-webkit-user-select"]) {
        if (on) host!.style.setProperty(prop, "none");
        else host!.style.removeProperty(prop);
      }
    }
    function endGesture(): void {
      suppressNativeSelect(false);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancelGesture);
      window.removeEventListener("blur", onCancelGesture);
    }
    function onUp(e: PointerEvent): void {
      drag.pointerup(e);
      endGesture();
    }
    function onCancelGesture(): void {
      drag.cancel();
      endGesture();
    }
    const onDown = (e: PointerEvent) => {
      if (!drag.pointerdown(e)) return; // not a plain primary press on the code body
      suppressNativeSelect(true);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancelGesture);
      window.addEventListener("blur", onCancelGesture);
    };

    host.addEventListener("pointerdown", onDown);
    return () => {
      host.removeEventListener("pointerdown", onDown);
      drag.cancel(); // mid-drag teardown: clear the controller + the library highlight
      endGesture();
    };
  });

  // Keep the library's selection highlight tied to the open composer. The library
  // highlights its own gutter/+ selection but never clears it when caret's composer
  // closes, so reflect the composer's range (or null) into setSelectedLines here.
  // This tracks only `selectedRange`, which stays a stable null throughout a gutter
  // drag, so it never clobbers the library's own in-drag highlight — it acts only as
  // a composer opens or closes.
  $effect(() => {
    lifecycle.select(
      selectedRange == null ? null : { start: selectedRange.startLine, end: selectedRange.endLine },
    );
  });

  // Fenced-code-block panel decoration (EXC-692). The library paints no per-line
  // code marker, so caret tags the shadow-DOM content rows (data-code-line / -start
  // / -end) that the panel CSS in coreStyles.ts styles. The rows are library-owned
  // and repaint (async highlight, fenced-code rehighlight, content updates), so this
  // mirrors bracket.ts's self-contained-observer shape: tag once, then re-tag on any
  // shadow-content change, rAF-coalesced. Only childList is observed, and tagging
  // writes attributes (not nodes), so it can never re-trigger itself. Re-runs when
  // the ranges change (new content) or the container mounts.
  // Memoize the ranges on the rendered text so an unchanged poll tick yields the
  // SAME array reference — the parent passes a fresh `doc` literal each render, and
  // without this the observer effect below would re-arm (disconnect + reconnect the
  // MutationObserver) every tick. Mirrors DiffPlanView's linkLayer/headings memo.
  let rangesMemo: { text: string; ranges: CodeBlockRange[] } | undefined;
  const codeRanges = $derived.by(() => {
    if (rangesMemo?.text !== doc.text) {
      rangesMemo = { text: doc.text, ranges: codeBlockRanges(doc.text) };
    }
    return rangesMemo.ranges;
  });

  // The keyboard cursor's line (EXC-788). Mirrored into a plain (non-reactive)
  // let so the repaint observer's tag() below re-applies the cursor tag after a
  // library row rewrite WITHOUT re-arming the observer on every cursor move —
  // reading a rune there would re-run that effect (and disconnect/reconnect the
  // MutationObserver) on each j/k. This reactive effect owns applying a move; the
  // observer's tag() only re-applies the mirror after a repaint.
  let cursorMirror: number | null = null;
  $effect(() => {
    cursorMirror = cursorLine;
    tagCursorRow(container?.shadowRoot ?? null, cursorLine);
  });

  // The vim `/` search highlights (EXC-832), the same non-reactive-mirror pattern as
  // the cursor above: this reactive effect paints on every match/index change, and
  // the repaint observer's tag() re-applies from the mirror after a library row
  // rewrite — without re-arming this effect (or the observer) on each keystroke.
  // paintSearchHighlights clears-then-sets internally, so this stays self-cleaning.
  let searchMirror: SearchMatch[] = [];
  let searchIndexMirror = -1;
  $effect(() => {
    searchMirror = searchMatches ?? [];
    searchIndexMirror = currentMatchIndex;
    const root = container?.shadowRoot;
    if (root != null) paintSearchHighlights(root, searchMirror, searchIndexMirror);
  });

  // Clear the document-global search + link highlights when this view unmounts
  // (compare toggle, review switch) so they don't linger over a torn-down shadow
  // root.
  $effect(() => () => {
    clearSearchHighlights();
    clearLinkHighlights();
  });

  // Stable empty maps for the "no file references" / "no link layer" cases, so the
  // tagging pass still clears any prior icons or link marks without allocating
  // each repaint.
  const EMPTY_FILE_REFS: FileRefSpanMap = new Map();
  const EMPTY_LINKS: LinkSpanMap = new Map();
  $effect(() => {
    const root = container?.shadowRoot;
    if (root == null) return;
    const ranges = codeRanges;
    // Snapshot the resolved file references so the effect re-arms when the set
    // changes (a resolve completes); the file icon is tagged onto the token that
    // starts each reference (EXC-687), re-applied on every repaint alongside the
    // code-block tagging so it survives the library's row rewrites.
    const refs = fileRefs;
    // Same snapshot for the link layer: the resting-state link marks are
    // painted as a CSS Custom Highlight over the rendered rows, so they rebuild
    // alongside the tags after every repaint. `links` is memoized by the parent, so
    // this stays a stable reference and doesn't re-arm the observer each render.
    const linkSpans = links;
    let raf = 0;
    // Tag the rows, then wrap each overflowing block in its scroll card (EXC-729). Both re-run
    // after every library repaint via the observer below; syncCodeBlockCards is idempotent (an
    // already-correct block mutates nothing), so its own wrap/unwrap settles in one extra frame
    // rather than looping the observer. Tagging runs first so the rows carry data-code-line etc.
    // before they are moved into a card.
    const tag = () => {
      tagCodeBlockRows(root, ranges);
      syncCodeBlockCards(root, ranges);
      // Always run — the clear-stale pass lives inside tagFileRefTokens, so a
      // populated→empty transition still drops the prior icons.
      tagFileRefTokens(root, refs ?? EMPTY_FILE_REFS);
      // Likewise unconditional — an empty map clears the prior link marks.
      paintLinkHighlights(root, linkSpans ?? EMPTY_LINKS);
      // Re-apply the cursor tag after a repaint from the non-reactive mirror
      // (the reactive effect above owns applying a move).
      tagCursorRow(root, cursorMirror);
      // Re-paint the search highlights too: the CSS Custom Highlight ranges point at
      // the old rows the repaint just replaced, so rebuild them against the fresh DOM.
      paintSearchHighlights(root, searchMirror, searchIndexMirror);
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tag);
    };
    tag();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    // Whether a block overflows depends on the card width, so a viewport resize (the card is
    // capped but shrinks below its cap on a narrow viewport) can push a fitting block into
    // overflow or the reverse — re-run to wrap/unwrap, since a resize fires no DOM mutation the
    // observer above would catch.
    const resize = new ResizeObserver(schedule);
    if (container != null) resize.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      resize.disconnect();
    };
  });
</script>

<div bind:this={container} class="diffview"></div>
