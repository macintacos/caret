<script lang="ts">
  // Shows e.g. "v2" once a plan has been revised. No diff UI (out of scope).
  let { version }: { version: number } = $props();
</script>

{#if version > 1}
  <span class="version" title="Revision {version} of this plan">
    <span class="caret">^</span>v{version}
  </span>
{/if}

<style>
  .version {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--accent);
    background: var(--accent-wash);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: 99px;
    padding: 0.1rem 0.5rem;
    display: inline-flex;
    align-items: baseline;
    gap: 0.05rem;
  }
  .caret {
    font-weight: 700;
    transform: translateY(1px);
  }
</style>
