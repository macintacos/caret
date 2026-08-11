<script lang="ts">
  // The active-plan switcher. With one review it's an inert label; with several
  // it's a shadcn DropdownMenu (EXC-760) whose trigger carries the active title
  // and a count Badge, and whose items list each plan's title + abbreviated cwd.
  // The hand-rolled listbox + click-away scrim it replaced are gone — bits-ui
  // owns open/close, Escape, outside-click, and focus.
  import { shortCwd } from "$lib/cwd.ts";
  import { stripTitleLinks } from "$lib/title.ts";
  import type { ClientReview } from "@core/lib/types";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import Icon from "@/components/Icon.svelte";

  interface Props {
    reviews: ClientReview[];
    activeId: string | null;
    onSelect: (id: string) => void;
  }
  let { reviews, activeId, onSelect }: Props = $props();

  let active = $derived(reviews.find((r) => r.id === activeId) ?? null);
  let multiple = $derived(reviews.length > 1);
</script>

{#if multiple}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <!-- The trigger names itself rather than taking its name from its content,
             which would run the active plan's title together with the count Badge
             ("Widget Cache Refactor 2") — a name that says nothing about the control
             and changes on every switch. The count rides the accessible description
             through a hidden span, which the accname algorithm still reads because
             aria-describedby references it directly. Which review is active is
             announced by the checked item when the menu opens, below. -->
        <Button
          {...props}
          variant="secondary"
          size="sm"
          class="switcher-trigger float-chip"
          aria-label="Switch review"
          aria-describedby="switcher-count"
        >
          <span class="title">{stripTitleLinks(active?.title ?? "—")}</span>
          <Badge variant="secondary" class="count metric">{reviews.length}</Badge>
          <span class="chev"><Icon name="chevron-down" size={14} /></span>
          <span id="switcher-count" hidden>{reviews.length} reviews pending</span>
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <!-- Bounded width: comfortable minimum, and a max so a long plan title
         ellipsizes (via .m-title) instead of stretching the menu. Inline, not a
         class — the portalled content is out of this component's scoped-CSS reach. -->
    <DropdownMenu.Content align="start" style="min-width: 18rem; max-width: 26rem">
      {#each reviews as r (r.id)}
        <DropdownMenu.Item class="switcher-option" onSelect={() => onSelect(r.id)}>
          <span class="opt">
            <span class="m-title">{stripTitleLinks(r.title)}</span>
            <span class="m-meta mono">{shortCwd(r.cwd)}</span>
          </span>
          {#if r.id === activeId}
            <!-- Labelled, not decorative: with the trigger named "Switch review" this
                 check is the only thing that says which review is active, so it has
                 to reach the accessibility tree. -->
            <span class="opt-check"><Icon name="check" size={14} label="Active review" /></span>
          {/if}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{:else}
  <div class="switcher single">
    <span class="title">{stripTitleLinks(active?.title ?? "—")}</span>
  </div>
{/if}

<style>
  /* Inert single-review label: no control chrome, just the title reading inline
     with the wordmark to its left. */
  .switcher.single {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    /* The inert single-review label reads as a heading, so it keeps full ink. */
    color: var(--ink);
  }
  /* No color of its own: inside the trigger it inherits the button's quiet
     ink-soft (brightening on hover with it), matching the badges; in the single
     case it inherits the full ink above. */
  .title {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* Cap the title at wide widths, but let flex shrink it below that when the
       topbar controls need room (min-width:0 lets a flex item shrink past its
       content). The lead is flex:1 and the controls flex-shrink:0, so the title
       is what gives — truncating instead of pushing controls off-screen. */
    max-width: 46vw;
    min-width: 0;
  }
  /* At narrow widths cap the title tighter so the right-hand controls always fit.
     The single-review label already flex-truncates below this; the multi-review
     trigger is a shadcn Button (shrink-0) that won't, so the cap is what bounds
     it there. */
  @media (max-width: 639px) {
    .title {
      max-width: 40vw;
    }
  }
  .chev {
    display: inline-flex;
    color: var(--ink-faint);
  }
  /* Each option stacks its title over its abbreviated path; the active row gets
     a trailing check (neutral, no amber — amber stays brand-reserved). */
  .opt {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .m-title {
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .m-meta {
    color: var(--ink-faint);
    font-size: var(--text-xs);
  }
  .opt-check {
    display: inline-flex;
    margin-inline-start: auto;
    color: var(--ink-soft);
  }
</style>
