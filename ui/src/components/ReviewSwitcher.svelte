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
    /** Ids of plans that arrived or gained a version while another was being read
     * (EXC-411). Marks the trigger and the matching dropdown rows; a plan drops
     * out of the list the moment it becomes the active one. */
    unread: string[];
    onSelect: (id: string) => void;
  }
  let { reviews, activeId, unread, onSelect }: Props = $props();

  let active = $derived(reviews.find((r) => r.id === activeId) ?? null);
  let multiple = $derived(reviews.length > 1);
  let unreadCount = $derived(unread.length);
  // The trigger's accessible description. The dot is aria-hidden — a shape, not
  // text — so the tally rides the same hidden span the pending count already does.
  let countDescription = $derived(
    `${reviews.length} reviews pending${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`,
  );

  // Replay the jiggle on each ARRIVAL, not on every count change: clearing a mark
  // drops the count and must not re-animate the dot that remains.
  let jiggle = $state(0);
  let lastCount = 0;
  $effect(() => {
    if (unreadCount > lastCount) jiggle++;
    lastCount = unreadCount;
  });
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
          {#if unreadCount > 0}
            <!-- Keyed on the arrival counter so the jiggle replays each time a plan
                 lands, rather than only on the dot's first mount. -->
            {#key jiggle}<span class="unread-dot" aria-hidden="true"></span>{/key}
          {/if}
          <span class="chev"><Icon name="chevron-down" size={14} /></span>
          <span id="switcher-count" hidden>{countDescription}</span>
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
          {:else if unread.includes(r.id)}
            <!-- Same trailing slot as the check above: an unread row is never the
                 active row by construction, so the two can never collide. The dot
                 is the visual marker and the sr-only text the announced one — the
                 mark is a shape's presence, not a tint on a shared glyph. -->
            <span class="opt-unread">
              <span class="dot" aria-hidden="true"></span><span class="sr-only">Unread</span>
            </span>
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
  /* The unread rows take the same trailing slot as the check, so the two never
     need to share a row and the layout is unchanged either way. */
  .opt-unread {
    display: inline-flex;
    align-items: center;
    margin-inline-start: auto;
  }
  /* --attention is the palette's novelty job ("new, unread, worth a glance"), and
     a bare disc is what tells this apart from the count Badge two elements to its
     left — a shape rather than a pill with a number in it. */
  .unread-dot,
  .opt-unread .dot {
    display: inline-block;
    width: 0.4rem;
    height: 0.4rem;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--attention);
  }
  /* A one-shot shudder on the arrival of a plan, twice over --dur-micro: enough to
     catch the eye in a header the reviewer is not looking at, short enough not to
     read as an ambient loop the way RefHintBadge's teaching ping deliberately does.
     No local prefers-reduced-motion query — the trigger renders inside #app, which
     app.css's single global guard covers, exactly as that badge's ping relies on. */
  .unread-dot {
    animation: switcher-jiggle var(--dur-micro) var(--ease-out) 2;
  }
  @keyframes switcher-jiggle {
    0%,
    100% {
      transform: translateX(0);
    }
    25% {
      transform: translateX(-1.5px);
    }
    75% {
      transform: translateX(1.5px);
    }
  }
</style>
