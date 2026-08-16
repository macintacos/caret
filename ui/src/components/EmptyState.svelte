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
  //
  // EXC-381: a sourced carrot fact rotates in a faint line docked above the
  // status bar. It is our own scoped element for the same reason the glyph and
  // the pill are, and being `position: fixed` it takes no part in the Empty's
  // centered flex layout — it renders inside the Empty only because this
  // component must keep a single root (App.svelte pins `.shell > .empty` to a
  // grid row).
  import { tick } from "svelte";

  import { createFactBag, ROTATE_MS } from "$lib/carrotFacts.ts";
  import { Empty, EmptyHeader, EmptyMedia } from "$lib/components/ui/empty/index.js";
  import Icon from "@/components/Icon.svelte";

  let {
    connected = true,
    /** Injected so a unit can prove rotation without a 50-second wait. */
    rotateMs = ROTATE_MS,
  }: { connected?: boolean; rotateMs?: number } = $props();

  const bag = createFactBag();
  let fact = $state(bag.next());
  let leaving = $state(false);
  let factEl: HTMLParagraphElement | null = $state(null);
  const sourceHost = $derived(new URL(fact.source).hostname);

  // Let the outgoing line finish leaving before the next one is swapped in, by
  // awaiting the element's own animations rather than mirroring --dur-exit as a
  // constant — FilePreview.svelte's awaitDeparture is the same shape. Under
  // happy-dom, which runs no animations, getAnimations is absent and the swap is
  // immediate.
  async function rotate(): Promise<void> {
    leaving = true;
    await tick();
    if (factEl !== null && typeof factEl.getAnimations === "function") {
      await Promise.allSettled(factEl.getAnimations().map((animation) => animation.finished));
    }
    fact = bag.next();
    leaving = false;
  }

  $effect(() => {
    if (!connected) return;
    // The JS twin of app.css's global reduced-motion rule, which can collapse the
    // cross-fade but cannot stop the timer from swapping the text underneath a
    // reader. diffview/scroll.ts carries the same one-liner for its tweens. Read
    // once here: a preference flipped mid-wait does not stop a running timer.
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = setInterval(rotate, rotateMs);
    return () => clearInterval(timer);
  });
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
  {#if connected}
    <p class="carrot-fact" class:leaving bind:this={factEl}>
      {fact.text}
      <a href={fact.source} target="_blank" rel="noreferrer" aria-label="Source: {sourceHost}">source</a>
    </p>
  {/if}
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
  /* Viewport-pinned to the foot of the screen, docked above the status bar off
     the same --status-bar-h the comment navigator uses. Deliberately bare — the
     faintest ink at the smallest size, with no surface of its own — so it sits a
     clear step below the status pill it hangs under and never competes with the
     screen's actual job. The measure is capped because a single faint sentence
     run edge-to-edge reads as a legal footer. */
  .carrot-fact {
    position: fixed;
    left: var(--bar-inset);
    right: var(--bar-inset);
    bottom: calc(var(--status-bar-h) + 0.5rem);
    max-width: 44rem;
    margin: 0 auto;
    text-align: center;
    text-wrap: balance;
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    color: var(--ink-faint);
    transition: opacity var(--dur-enter) var(--ease-out);
  }
  .carrot-fact.leaving {
    opacity: 0;
    transition: opacity var(--dur-exit) var(--ease-in);
  }
  /* The source link stays in the faint ink — the accent is for selection and
     brand — so its resting affordance is the underline, and hover lifts the ink
     one step rather than colouring it. */
  .carrot-fact a {
    color: inherit;
    text-decoration-color: var(--rule-strong);
    text-underline-offset: 0.2em;
  }
  .carrot-fact a:hover {
    color: var(--ink-soft);
    text-decoration-color: currentColor;
  }
</style>
