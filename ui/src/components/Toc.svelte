<script lang="ts">
  import type { HeadingEntry } from "../lib/render.ts";

  interface Props {
    headings: HeadingEntry[];
    activeSlug: string | null;
    onJump: (slug: string) => void;
  }
  let { headings, activeSlug, onJump }: Props = $props();
</script>

<nav class="toc" aria-label="Plan contents">
  <div class="masthead">
    <span class="caret" aria-hidden="true">^</span>
    <span class="eyebrow">Contents</span>
  </div>
  {#if headings.length === 0}
    <p class="empty mono">— no headings —</p>
  {:else}
    <ul>
      {#each headings as h (h.blockId)}
        <li
          class="lvl-{h.level}"
          class:active={h.slug === activeSlug}
        >
          <button onclick={() => onJump(h.slug)} title={h.text}>
            {h.text}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</nav>

<style>
  .masthead {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 1.25rem;
  }
  .caret {
    font-family: var(--font-mono);
    font-size: 1.1rem;
    color: var(--accent);
    line-height: 1;
  }
  .empty {
    color: var(--ink-faint);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    border-left: 1px solid var(--rule);
  }
  li button {
    background: none;
    border: none;
    text-align: left;
    width: 100%;
    font-size: 0.86rem;
    line-height: 1.35;
    color: var(--ink-soft);
    padding: 0.28rem 0.5rem 0.28rem 0.9rem;
    margin-left: -1px;
    border-left: 2px solid transparent;
    transition:
      color 0.12s,
      border-color 0.12s;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li button:hover {
    color: var(--ink);
  }
  li.active button {
    color: var(--accent);
    border-left-color: var(--accent);
    font-weight: 600;
  }
  .lvl-2 button {
    padding-left: 1.6rem;
    font-size: 0.82rem;
  }
  .lvl-3 button {
    padding-left: 2.3rem;
    font-size: 0.8rem;
  }
  .lvl-4 button,
  .lvl-5 button,
  .lvl-6 button {
    padding-left: 3rem;
    font-size: 0.78rem;
  }
</style>
