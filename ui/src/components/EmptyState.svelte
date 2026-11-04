<script lang="ts">
  // Shown when no pending reviews remain (initial load or after resolving all).
  //
  // EXC-763: built on the shadcn Empty container, so the screen reads as one system with
  // the rest of the shadcn UI. The brand moment stays custom: a class passed to a shadcn
  // child component carries no scope hash, so the key's legend and the listening stamp
  // are our own scoped elements inside the Empty. The title stays a real <h2>, the
  // correct heading semantics and the anchor e2e specs locate via getByRole("heading").
  //
  // The ^ stands as a rubber key in a deep bed, its legend lit from behind. A press, or
  // `^` typed anywhere on the screen, turns to the next carrot fact. Offline the light goes
  // out and the key sits disabled, since there is no fact to turn.
  //
  // EXC-381: a sourced carrot fact rotates in a faint line docked above the status bar.
  // Being `position: fixed` it takes no part in the Empty's centered flex layout; it
  // renders inside the Empty only because this component must keep a single root
  // (App.svelte pins `.shell > .empty` to a grid row).
  import { tick, untrack } from "svelte";

  import { type CarrotFact, createFactBag, ROTATE_MS } from "$lib/carrotFacts.ts";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Empty, EmptyHeader, EmptyMedia } from "$lib/components/ui/empty/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { ariaKeyshortcutsFor, bind, shortcuts } from "$lib/shortcuts/index.ts";
  import { sound } from "$lib/sound.ts";

  let {
    connected = true,
    /** Injected so a unit can prove rotation without a 50-second wait. */
    rotateMs = ROTATE_MS,
    /** Injected so a unit can count the facts a turn spends. */
    facts = createFactBag(),
  }: { connected?: boolean; rotateMs?: number; facts?: { next: () => CarrotFact } } = $props();

  // The fact source is fixed at mount, so the first draw is too.
  let fact = $state(untrack(() => facts.next()));
  let leaving = $state(false);
  let factEl: HTMLParagraphElement | null = $state(null);
  let keyEl: HTMLButtonElement | null = $state(null);
  let titleEl: HTMLHeadingElement | null = $state(null);
  let held = $state(false);
  // Bumped by each press, so the timed cadence restarts and no timed turn lands just
  // after one the reader asked for.
  let presses = $state(0);
  let turning = false;
  const sourceHost = $derived(new URL(fact.source).hostname);

  // Let the outgoing line finish leaving before the next one is swapped in, by awaiting
  // the element's own animations rather than mirroring --dur-state as a constant:
  // FilePreview.svelte's awaitDeparture is the same shape. Under happy-dom, which runs no
  // animations, getAnimations is absent and the swap is immediate. allSettled rather than
  // all: if `connected` flips false mid-turn the element leaves the DOM and its cancelled
  // transition REJECTS `finished`. A call landing mid-turn is dropped, or it would spend a
  // second fact on one visible swap.
  async function turn(): Promise<void> {
    if (turning) return;
    turning = true;
    leaving = true;
    await tick();
    if (factEl !== null && typeof factEl.getAnimations === "function") {
      await Promise.allSettled(factEl.getAnimations().map((animation) => animation.finished));
    }
    fact = facts.next();
    leaving = false;
    turning = false;
  }

  function press(): void {
    if (turning) return;
    sound.play("factTurned");
    presses += 1;
    void turn();
  }

  // A held Enter repeats the click; one press is one fact. A held `^` is the dispatcher's
  // to drop.
  function dropRepeat(event: KeyboardEvent): void {
    if (event.repeat) event.preventDefault();
  }

  // The key is the pane's only control, and a browser drops focus from a control that
  // disables to <body>. `.pre` runs while the key is still enabled, so the reader's place
  // moves to the heading first.
  $effect.pre(() => {
    if (!connected && keyEl !== null && document.activeElement === keyEl) titleEl?.focus();
  });

  // Mount-once: the key's shortcut is live only while this screen is.
  $effect(() =>
    shortcuts.register(bind("actions.nextFact", { run: press, enabled: () => connected })),
  );

  $effect(() => {
    if (!connected) return;
    void presses; // read so a press re-runs this effect and restarts the timer
    // The JS twin of app.css's global reduced-motion rule, which can collapse the
    // cross-fade but cannot stop the timer from swapping the text underneath a reader.
    // diffview/scroll.ts carries the same one-liner for its tweens. Queried on each
    // effect run, so a daemon reconnect re-reads it; a preference flipped mid-wait does
    // not stop the timer already running. A press still turns the fact.
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    // `held` skips a tick rather than clearing the timer, so the rotation stays on its
    // own cadence instead of restarting from zero every time a pointer crosses.
    const timer = setInterval(() => {
      if (!held) void turn();
    }, rotateMs);
    return () => clearInterval(timer);
  });
</script>

