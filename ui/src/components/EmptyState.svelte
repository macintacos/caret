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
    /* Display one-off: the hero unplug glyph sits well above the type scale. */
    font-size: 6rem;
    line-height: var(--leading-none);
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
    /* Display one-off: the empty-state title is larger than any chrome step. */
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
  /* A quiet status chip carrying the live endpoint in the monospace technical
     voice the source-view surface uses for paths and metadata; the bordered pill
     echoes the build/version badges so the shell's status affordances cohere. */
  .hint {
    margin-top: 2rem;
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.02em;
    color: var(--ink-faint);
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: 99px;
    padding: 0.22rem 0.7rem;
  }
  @media (prefers-reduced-motion: reduce) {
    .glyph {
      animation: none;
    }
  }
</style>
