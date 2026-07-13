<script lang="ts">
  // Shown when no pending reviews remain (initial load or after resolving all).
  //
  // EXC-763: rebuilt on the shadcn Empty container (+ EmptyHeader / EmptyMedia
  // structure), so the empty screen reads as one system with the rest of the
  // shadcn-migrated UI. The bespoke brand moment stays custom: the ^ hero glyph
  // (amber, 6rem, floating), the metric status pill, and the connection warning
  // are authored as scoped elements inside the Empty (a class passed to a shadcn
  // child component carries no scope hash, so the brand styling lives on our own
  // elements). The title stays a real <h2> — the correct heading semantics, and
  // the anchor 8 e2e specs locate via getByRole("heading", …).
  import { Empty, EmptyHeader, EmptyMedia } from "$lib/components/ui/empty/index.js";
  import Icon from "./Icon.svelte";

  let { connected = true }: { connected?: boolean } = $props();
</script>

<Empty class="empty">
  <EmptyHeader>
    <EmptyMedia>
      <span class="glyph" aria-hidden="true">^</span>
    </EmptyMedia>
    <h2 class="title">No plans awaiting review</h2>
    {#if connected}
      <p class="body">When an agent proposes a plan, it will appear here for inline review and approval. This window stays open and listening.</p>
    {:else}
      <p class="body warn">
        <Icon name="unplug" size={14} />Not connected to the caret daemon. Make sure it's running, then this will update automatically.
      </p>
    {/if}
  </EmptyHeader>
  <div class="hint metric">listening &middot; polling /api/reviews</div>
</Empty>

<style>
  .glyph {
    font-family: var(--font-mono);
    /* Display one-off: the hero ^ glyph sits well above the type scale. */
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
  .title {
    font-weight: 500;
    /* Display one-off: the empty-state title sits a step above any chrome. */
    font-size: 1.7rem;
    margin: 0;
    color: var(--ink);
  }
  .body {
    margin: 0;
    color: var(--ink-soft);
  }
  /* The disconnected copy warms to the accent and leads with the unplug icon. */
  .warn {
    color: var(--accent);
  }
  .warn :global(.icon) {
    vertical-align: -0.15em;
    margin-right: 0.3rem;
  }
  /* The status pill shares the badge vocabulary: the same --paper-raised surface
     on a --rule hairline, mono family + tabular figures from the shared .metric
     atom (so any digits line up exactly as they do in the badges). */
  .hint {
    display: inline-flex;
    align-items: center;
    font-size: var(--text-xs);
    line-height: var(--leading-none);
    letter-spacing: 0.02em;
    color: var(--ink-faint);
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: 99px;
    padding: 0.22rem 0.7rem;
  }
</style>
