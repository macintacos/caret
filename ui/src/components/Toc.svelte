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
    <!-- Decorative tick rail: aria-hidden, not focusable. One flat tick per
         heading in document order; the real navigation lives in the panel. -->
    <ol class="marks" aria-hidden="true">
      {#each headings as h (h.blockId)}
        <li class="mark lvl-{h.level}" class:active={h.slug === activeSlug}></li>
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
              aria-current={h.slug === activeSlug ? "true" : undefined}
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
    left: clamp(0.75rem, 2vw, 1.75rem);
    transform: translateY(-50%);
    z-index: 30;
    /* Right padding is an invisible hover bridge: the pointer travels rail →
       panel without crossing dead space, so :hover never drops mid-traverse. */
    padding: 0.5rem 1.25rem 0.5rem 0;
  }

  /* Single breakpoint (1280px), shared with app.css / PlanView: below it the rail
     is hidden and the plan re-centers (today's behaviour). */
  @media (max-width: 1279px) {
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
    gap: 0.5rem;
    max-height: 78vh;
    /* Many headings: keep the rail within the viewport rather than overflowing. */
    overflow: hidden;
  }
  .mark {
    width: 0.85rem;
    height: 2px;
    border-radius: 1px;
    background: var(--rule-strong);
    opacity: 0.85;
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
    /* Collapsed: invisible, inert, and out of the tab order. visibility:hidden
       (not just opacity:0) is what keeps the focusable links from hiding behind
       an invisible panel; :focus-within reveals it before a Tab can land. */
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(-50%) translateX(-0.5rem);
    transition:
      opacity 0.22s ease,
      transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
      visibility 0s linear 0.22s;
    /* Leave-delay: a brief exit over the bridge waits before collapsing, so a
       quick re-entry doesn't flicker. The reveal rule below zeroes the delay. */
    transition-delay: 0.12s;
  }
  .toc:hover .panel,
  .toc:focus-within .panel {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateY(-50%) translateX(0);
    transition:
      opacity 0.22s ease,
      transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
      visibility 0s;
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

  /* Touch / no-hover devices: never show a rail that can't be opened. Hide the
     decorative ticks; keyboard users still reveal the panel via :focus-within. */
  @media (hover: none), (pointer: coarse) {
    .marks {
      display: none;
    }
  }
</style>
