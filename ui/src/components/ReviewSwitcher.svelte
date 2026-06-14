<script lang="ts">
  import { shortCwd } from "../lib/cwd.ts";
  import { stripTitleLinks } from "../lib/title.ts";
  import type { ClientReview } from "@core/types";
  import Icon from "./Icon.svelte";

  interface Props {
    reviews: ClientReview[];
    activeId: string | null;
    onSelect: (id: string) => void;
  }
  let { reviews, activeId, onSelect }: Props = $props();

  let open = $state(false);
  let active = $derived(reviews.find((r) => r.id === activeId) ?? null);

  function pick(id: string) {
    open = false;
    onSelect(id);
  }
</script>

<div class="switcher" class:single={reviews.length <= 1}>
  <button
    class="current"
    onclick={() => (open = reviews.length > 1 ? !open : false)}
    aria-haspopup="listbox"
    aria-expanded={open}
  >
    <span class="title">{stripTitleLinks(active?.title ?? "—")}</span>
    {#if reviews.length > 1}
      <span class="badge">{reviews.length}</span>
      <span class="chev" class:open aria-hidden="true">
        <Icon name="chevron-down" size={14} />
      </span>
    {/if}
  </button>

  {#if open}
    <ul class="menu" role="listbox">
      {#each reviews as r (r.id)}
        <li>
          <button
            class:active={r.id === activeId}
            role="option"
            aria-selected={r.id === activeId}
            onclick={() => pick(r.id)}
          >
            <span class="m-title">{stripTitleLinks(r.title)}</span>
            <span class="m-meta mono">{shortCwd(r.cwd)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .switcher {
    position: relative;
    min-width: 0;
  }
  /* A tagged control (--radius), matching the diff surface's input/select voice,
     rather than a pill — pills are reserved for true badges (the count, below). */
  .current {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--paper-sunk);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: 0.3rem 0.75rem;
    max-width: 46vw;
    transition: border-color var(--dur-fast) var(--ease-out);
  }
  .current:hover {
    border-color: var(--rule-strong);
  }
  .single .current {
    cursor: default;
  }
  .single .current:hover {
    border-color: var(--rule);
  }
  .title {
    font-family: var(--font-sans);
    font-weight: 500;
    font-size: var(--text-md);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 99px;
    font-size: var(--text-2xs);
    font-weight: 700;
    padding: 0.05rem 0.4rem;
  }
  .chev {
    display: inline-flex;
    color: var(--ink-faint);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .chev.open {
    transform: rotate(180deg);
  }
  .menu {
    position: absolute;
    z-index: 40;
    top: calc(100% + 0.4rem);
    left: 0;
    min-width: 280px;
    max-width: 420px;
    list-style: none;
    margin: 0;
    padding: 0.3rem;
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
  }
  .menu button {
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-radius: var(--radius);
    padding: 0.45rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    /* Inset accent bar marks the active review, echoing the source-view ToC's
       active-row treatment; reserved as transparent until selected. */
    box-shadow: inset 2px 0 0 transparent;
    transition:
      background var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }
  .menu button:hover {
    background: var(--paper-sunk);
  }
  .menu button.active {
    background: var(--accent-wash);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .m-title {
    font-family: var(--font-sans);
    font-size: var(--text-md);
    color: var(--ink);
  }
  .m-meta {
    color: var(--ink-faint);
    font-size: var(--text-xs);
  }
</style>
