<script lang="ts">
  // The vim `/` search dock (EXC-832): the plan pane's top-right corner, where the
  // search hangs from the pane's top edge. Closed, it shows the "/ to search" tab (Show
  // Hints on); open, the search sheet. Both slide out from under the edge.
  import type { ComponentProps } from "svelte";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import PlanSearch from "@/components/PlanSearch.svelte";

  type Props = Omit<ComponentProps<typeof PlanSearch>, "hints"> & {
    /** The search is open, for typing or committed. */
    open: boolean;
    /** The Show Hints setting: the closed tab and the sheet's key hints. */
    hints: boolean;
  };

  let { open, hints, query = $bindable(), ...sheet }: Props = $props();
</script>

<div class="search-dock">
  {#if open}
    <PlanSearch bind:query {hints} {...sheet} />
  {:else if hints}
    <div class="search-hint" aria-hidden="true">
      <Kbd class="kbd-sm">/</Kbd>
      <span>to search</span>
    </div>
  {/if}
</div>

<style>
  /* Outside the plan's scroller, so it never scrolls with the plan. The pane's lip
     stacks above it (DiffPlanView), so whatever hangs here tucks under the pane's top
     edge. It spans the pane less its insets so the sheet can narrow with the pane, and
     lets the pointer through wherever nothing hangs. */
  .search-dock {
    position: absolute;
    top: 0;
    inset-inline: 0.85rem;
    z-index: 4;
    display: flex;
    justify-content: flex-end;
    pointer-events: none;
  }
  .search-dock > :global(*) {
    pointer-events: auto;
  }

  /* The closed search: a tab of the sheet's material hanging from the same edge. */
  .search-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 1.7rem;
    padding-inline: 0.65rem;
    border-radius: 0 0 calc(var(--radius) + var(--well-pad-tight))
      calc(var(--radius) + var(--well-pad-tight));
    background: var(--paper-raised);
    box-shadow:
      0 0 0 1px var(--rule),
      var(--float-low);
    color: var(--ink-soft);
    font-size: var(--text-xs);
    white-space: nowrap;
    user-select: none;
    animation: search-hint-drop var(--dur-state) var(--ease-out);
  }
  @keyframes search-hint-drop {
    from {
      transform: translateY(-100%);
    }
  }
</style>
