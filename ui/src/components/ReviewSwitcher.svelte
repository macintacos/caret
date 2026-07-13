<script lang="ts">
  // The active-plan switcher. With one review it's an inert label; with several
  // it's a shadcn DropdownMenu (EXC-760) whose trigger carries the active title
  // and a count Badge, and whose items list each plan's title + abbreviated cwd.
  // The hand-rolled listbox + click-away scrim it replaced are gone — bits-ui
  // owns open/close, Escape, outside-click, and focus.
  import { shortCwd } from "../lib/cwd.ts";
  import { stripTitleLinks } from "../lib/title.ts";
  import type { ClientReview } from "@core/types";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import Icon from "./Icon.svelte";

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
        <Button {...props} variant="secondary" size="sm" class="switcher-trigger float-chip">
          <span class="title">{stripTitleLinks(active?.title ?? "—")}</span>
          <Badge variant="secondary" class="count metric">{reviews.length}</Badge>
          <span class="chev"><Icon name="chevron-down" size={14} /></span>
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
            <span class="opt-check"><Icon name="check" size={14} /></span>
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
  }
  .title {
    font-weight: 500;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 46vw;
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
