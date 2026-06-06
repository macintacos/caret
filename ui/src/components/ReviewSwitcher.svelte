<script lang="ts">
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

  function shortCwd(cwd: string): string {
    const parts = cwd.split("/").filter(Boolean);
    return parts.length <= 2 ? cwd : `…/${parts.slice(-2).join("/")}`;
  }
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
    <span class="title">{active?.title ?? "—"}</span>
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
            <span class="m-title">{r.title}</span>
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
  .current {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--paper-sunk);
    border: 1px solid var(--rule);
    border-radius: 99px;
    padding: 0.3rem 0.75rem;
    max-width: 46vw;
  }
  .single .current {
    cursor: default;
  }
  .title {
    font-family: var(--font-sans);
    font-weight: 500;
    font-size: 0.95rem;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 99px;
    font-size: 0.65rem;
    font-weight: 700;
    padding: 0.05rem 0.4rem;
  }
  .chev {
    display: inline-flex;
    color: var(--ink-faint);
    transition: transform 0.15s;
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
  }
  .menu button:hover {
    background: var(--paper-sunk);
  }
  .menu button.active {
    background: var(--accent-wash);
  }
  .m-title {
    font-family: var(--font-sans);
    font-size: 0.92rem;
    color: var(--ink);
  }
  .m-meta {
    color: var(--ink-faint);
    font-size: 0.7rem;
  }
</style>
