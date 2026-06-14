<script lang="ts">
  // EXC-556: a "local build" pill shown when the daemon runs from source
  // (mise run dev / the e2e harness / a manual `bun src/cli.ts`) rather than a
  // compiled release, so a dev build is never mistaken for a real review. Driven
  // by /api/health's isDev flag; self-gates so callers pass it unconditionally.
  let { isDev }: { isDev: boolean } = $props();
</script>

{#if isDev}
  <span
    class="dev-badge metric"
    title="Running from a local source build (mise run dev) — not an installed release"
  >
    local build
  </span>
{/if}

<style>
  .dev-badge {
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--accent-ink);
    background: var(--accent);
    border-radius: 99px;
    padding: 0.1rem 0.5rem;
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
  }
</style>
