<script lang="ts">
  // Single-document source view: a thin Svelte shell over @pierre/diffs'
  // File class. All imperative lifecycle work lives in the controller
  // (instance.ts); this component only binds the container and feeds prop
  // changes through sync().
  import { File, type FileContents } from "@pierre/diffs";
  import { createDiffViewLifecycle } from "./instance.ts";
  import { type SourceViewLibOptions, toFileOptions } from "./options.ts";
  import type { SourceDocument, SourceLineAnnotation, SourceViewOptions } from "./types.ts";

  interface Props {
    /** The document to render. */
    doc: SourceDocument;
    /** Content identity (e.g. review id + version). Changing it recreates
     * the underlying view instance; any other prop change updates it in
     * place, preserving scroll and DOM state. */
    contentKey: string;
    options?: SourceViewOptions;
    annotations?: SourceLineAnnotation[];
  }

  let { doc, contentKey, options = {}, annotations }: Props = $props();

  // The container div is component markup, so the instance must not remove
  // it on cleanUp — construct container-managed (third constructor arg).
  const lifecycle = createDiffViewLifecycle<
    SourceViewLibOptions,
    SourceLineAnnotation,
    { file: FileContents }
  >({ create: (libOptions) => new File(libOptions, undefined, true) });

  let container: HTMLElement | undefined = $state();

  const libOptions = $derived(toFileOptions(options));

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
