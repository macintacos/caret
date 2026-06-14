<script lang="ts">
  // Single-document source view: a thin Svelte shell over @pierre/diffs'
  // File class. All imperative lifecycle work lives in the controller
  // (instance.ts); this component only binds the container and feeds prop
  // changes through sync().
  import { File, type FileContents } from "@pierre/diffs";
  import { createDiffViewLifecycle } from "./instance.ts";
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
</script>

<div bind:this={container} class="diffview"></div>
