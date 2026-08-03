<script lang="ts">
  // Heading breadcrumbs bar for the source-view plan surface (EXC-946). Where the
  // contents rail answers "what is in this plan", the bar answers "where am I in
  // it": the ancestor chain enclosing the heading being read, updating as the
  // reviewer scrolls. It reads the same line-anchored heading model the rail does
  // (toc.ts) through headingTrail.ts, and reports a pick as a source line, so a
  // crumb jump lands exactly where a rail jump does.
  //
  // Each crumb opens the headings it can be swapped for at that level. The crumb's
  // OWN heading opens the level below as a submenu instead of jumping in place —
  // you are already there — so one menu walks the whole hierarchy rather than
  // making the reviewer close and reopen at each depth.
  //
  // Presentational: no state of its own, the trail is derived, and the parent owns
  // both the heading set and the scroll tracking that moves `activeLine`.
  import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { headingTrail } from "$lib/headingTrail.ts";
  import type { TocHeading } from "$lib/toc.ts";

  interface Props {
    /** Headings extracted from the plan source, in document order. */
    headings: TocHeading[];
    /** Source line of the heading currently in the reading zone, or null. */
    activeLine: number | null;
    /** Jump the view to a heading's 1-based source line. */
    onJump: (line: number) => void;
  }

  let { headings, activeLine, onJump }: Props = $props();

  const trail = $derived(headingTrail(headings, activeLine));

  // Above this depth the bar elides the middle of the trail, keeping the outermost
  // heading and the innermost two — the reader's immediate parent and where they
  // are. The elided levels stay reachable through the first crumb's nested
  // submenus. This bounds the trail's LENGTH only; a single long heading is held
  // by the per-crumb truncation below.
  const COLLAPSE_ABOVE = 3;

  // The trail depths rendered, ascending. Indices rather than crumbs because the
  // sibling menus recurse by depth, and a collapsed trail must still hand the
  // right depth to `level`.
  const depths = $derived(
    trail.length > COLLAPSE_ABOVE
      ? [0, trail.length - 2, trail.length - 1]
      : trail.map((_, index) => index),
  );
</script>

