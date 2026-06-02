<script lang="ts">
  // Shown when no pending reviews remain (initial load or after resolving all).
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
      Not connected to the caret daemon. Make sure it's running, then this will
      update automatically.
    </p>
  {/if}
  <div class="hint mono">listening &middot; polling /api/reviews</div>
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
    font-family: var(--font-display);
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
    font-family: var(--font-display);
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
  .hint {
    margin-top: 2rem;
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
