<script lang="ts">
  let { html }: { html: string } = $props();

  let container: HTMLDivElement;

  $effect(() => {
    void html;
    // `indeterminate` has no attribute form, so the sanitized HTML can't carry it.
    for (const input of container.querySelectorAll<HTMLInputElement>('input[data-task="slashed"]')) {
      input.indeterminate = true;
    }
  });
</script>

<div class="plan-preview" bind:this={container}>{@html html}</div>

<style>
  /* The child rules are :global because {@html} content gets no Svelte scoping. */
  .plan-preview {
    padding-block: 0.5rem;
    padding-inline: 2ch 0.75rem;
    font-size: var(--text-base);
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .plan-preview :global(pre) {
    overflow-x: auto;
    overflow-wrap: normal;
  }
  .plan-preview :global(img) {
    max-width: 100%;
  }
</style>