<Empty class="empty">
  <EmptyHeader>
    <EmptyMedia>
      <span class="tray tray-deep key-bed" class:unlit={!connected}>
        <Tooltip.Provider delayDuration={300}>
          <Tooltip.Root>
            <Tooltip.Trigger disabled={!connected}>
              {#snippet child({ props })}
                <Button
                  {...props}
                  bind:ref={keyEl}
                  variant="secondary"
                  class="float-chip caret-key"
                  aria-label="Next carrot fact"
                  aria-keyshortcuts={ariaKeyshortcutsFor("actions.nextFact")}
                  disabled={!connected}
                  onclick={press}
                  onkeydown={dropRepeat}
                >
                  <span class="legend" aria-hidden="true">
                    <span class="lit-glow">^</span>
                    <span class="lit-off">^</span>
                    <span class="lit-core">^</span>
                  </span>
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>Next carrot fact</Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      </span>
    </EmptyMedia>
    <h2 class="title" tabindex="-1" bind:this={titleEl}>No plans awaiting review</h2>
    {#if connected}
      <p class="body">When an agent proposes a plan, it opens here.</p>
    {:else}
      <p class="body">
        Not connected to the caret daemon. This page reconnects on its own once the daemon is running.
      </p>
    {/if}
  </EmptyHeader>
  <span class="listening stamp metric" class:offline={!connected} role="status">
    <span class="led" aria-hidden="true"></span>{connected ? "listening" : "offline"}
  </span>
  {#if connected}
    <p
      class="carrot-fact"
      class:leaving
      bind:this={factEl}
      onmouseenter={() => (held = true)}
      onmouseleave={() => (held = false)}
      onfocusin={() => (held = true)}
      onfocusout={() => (held = false)}
    >
      {fact.text}
      <a href={fact.source} target="_blank" rel="noreferrer" aria-label="Source: {sourceHost}">source</a>
    </p>
  {/if}
  <!-- The unlit legend's moulding: a shade under each stroke's top edge and a lit lower
       wall, which text-shadow cannot draw inside a glyph. One per scheme, picked in CSS. -->
  <svg class="filters" width="0" height="0" aria-hidden="true" focusable="false">
    <filter id="deboss-dark" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
      <feComponentTransfer in="SourceAlpha" result="inv"><feFuncA type="table" tableValues="1 0" /></feComponentTransfer>
      <feOffset in="inv" dy="2" result="o1" /><feGaussianBlur in="o1" stdDeviation="1.2" result="b1" />
      <feFlood flood-color="#000" flood-opacity=".6" /><feComposite in2="b1" operator="in" /><feComposite in2="SourceAlpha" operator="in" result="shade" />
      <feOffset in="inv" dy="-1.5" result="o2" /><feGaussianBlur in="o2" stdDeviation=".6" result="b2" />
      <feFlood flood-color="#fff" flood-opacity=".14" /><feComposite in2="b2" operator="in" /><feComposite in2="SourceAlpha" operator="in" result="lit" />
      <feOffset in="SourceAlpha" dy="1" result="o3" /><feComposite in="o3" in2="SourceAlpha" operator="out" result="lipmask" />
      <feFlood flood-color="#fff" flood-opacity=".07" /><feComposite in2="lipmask" operator="in" result="lip" />
      <feMerge><feMergeNode in="lip" /><feMergeNode in="SourceGraphic" /><feMergeNode in="shade" /><feMergeNode in="lit" /></feMerge>
    </filter>
    <filter id="deboss-light" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
      <feComponentTransfer in="SourceAlpha" result="inv"><feFuncA type="table" tableValues="1 0" /></feComponentTransfer>
      <feOffset in="inv" dy="2" result="o1" /><feGaussianBlur in="o1" stdDeviation="1.2" result="b1" />
      <feFlood flood-color="#000" flood-opacity=".22" /><feComposite in2="b1" operator="in" /><feComposite in2="SourceAlpha" operator="in" result="shade" />
      <feOffset in="inv" dy="-1.5" result="o2" /><feGaussianBlur in="o2" stdDeviation=".6" result="b2" />
      <feFlood flood-color="#fff" flood-opacity=".45" /><feComposite in2="b2" operator="in" /><feComposite in2="SourceAlpha" operator="in" result="lit" />
      <feOffset in="SourceAlpha" dy="1.2" result="o3" /><feComposite in="o3" in2="SourceAlpha" operator="out" result="lipmask" />
      <feFlood flood-color="#fff" flood-opacity="1" /><feComposite in2="lipmask" operator="in" result="lip" />
      <feMerge><feMergeNode in="lip" /><feMergeNode in="SourceGraphic" /><feMergeNode in="shade" /><feMergeNode in="lit" /></feMerge>
    </filter>
  </svg>
</Empty>

<style>
  /* :global because the Button is a child component and its class carries no scope hash.
     The key clips its legend's glow to its face, as a backlight lights only its own key. */
  .key-bed :global(.caret-key) {
    width: 5.25rem;
    height: 5rem;
    padding: 0;
    overflow: hidden;
  }
  /* The legend's face where Berkeley Mono is missing: macOS's SF Mono, with line metrics
     overridden so its ^, drawn taller and lower than Berkeley Mono's, lands on the same
     spot. Named by its regular instance: Chrome resolves "SF Mono" to a heavy one, and only
     Safari reads ui-monospace. */
  @font-face {
    font-family: "caret legend";
    src: local("SFMono-Regular");
    ascent-override: 86.8%;
    descent-override: 20.6%;
  }
  .legend {
    display: inline-grid;
    font-family: "Berkeley Mono", "caret legend", var(--font-mono);
    /* Display one-off: the key's legend is the screen's brand mark, far above the scale. */
    font-size: 4.25rem;
    font-weight: 400;
    line-height: var(--leading-none);
    /* Berkeley Mono's ^ sits high in its em box; this centres the glyph on the face. */
    translate: 0 0.22em;
  }
  .legend > span {
    grid-area: 1 / 1;
    transition: opacity var(--dur-state) var(--ease-out);
  }
  .lit-core {
    color: transparent;
    background: radial-gradient(
      ellipse 55% 60% at 50% 38%,
      var(--lit-core) 0,
      var(--accent) 52%,
      var(--lit-rim) 100%
    );
    background-clip: text;
  }
  .lit-glow {
    color: var(--accent);
    filter: blur(9px);
    opacity: var(--lit-glow);
    animation: lit-breathe 5s ease-in-out infinite;
  }
  @keyframes lit-breathe {
    0%,
    100% {
      opacity: calc(var(--lit-glow) * 0.5);
    }
    50% {
      opacity: var(--lit-glow);
    }
  }
  .lit-off {
    color: var(--lit-off);
    filter: url(#deboss-dark);
    opacity: 0;
  }
  :global([data-theme="light"]) .lit-off {
    filter: url(#deboss-light);
  }
  /* The breathe has to stop too, or it would hold the glow's opacity over the 0. */
  .unlit :is(.lit-core, .lit-glow) {
    opacity: 0;
    animation-name: none;
  }
  .unlit .lit-off {
    opacity: 1;
  }
  .filters {
    position: absolute;
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
  /* A passive status, so a stamp: a pocket holding the status bar's LED and its word, in
     the .metric atom's mono family. */
  .listening {
    --led: var(--ok);
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.7rem 0.3rem 0.55rem;
    border-radius: 99px;
    font-size: var(--text-xs);
    line-height: var(--leading-none);
    letter-spacing: 0.02em;
  }
  /* A state word in a pocket takes the comment stamps' word ink. */
  .listening.offline {
    --led: var(--danger);
    color: color-mix(in lab, var(--danger), var(--stamp-word-toward) var(--stamp-word-mix));
  }
  /* Viewport-pinned to the foot of the screen, docked above the status bar off the
     same --status-bar-h the comment navigator uses. Deliberately bare — the faintest
     ink, no surface of its own — so it never competes with the screen's actual job,
     and the measure is capped because a faint sentence run edge-to-edge reads as a
     legal footer.

     No z-index on purpose: AlertHost docks in the same band at z-200, so the
     approve-the-last-plan route — which mounts this screen and raises a success toast
     together — paints the toast over the fact's right-hand end until it dismisses. A
     resolution message outranks a flourish.

     text-align/text-wrap are inherited from the shadcn Empty's own
     `text-center text-balance` today, and declared anyway: being `fixed`, this
     element opts out of the Empty's layout entirely, so inheriting its centring by
     accident is a coupling that would break silently.

     pointer-events follows AlertHost: the strip spans the bottom band and would
     otherwise hit-test across it — including through the exit window, where the
     link is at opacity 0 and still clickable, pointing at the OUTGOING source. The
     accepted cost, as there, is that the fact text is not selectable. */
  .carrot-fact {
    position: fixed;
    left: 1rem;
    right: 1rem;
    bottom: calc(var(--status-bar-h) + 0.5rem);
    max-width: 44rem;
    margin: 0 auto;
    text-align: center;
    text-wrap: balance;
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    color: var(--ink-faint);
    pointer-events: none;
    transition: opacity var(--dur-state) var(--ease-out);
  }
  .carrot-fact.leaving {
    opacity: 0;
  }
  /* The link stays in the faint ink — the accent is for selection and brand — so
     the underline is its whole affordance. text-decoration-line is set explicitly
     because Tailwind's preflight resets it to none, which would leave the link a
     word in the middle of a sentence with nothing to mark it. */
  .carrot-fact a {
    color: inherit;
    text-decoration-line: underline;
    text-decoration-color: currentColor;
    text-underline-offset: 0.2em;
    pointer-events: auto;
  }
  .carrot-fact a:is(:hover, :focus-visible) {
    color: var(--ink-soft);
  }
</style>
