<script lang="ts">
  // Shown when no pending reviews remain (initial load or after resolving all).
  import Icon from "./Icon.svelte";

  let { connected = true }: { connected?: boolean } = $props();
</script>

<div class="empty">
  <div class="glyph" aria-hidden="true">^</div>
  <h2>No plans awaiting review</h2>
  {#if connected}
    <p>
      When an agent proposes a plan, it will appear here for inline review and
      approval. This window stays open and listening.
    </p>
  {:else}
    <p class="warn">
      <Icon name="unplug" size={14} />
      Not connected to the caret daemon. Make sure it's running, then this will
      update automatically.
    </p>
  {/if}
  <div class="hint">listening &middot; polling /api/reviews</div>
</div>

<style>
  .empty {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 4rem 2rem;
    color: var(--ink-soft);
  }
  .glyph {
    font-family: var(--font-mono);
    font-size: 6rem;
    line-height: 1;
    color: var(--accent);
    opacity: 0.85;
    text-shadow: 0 8px 30px var(--accent-wash);
    animation: float 4s ease-in-out infinite;
  }
  @keyframes float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8px);
    }
  }
  h2 {
    font-weight: 500;
    font-size: 1.7rem;
    margin: 1.5rem 0 0.5rem;
    color: var(--ink);
  }
  p {
    max-width: 38ch;
    margin: 0;
  }
  .warn {
    color: var(--accent);
  }
  /* Sit the unplug glyph on the first text line. .icon is scoped to
     Icon.svelte, so reach it with :global. */
  .warn :global(.icon) {
    vertical-align: -0.15em;
    margin-right: 0.15em;
  }
  .hint {
    margin-top: 2rem;
    /* Matches the .mono atom's size (0.78rem) but stays in the sans face — this
       status line is prose, not code, so it takes the size without the mono font. */
    font-size: 0.78rem;
    color: var(--ink-faint);
    border-top: 1px solid var(--rule);
    padding-top: 1rem;
  }
  @media (prefers-reduced-motion: reduce) {
    .glyph {
      animation: none;
    }
  }
</style>
