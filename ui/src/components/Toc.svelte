<script lang="ts">
  import { type HeadingEntry, shouldShowRail } from "../lib/render.ts";

  interface Props {
    headings: HeadingEntry[];
    activeSlug: string | null;
    onJump: (slug: string) => void;
  }
  let { headings, activeSlug, onJump }: Props = $props();

  // 0 or 1 heading → no rail (a one-tick rail is noise, not navigation).
  let visible = $derived(shouldShowRail(headings));
</script>

{#if visible}
  <nav class="toc" aria-label="Plan contents">
    <!-- Tick rail: aria-hidden — screen readers and the keyboard use the panel
         links below. One flat tick per heading in document order. Each tick is a
         redundant mouse affordance: clicking it jumps, same as its panel link.
         (Deliberately not focusable / no key handler — a focusable aria-hidden
         control would strand keyboard focus; the panel <a>s are the keyboard
         path.) -->
    <ol class="marks" aria-hidden="true">
      {#each headings as h (h.blockId)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="mark lvl-{h.level}"
          class:active={h.slug === activeSlug}
          title={h.text}
          onclick={() => onJump(h.slug)}
        ></li>
      {/each}
    </ol>

    <!-- The Contents panel: the real, focusable navigation. -->
    <div class="panel">
      <p class="masthead" aria-hidden="true">
        <span class="caret">^</span>
        <span class="eyebrow">Contents</span>
      </p>
      <ul class="links">
        {#each headings as h (h.blockId)}
          <li class="lvl-{h.level}" class:active={h.slug === activeSlug}>
            <!-- href targets the heading's structural id (b{n}) so middle-click /
                 no-JS still navigate; onclick preserves the smooth-scroll jump. -->
            <a
              href="#{h.blockId}"
              aria-current={h.slug === activeSlug ? "location" : undefined}
              title={h.text}
              onclick={(e) => {
                e.preventDefault();
                onJump(h.slug);
              }}
            >{h.text}</a>
          </li>
        {/each}
      </ul>
    </div>
  </nav>
{/if}

<style>
  /* Fixed, viewport-pinned contents rail, decoupled from the .columns grid so it
     escapes that grid's overflow:hidden. It is positioned to the viewport because
     no ancestor (.shell / #app / body) establishes a containing block — see the
     transform warning in app.css. */
  .toc {
    position: fixed;
    top: 50%;
    left: clamp(0.5rem, 1.5vw, 1.25rem);
    transform: translateY(-50%);
    z-index: 30;
    /* Right padding is an invisible hover bridge: the pointer travels rail →
       panel without crossing dead space, so :hover never drops mid-traverse. */
    padding: 0.5rem 1rem 0.5rem 0;
  }

  /* Single breakpoint (1400px), shared with app.css / PlanView: below it the rail
     is hidden and the plan re-centers (today's behaviour). Range syntax keeps
     this exactly complementary to PlanView's `width >= 1400px` — no fractional
     band where the rail shows but the plan is still centered. */
  @media (width < 1400px) {
    .toc {
      display: none;
    }
  }

  /* ----- Decorative tick rail ----- */
  .marks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    max-height: 78vh;
    /* Many headings: keep the rail within the viewport rather than overflowing. */
    overflow: hidden;
  }
  .mark {
    width: 0.85rem;
    height: 2px;
    /* Transparent vertical padding enlarges the click target to ~8px while
       background-clip keeps the visible bar a 2px tick. The reduced .marks gap
       compensates so rail density is unchanged. */
    padding: 0.2rem 0;
    background: var(--rule-strong);
    background-clip: content-box;
    border-radius: 1px;
    opacity: 0.85;
    cursor: pointer;
    transform-origin: left center;
    transition:
      transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      background-color 0.2s,
      opacity 0.2s;
  }
  /* Deeper headings read as shorter, fainter ticks — hierarchy without labels. */
  .mark.lvl-3 {
    width: 0.62rem;
  }
  .mark.lvl-4,
  .mark.lvl-5,
  .mark.lvl-6 {
    width: 0.46rem;
    opacity: 0.6;
  }
  /* Active section = scrollspy only. Emphasis is transform/colour, never reflow. */
  .mark.active {
    background: var(--accent);
    opacity: 1;
    transform: scaleX(2.4);
  }
  /* Hovering the rail previews intent by brightening the ticks, but it must NEVER
     change the active section — that is the scrollspy's job alone. */
  .toc:hover .marks .mark {
    opacity: 1;
  }

  /* ----- Contents panel: expands into the freed left margin ----- */
  .panel {
    position: absolute;
    top: 50%;
    left: 100%;
    width: 12rem;
    max-height: 74vh;
    overflow-y: auto;
    padding: 0.85rem 1rem 0.95rem;
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    /* Collapsed: transparent and mouse-inert, but the links stay in the tab order
       — NOT visibility:hidden, which would make them unfocusable so a keyboard
       Tab could never enter the nav to trip :focus-within. The instant a link
       receives focus the :focus-within rule below reveals the panel, so no
       focusable element is ever stranded behind opacity:0. */
    opacity: 0;
    pointer-events: none;
    transform: translateY(-50%) translateX(-0.5rem);
    transition:
      opacity 0.22s ease,
      transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    /* Leave-delay: the collapse (this base state) waits 0.12s before starting, so
       a quick re-entry over the hover bridge doesn't flicker. The reveal rule
       zeroes the delay, so opening is instant. */
    transition-delay: 0.12s;
  }
  .toc:hover .panel,
  .toc:focus-within .panel {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(-50%) translateX(0);
    transition-delay: 0s;
  }

  .masthead {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.85rem;
  }
  .caret {
    font-family: var(--font-mono);
    font-size: 1.05rem;
    line-height: 1;
    color: var(--accent);
  }

  .links {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .links li {
    margin: 0;
  }
  .links a {
    display: block;
    font-family: var(--font-sans);
    font-size: 0.84rem;
    line-height: 1.4;
    color: var(--ink-soft);
    text-decoration: none;
    padding: 0.26rem 0.45rem;
    border-radius: var(--radius);
    /* Long heading text: ellipsize rather than overflow the panel. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition:
      color 0.12s,
      background-color 0.12s;
  }
  .links a:hover {
    color: var(--ink);
    background: var(--paper-sunk);
  }
  .links li.active a {
    color: var(--accent);
    font-weight: 600;
  }
  /* Nesting indents reuse the heading-level scheme. */
  .links li.lvl-2 a {
    padding-left: 1rem;
  }
  .links li.lvl-3 a {
    padding-left: 1.6rem;
    font-size: 0.82rem;
  }
  .links li.lvl-4 a,
  .links li.lvl-5 a,
  .links li.lvl-6 a {
    padding-left: 2.2rem;
    font-size: 0.8rem;
    color: var(--ink-faint);
  }

  /* Reduced motion: reveal and active-state changes appear without animation. */
  @media (prefers-reduced-motion: reduce) {
    .mark {
      transition:
        background-color 0.01ms,
        opacity 0.01ms;
    }
    .mark.active {
      transform: none;
      width: 1.3rem; /* emphasize by length, not an animated scale */
    }
    .panel,
    .toc:hover .panel,
    .toc:focus-within .panel {
      transition: none;
      transform: translateY(-50%);
    }
  }

  /* Pure touch / no-hover devices (phones, tablets — a laptop with a touchscreen
     still reports hover:hover via its trackpad): there is no hover to open the
     panel and often no keyboard, so hide the whole nav rather than leave a fixed
     element that can't be opened. Desktop keeps the rail; this matches the prior
     behaviour where the TOC was simply absent on these devices. */
  @media (hover: none), (pointer: coarse) {
    .toc {
      display: none;
    }
  }
</style>
