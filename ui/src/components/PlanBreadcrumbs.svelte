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

  // How many crumbs the bar shows before it elides the middle. Deeper trails keep
  // the outermost heading (the section you are in) and the innermost two (your
  // immediate parent and where you are), which is what a reader actually needs;
  // the elided levels stay reachable through the first crumb's nested submenus.
  // This cap bounds the trail's LENGTH, not its width — one long heading is held
  // by the per-crumb text-overflow below, which is what actually keeps the control
  // row inside the app's MIN_APP_WIDTH_PX floor.
  const MAX_CRUMBS = 3;

  // The trail depths rendered, ascending. Indices rather than crumbs because the
  // sibling menus recurse by depth, and a collapsed trail must still hand the
  // right depth to `level`.
  const depths = $derived(
    trail.length > MAX_CRUMBS
      ? [0, trail.length - 2, trail.length - 1]
      : trail.map((_, index) => index),
  );
</script>

<!-- One level's sibling headings. The heading that is itself on the trail nests
     the level below through a DropdownMenuSub, so the menus follow the heading
     hierarchy; every other sibling is a plain row that jumps. Recursion bottoms
     out at the innermost crumb, whose own heading has no level below it. -->
{#snippet level(depth: number)}
  {@const crumb = trail[depth]}
  {#each crumb?.siblings ?? [] as heading (heading.line)}
    {#if heading.line === crumb?.heading.line && depth + 1 < trail.length}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger>
          <span class="crumb-label">{heading.text}</span>
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent class="crumb-menu">
          {@render level(depth + 1)}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
    {:else}
      <DropdownMenu.Item onSelect={() => onJump(heading.line)}>
        <span class="crumb-label">{heading.text}</span>
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
        {@const current = depth === trail.length - 1}
        {#if index > 0}
          <Breadcrumb.Separator />
          <!-- A gap in the depths is the elided middle of a deep trail. -->
          {#if depth - (depths[index - 1] ?? 0) > 1}
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
                  class="crumb float-chip"
                  class:current
                  aria-current={current ? "location" : undefined}
                >{trail[depth]?.heading.text}</button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start" class="crumb-menu">
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
     the compare row and borrows that row's shared 1.75rem control height so the
     trail lines up with the picker beside it. Neutral throughout: amber stays
     reserved for the primary action and the diff's selection, so "you are here"
     is carried by ink weight rather than hue.
     The vendored components render outside this component's style scope, so every
     rule here is :global and anchored on .plan-breadcrumbs / .crumb-menu. */
  :global(.plan-breadcrumbs) {
    --ctl-h: 1.75rem;
    display: flex;
    align-items: center;
    height: var(--ctl-h);
    min-width: 0;
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
  /* Give the ancestors up before the crumb the reader is actually on. Shrinking
     every crumb equally shreds them all to a single letter as the row tightens,
     losing the one that matters most; weighting the shrink keeps "where you are"
     legible while its ancestors truncate. A weight rather than flex: none, so the
     current crumb still yields when there is genuinely no room and the row never
     pushes the app past its MIN_APP_WIDTH_PX floor. */
  :global(.plan-breadcrumbs .crumb-item) {
    flex-shrink: 8;
  }
  :global(.plan-breadcrumbs .crumb-item.current) {
    flex-shrink: 1;
  }
  /* The chevrons and the elision marker are punctuation between crumbs, so they
     sit at the quietest ink in the row and never shrink. */
  :global(.plan-breadcrumbs [data-slot="breadcrumb-separator"]),
  :global(.plan-breadcrumbs [data-slot="breadcrumb-ellipsis"]) {
    flex: none;
    color: var(--ink-faint);
  }

  /* Each crumb is a menu trigger on the row's neutral float-chip language, with
     one deliberate departure: the resting fill is dropped. Three filled chips in a
     row would read as three buttons rather than as one trail, so the chip surface
     is spent only on interaction — .float-chip's own :hover and aria-expanded
     rules out-specify this one and bring --chip-hover back when the reviewer
     reaches for a crumb or opens its menu.
     max-width + ellipsis is what holds the app's MIN_APP_WIDTH_PX floor: a long
     heading truncates here instead of widening the control row. */
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
    line-height: calc(var(--ctl-h) - 0.25rem);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  /* The innermost crumb is where the reader is, so it takes full ink while its
     ancestors stay soft. The ramp runs opposite the rail's — that one fades with
     depth because depth is detail there; here the deepest level is the subject. */
  :global(.plan-breadcrumbs .crumb.current) {
    color: var(--ink);
    font-weight: 600;
  }

  /* The portalled menus keep the catalog's own row treatment; only the width is
     pinned, so a long heading truncates in its row instead of stretching the
     panel to the width of the plan's longest heading. */
  :global(.crumb-menu) {
    max-width: 22rem;
  }
  :global(.crumb-menu .crumb-label) {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
