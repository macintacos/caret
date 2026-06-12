<script lang="ts">
  // Two-document diff view: a thin Svelte shell over @pierre/diffs'
  // FileDiff class. Same shape as SourceView.svelte — the controller
  // (instance.ts) owns the imperative lifecycle.
  import { type FileContents, FileDiff } from "@pierre/diffs";
  import { createDiffViewLifecycle } from "./instance.ts";
  import { type SourceDiffViewLibOptions, toFileDiffOptions } from "./options.ts";
  import { registerCaretDiffThemes } from "./theme.ts";
  import type {
    SourceDiffLineAnnotation,
    SourceDiffViewOptions,
    SourceDocument,
  } from "./types.ts";

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
  }

  let { oldDoc, newDoc, contentKey, options = {}, annotations }: Props = $props();

  // The container div is component markup, so the instance must not remove
  // it on cleanUp — construct container-managed (third constructor arg).
  const lifecycle = createDiffViewLifecycle<
    SourceDiffViewLibOptions,
    SourceDiffLineAnnotation,
    { oldFile: FileContents; newFile: FileContents }
  >({ create: (libOptions) => new FileDiff(libOptions, undefined, true) });

  let container: HTMLElement | undefined = $state();

  const libOptions = $derived(toFileDiffOptions(options));

  // Mount-once effect: reads no reactive state, returns the teardown.
  $effect(() => () => lifecycle.destroy());

  $effect(() => {
    if (container == null) return;
    lifecycle.sync({
      contentKey,
      container,
      content: {
        oldFile: { name: oldDoc.name, contents: oldDoc.text },
        newFile: { name: newDoc.name, contents: newDoc.text },
      },
      options: libOptions,
      annotations,
    });
  });
</script>

<div bind:this={container} class="diffview"></div>
