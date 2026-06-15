<script lang="ts">
  // Single-document source view: a thin Svelte shell over @pierre/diffs'
  // File class. All imperative lifecycle work lives in the controller
  // (instance.ts); this component only binds the container and feeds prop
  // changes through sync().
  import { File, type FileContents } from "@pierre/diffs";
  import { createDiffViewLifecycle } from "./instance.ts";
  import { createLineDrag } from "./lineDrag.ts";
  import { shouldCommentOnLineClick } from "./annotationSlot.ts";
  import { type ComposedTokenHandlers, composeTokenHandlers } from "./linkInteractions.ts";
  import { type LinkSpanMap, openLinkInNewTab } from "./links.ts";
  import { type SourceViewGutter, type SourceViewLibOptions, toFileOptions } from "./options.ts";
  import { scrollToLine } from "./scroll.ts";
  import { preloadFenceLanguages, scanFenceLanguages } from "./languages.ts";
  import { registerCaretDiffThemes } from "./theme.ts";
  import type {
    SourceDocument,
    SourceLineAnnotation,
    SourceViewApi,
    SourceViewOptions,
  } from "./types.ts";

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
  }

  let {
    doc,
    contentKey,
    options = {},
    annotations,
    links,
    openUrl = openLinkInNewTab,
    onReady,
    gutter,
    onLineComment,
    onLineRangeComment,
    onLineRangePreview,
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
    onReady?.({ scrollToLine: (line) => scrollToLine(el, line), host: el });
  });

  // All token-handler composition lives in composeTokenHandlers — the single
  // owner of the library's one enter/leave/click slot, the useTokenTransformer
  // flag those handlers need, and the link-click/row-click race coordination
  // (its wasLinkClick is read in handleLineClick below). The composed object
  // closes over the span map and opener, so it only changes when the link layer
  // does — a stable `links` reference keeps it referentially stable, so
  // libOptions stays change-detectable by the lifecycle.
  const token = $derived<ComposedTokenHandlers | undefined>(
    composeTokenHandlers(links, { openUrl }),
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
        lifecycle.select(null);
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
      for (const prop of ["user-select", "-webkit-user-select"]) {
        if (on) host.style.setProperty(prop, "none");
        else host.style.removeProperty(prop);
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
</script>

<div bind:this={container} class="diffview"></div>