<!-- One level's sibling headings. The heading that is itself on the trail nests
     the level below through a DropdownMenuSub, so the menus follow the heading
     hierarchy; every other sibling is a plain row that jumps. Recursion bottoms
     out at the innermost crumb, whose own heading has no level below it.
     Either way that heading carries aria-current, so the row the reader is
     already on is marked at every depth. -->
{#snippet level(depth: number)}
  {@const crumb = trail[depth]}
  {#each crumb?.siblings ?? [] as heading (heading.line)}
    {@const here = heading.line === crumb?.heading.line}
    {#if here && depth + 1 < trail.length}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger aria-current="location">
          <span class="crumb-label" title={heading.text}>{heading.text}</span>
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent class="plan-crumb-menu">
          {@render level(depth + 1)}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
    {:else}
      <DropdownMenu.Item
        aria-current={here ? "location" : undefined}
        onSelect={() => onJump(heading.line)}
      >
        <span class="crumb-label" title={heading.text}>{heading.text}</span>
      </DropdownMenu.Item>
    {/if}
  {/each}
{/snippet}

<!-- Nothing to place the reader in — a plan with no headings, or one not yet
     scrolled — renders no bar at all. There is deliberately no minimum-heading
     gate beyond that: a one-heading plan still has a location. -->
{#if trail.length > 0}
  <Breadcrumb.Root class="plan-breadcrumbs" aria-label="Plan location">
    <Breadcrumb.List>
      {#each depths as depth, index (depth)}
        {@const crumb = trail[depth]}
        {@const current = depth === trail.length - 1}
        {@const previous = depths[index - 1]}
        {#if index > 0}
          <Breadcrumb.Separator />
          <!-- A gap in the depths is the elided middle of a deep trail. -->
          {#if previous != null && depth - previous > 1}
            <Breadcrumb.Item><Breadcrumb.Ellipsis /></Breadcrumb.Item>
            <Breadcrumb.Separator />
          {/if}
        {/if}
        <Breadcrumb.Item class={current ? "crumb-item current" : "crumb-item"}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  type="button"
                  class="crumb"
                  class:current
                  title={crumb?.heading.text}
                  aria-current={current ? "location" : undefined}
                >{#key crumb?.heading.line}<span class="crumb-text">{crumb?.heading.text}</span>{/key}</button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start" class="plan-crumb-menu">
              {@render level(depth)}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Breadcrumb.Item>
      {/each}
    </Breadcrumb.List>
  </Breadcrumb.Root>
{/if}

<style>
  /* The bar is chrome, not plan surface, so it wears the UI's sans beside the
     plan's monospace voice — the same split SourceToc makes (EXC-900). It sits in
     the compare row and inherits that row's --ctl-h control height, so the trail
     lines up with the picker beside it.
     The vendored components render outside this component's style scope, so every
     rule here is :global and anchored on .plan-breadcrumbs / .plan-crumb-menu. */
  :global(.plan-breadcrumbs) {
    display: flex;
    align-items: center;
    height: var(--ctl-h);
    font-family: var(--font-sans);
  }

  /* The vendored list wraps by default. In a fixed-height row a second line would
     grow the bar, so the trail stays on one line and its crumbs ellipsise. */
  :global(.plan-breadcrumbs [data-slot="breadcrumb-list"]) {
    flex-wrap: nowrap;
    min-width: 0;
    gap: 0.1rem;
    font-size: var(--text-sm);
  }
  :global(.plan-breadcrumbs [data-slot="breadcrumb-item"]) {
    min-width: 0;
  }
  /* The chevrons and the elision marker are punctuation between crumbs, so they
     sit at the quietest ink in the row and never shrink. */
  :global(.plan-breadcrumbs [data-slot="breadcrumb-separator"]),
  :global(.plan-breadcrumbs [data-slot="breadcrumb-ellipsis"]) {
    flex: none;
    color: var(--ink-faint);
  }
  /* The separator is a list-item, so the vendored icon inside it is placed by
     inline layout and rides the text baseline — which leaves the chevron a couple
     of pixels above the crumbs it punctuates. Centring it as a flex box puts the
     glyph on the row's axis, where the crumb boxes and the elision marker (already
     flex, from the vendored component) sit. */
  :global(.plan-breadcrumbs [data-slot="breadcrumb-separator"]) {
    display: flex;
    align-items: center;
  }
  /* Give the ancestors up before the crumb the reader is actually on. Shrinking
     every crumb equally shreds them all to a single letter as the row tightens,
     losing the one that matters most; weighting the shrink keeps "where you are"
     legible while its ancestors truncate. A weight rather than flex: none, so the
     current crumb still yields when there is genuinely no room. */
  :global(.plan-breadcrumbs .crumb-item) {
    flex-shrink: 8;
  }
  :global(.plan-breadcrumbs .crumb-item.current) {
    flex-shrink: 1;
  }

  /* The trail re-roots continuously as the reader scrolls, and an instant swap at
     that cadence reads as flicker. A crumb that genuinely appears — a new level,
     or the whole bar on first paint — eases in, and its separator travels with it,
     so a deepening trail reads as the trail extending rather than as a jump. A
     crumb that survives a re-root keeps its key and never re-animates, which is
     what keeps the motion quiet while scrolling within one level.
     Reduced motion is not handled here: the single global rule in app.css already
     neutralises this for the whole light-DOM root. */
  @keyframes crumb-in {
    from {
      opacity: 0;
      transform: translateX(-0.25rem);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  :global(.plan-breadcrumbs .crumb-item),
  :global(.plan-breadcrumbs [data-slot="breadcrumb-separator"]) {
    animation: crumb-in var(--dur-base) var(--ease-out);
  }

  /* Walking to a sibling at the same depth keeps the crumb mounted and swaps only
     its text, so the label carries a fade of its own — the change the mount
     animation above can never observe. Opacity alone, and from part-way rather
     than from zero: a transform does not apply to the inline box the crumb's
     ellipsis truncation depends on, and a full fade-from-nothing reads as a blink
     at scroll cadence. */
  @keyframes crumb-text-in {
    from {
      opacity: 0.4;
    }
    to {
      opacity: 1;
    }
  }
  :global(.plan-breadcrumbs .crumb-text) {
    animation: crumb-text-in var(--dur-fast) var(--ease-out);
  }

  /* Each crumb is a menu trigger. It deliberately does NOT wear .float-chip: three
     resting chip fills in a row read as three buttons rather than as one trail, so
     the chip surface is spent only on interaction. The hover and menu-open states
     below are the atom's, reproduced here rather than inherited-and-overridden, so
     the resting look does not depend on out-specifying a shared class.
     The unbroken min-width: 0 chain (list -> item -> button) plus the overflow
     rules are what keep a long heading truncating instead of widening the control
     row, and so what holds the app inside its MIN_APP_WIDTH_PX floor. */
  :global(.plan-breadcrumbs .crumb) {
    display: block;
    max-width: 14rem;
    min-width: 0;
    height: calc(var(--ctl-h) - 0.25rem);
    padding: 0 0.4rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-soft);
    font-family: inherit;
    font-size: var(--text-sm);
    /* A button centres its own content vertically, so the label rides the same
       baseline as the picker's chip beside it. Pinning line-height to the box
       height instead fights that centring and lands the baseline half a pixel
       high — enough to read as "not quite sitting right" against the chip. */
    line-height: normal;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  :global(.plan-breadcrumbs .crumb:hover),
  :global(.plan-breadcrumbs .crumb[aria-expanded="true"]) {
    background: var(--chip-hover);
    color: var(--ink);
  }
  /* The innermost crumb is where the reader is, so it takes full ink while its
     ancestors stay soft. It is marked by weight rather than by the rail's amber
     wash: the rail is a list of destinations where amber picks one out, while
     every crumb here is already the trail, so a second colour would compete with
     the amber the menu below spends on the same "you are here" job. */
  :global(.plan-breadcrumbs .crumb.current) {
    color: var(--ink);
    font-weight: 600;
  }

  /* The portalled menus keep the catalog's own row treatment; only the width is
     pinned, so a long heading truncates in its row instead of stretching the
     panel to the width of the plan's longest heading. */
  :global(.plan-crumb-menu) {
    max-width: 22rem;
  }
  :global(.plan-crumb-menu .crumb-label) {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* The heading the reader is already on, marked with the amber wash the menu
     language reserves for the active choice (shadcn-rules.md § Menu highlight vs.
     selection) — the same signal SourceToc's active row carries. */
  :global(.plan-crumb-menu [aria-current="location"]) {
    background: var(--accent-wash);
    color: var(--ink);
  }
</style>
