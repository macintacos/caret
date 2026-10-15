<script lang="ts">
  // The plan preview: mounts renderPlanMarkdown's HTML as-is in one container, so its
  // div[data-source-start][data-source-end] blocks stay direct children for the
  // source-mapped features to find. DiffPlanView decides which text and when; this only
  // mounts it and sets what HTML cannot carry.
  interface Props {
    /** renderPlanMarkdown's already-sanitized HTML. Inserted unescaped. */
    html: string;
  }
  let { html }: Props = $props();

  let container = $state<HTMLDivElement>();

  $effect(() => {
    void html;
    if (!container) return;
    // `indeterminate` has no attribute form, so the sanitized HTML can't carry it.
    for (const input of container.querySelectorAll<HTMLInputElement>('input[data-task="slashed"]')) {
      input.indeterminate = true;
    }
  });

  // `error` does not bubble, hence the capture listener. Matches the source view's
  // failed image (inlineImages.ts).
  function hideFailedImage(event: Event) {
    if (event.target instanceof HTMLImageElement) event.target.hidden = true;
  }
</script>

<div class="plan-preview" bind:this={container} onerrorcapture={hideFailedImage}>{@html html}</div>

<style>
  .plan-preview {
    padding-block: 0.5rem;
    padding-inline: 2ch 0.75rem;
    font-size: var(--text-base);
    overflow-wrap: break-word;
  }
  /* The child rules are :global because {@html} content gets no Svelte scoping. */
  .plan-preview :global(pre) {
    overflow-x: auto;
    overflow-wrap: normal;
  }
  .plan-preview :global(img) {
    max-width: 100%;
  }
</style>
