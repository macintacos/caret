<script lang="ts">
  // Single-document source view: a thin Svelte shell over @pierre/diffs'
  // File class. All imperative lifecycle work lives in the controller
  // (instance.ts); this component only binds the container and feeds prop
  // changes through sync().
  import { File, type FileContents } from "@pierre/diffs";
  import { createDiffViewLifecycle } from "./instance.ts";
  import { createLinkHandlers, type LinkHandlers } from "./linkInteractions.ts";
  import { type LinkSpanMap, openLinkInNewTab } from "./links.ts";
  import { type SourceViewGutter, type SourceViewLibOptions, toFileOptions } from "./options.ts";
  import { registerCaretDiffThemes } from "./theme.ts";
  import type { SourceDocument, SourceLineAnnotation, SourceViewOptions } from "./types.ts";

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
    /** Opt-in line-comment gutter: enables the built-in hover `+`, reports the
     * selected range, and renders inline annotation/composer DOM per line.
     * Omit it for a read-only view (no gutter affordance). */
    gutter?: SourceViewGutter;
  }

  let {
    doc,
    contentKey,
    options = {},
    annotations,
    links,
    openUrl = openLinkInNewTab,
    gutter,
  }: Props = $props();

  // The container div is component markup, so the instance must not remove
  // it on cleanUp — construct container-managed (third constructor arg).
  const lifecycle = createDiffViewLifecycle<
    SourceViewLibOptions,
    SourceLineAnnotation,
    { file: FileContents }
  >({ create: (libOptions) => new File(libOptions, undefined, true) });

  let container: HTMLElement | undefined = $state();

  // The handlers close over the span map and opener, so they only change when
  // the link layer does — a stable `links` reference keeps them referentially
  // stable, so libOptions stays change-detectable by the lifecycle.
  const linkHandlers = $derived<LinkHandlers | undefined>(
    links == null ? undefined : createLinkHandlers(links, { openUrl }),
  );

  const libOptions = $derived(toFileOptions(options, linkHandlers, gutter));

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
</script>

<div bind:this={container} class="diffview"></div>
