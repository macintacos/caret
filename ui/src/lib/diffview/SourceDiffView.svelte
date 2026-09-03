<script lang="ts">
  // Two-document diff view: a thin Svelte shell over @pierre/diffs'
  // FileDiff class. Same shape as SourceView.svelte — the controller
  // (instance.ts) owns the imperative lifecycle.
  import { type FileContents, FileDiff } from "@pierre/diffs";
  import { createDiffViewLifecycle } from "$lib/diffview/instance.ts";
  import { attachFenceLanguages } from "$lib/diffview/languages.ts";
  import { type SourceDiffViewLibOptions, toFileDiffOptions } from "$lib/diffview/options.ts";
  import { scrollToDiffLine } from "$lib/diffview/scroll.ts";
  import { registerCaretDiffThemes } from "$lib/diffview/theme.ts";
  import {
    libraryContents,
    type SourceDiffLineAnnotation,
    type SourceDiffViewApi,
    type SourceDiffViewOptions,
    type SourceDocument,
  } from "$lib/diffview/types.ts";

  // Teach the library's highlighter caret's themes before the first render
  // selects them. Idempotent, so calling it from each wrapper is safe.
  registerCaretDiffThemes();

  interface Props {
    /** The before side of the diff. */
    oldDoc: SourceDocument;
    /** The after side of the diff. */
    newDoc: SourceDocument;
    /** Content identity (e.g. review id + version pair). Changing it
     * recreates the underlying view instance; any other prop change updates
     * it in place, preserving scroll and DOM state. */
    contentKey: string;
    options?: SourceDiffViewOptions;
    annotations?: SourceDiffLineAnnotation[];
    /** Fires once the view's container is bound, handing the parent an
     * imperative API (currently side-aware scroll-to-line) that closes over the
     * container. Lets callers jump the view without reaching into the library's
     * DOM. */
    onReady?: (api: SourceDiffViewApi) => void;
  }

  let { oldDoc, newDoc, contentKey, options = {}, annotations, onReady }: Props = $props();

  // The container div is component markup, so the instance must not remove
  // it on cleanUp — construct container-managed (third constructor arg).
  const lifecycle = createDiffViewLifecycle<
    SourceDiffViewLibOptions,
    SourceDiffLineAnnotation,
    { oldFile: FileContents; newFile: FileContents }
  >({ create: (libOptions) => new FileDiff(libOptions, undefined, true) });

  let container: HTMLElement | undefined = $state();

  const libOptions = $derived(toFileDiffOptions(options));

  // Hand the parent the scroll-to-line API + host once the container exists. The
  // container is stable for the component's life, and `notified` keeps this to a
  // single hand-off even though `onReady`'s identity can change across parent
  // re-renders (the parent passes an inline arrow).
  let notified = false;
  $effect(() => {
    if (container == null || notified) return;
    notified = true;
    const el = container;
    onReady?.({ scrollToLine: (line, side) => scrollToDiffLine(el, line, side) });
  });

  // Mount-once effect: reads no reactive state, returns the teardown.
  $effect(() => () => lifecycle.destroy());

  $effect(() => {
    if (container == null) return;
    lifecycle.sync({
      contentKey,
      container,
      content: {
        oldFile: libraryContents(oldDoc),
        newFile: libraryContents(newDoc),
      },
      options: libOptions,
      annotations,
    });
  });

  // Both sides are scanned together: the single-version view has usually loaded
  // these grammars already, but a language present only in the base version has
  // not been seen. See languages.ts.
  $effect(() => attachFenceLanguages(`${oldDoc.text}\n${newDoc.text}`, lifecycle.rehighlight));
</script>

<!-- data-caret-indicators="both" is caret's own flag for the combined bars+glyphs
     marker mode (the library has no "both"): it drives the library at "bars" and
     the [data-caret-indicators="both"] rules in coreStyles.ts overlay the +/-
     glyphs. Set on the shadow host so :host(...) reaches it from inside. -->
<div
  bind:this={container}
  class="diffview"
  data-caret-indicators={options.diffIndicators === "both" ? "both" : undefined}
></div>
