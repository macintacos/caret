<script lang="ts">
  import { type HeadingEntry, shouldShowRail } from "../lib/render.ts";
  import Rail from "./Rail.svelte";

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
  <!-- Wrapper exists only to hide the rail below 1400px (where the plan
       re-centers). display:contents keeps it out of the grid until then; the
       media query swaps to display:none, which hides the fixed rail subtree. -->
  <div class="toc-rail">
    <Rail side="left" placement="center" label="Plan contents" touch="hide">
      {#snippet strip()}
        <!-- Tick rail: aria-hidden — screen readers and the keyboard use the panel
             links below. One flat tick per heading in document order. Each tick is
             a redundant mouse affordance: clicking it jumps, same as its panel
             link. (Deliberately not focusable / no key handler — a focusable
             aria-hidden control would strand keyboard focus; the panel <a>s are
             the keyboard path.) -->
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
      {/snippet}

      {#snippet panel()}
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
      {/snippet}
    </Rail>
  </div>
{/if}

<style>
  .toc-rail {
    display: contents;
  }

  /* Single breakpoint (1400px), shared with app.css / PlanView: below it the rail
     is hidden and the plan re-centers (today's behaviour). Range syntax keeps this
     exactly complementary to PlanView's `width >= 1400px` — no fractional band
     where the rail shows but the plan is still centered. */
  @media (width < 1400px) {
    .toc-rail {
      display: none;
    }
  }

  /* ----- Decorative tick rail (the Rail's `strip`) ----- */
  .marks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    /* No overflow clip here: it would crop the active tick's horizontal scaleX
       emphasis so it could never render longer than the inactive ticks. Very
       long plans let the rail run toward the viewport edges — it is a decorative
       indicator; the scrollable panel is the real navigation. */
  }
  /* The <li> is the click target; the visible bar is a ::before so the hit area
     and the thin bar stay independent (explicit ::before height renders exactly,
     unlike a padded background-clip bar which collapses at sub-pixel heights). */
  .mark {
    width: 1.3rem;
    padding: 0.22rem 0;
    cursor: pointer;
  }
  .mark::before {
    content: "";
    display: block;
    height: 2px;
    border-radius: 1px;
    background: var(--ink-faint);
    transform-origin: left center;
    transition:
      transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      background-color 0.2s,
      opacity 0.2s;
  }
  /* Deeper headings read as shorter, fainter ticks — hierarchy without labels. */
  .mark.lvl-3 {
    width: 1rem;
  }
  .mark.lvl-4,
  .mark.lvl-5,
  .mark.lvl-6 {
    width: 0.8rem;
  }
  .mark.lvl-4::before,
  .mark.lvl-5::before,
  .mark.lvl-6::before {
    opacity: 0.7;
  }
  /* Active section = scrollspy only: the longest tick and a thinner (1px) accent
     hairline so it stands out from the inactive marks. scaleX keeps the length
     change a transform (no reflow). */
  .mark.active::before {
    background: var(--accent);
    height: 1px;
    transform: scaleX(1.7);
  }
  /* Hovering the rail previews intent by brightening the inactive ticks, but it
     must NEVER change the active section — that is the scrollspy's job alone. The
     hover state lives on Rail's `.rail` element (a different component scope), so
     reach it with :global. */
  :global(.rail:hover) .mark:not(.active)::before {
    background: var(--ink-soft);
  }

  /* ----- Contents panel content (the Rail's `panel`) ----- */
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
    /* Long heading text wraps onto multiple lines (the panel is a fixed width and
       scrolls vertically) rather than truncating; break unbreakable tokens so a
       URL-like heading can never overflow horizontally. */
    overflow-wrap: anywhere;
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

  /* Reduced motion: the active-tick emphasis appears without animation. (The
     panel's reduced-motion handling lives in Rail.) */
  @media (prefers-reduced-motion: reduce) {
    .mark::before {
      transition: background-color 0.01ms;
    }
    .mark.active::before {
      transform: none;
      width: 2.2rem; /* emphasize by explicit length (not an animated scale) */
      height: 1px;
    }
  }
</style>
