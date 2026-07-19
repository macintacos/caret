<script lang="ts">
  // The keyboard-shortcuts affordance pinned at the far right of the status bar
  // (EXC-787) — the vendored Lucide keyboard glyph paired with a ? key cap, the
  // one accent moment that ties the bar to the vim-shortcuts feature. A flat bar
  // segment, not self-pinned; StatusBar lays it out.
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import Icon from "@/components/Icon.svelte";

  interface Props {
    /** Open the shortcuts help modal. */
    onOpen: () => void;
  }
  let { onOpen }: Props = $props();
</script>

<button type="button" class="kbd-help" aria-label="Keyboard shortcuts" onclick={onOpen}>
  <Icon name="keyboard" size={15} />
  <Kbd class="kbd-sm">?</Kbd>
</button>

<style>
  /* Quiet at rest (ink-soft, no fill), brightening to a restrained amber on hover
     so it invites "press ? for shortcuts" without spending amber at rest. */
  .kbd-help {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    appearance: none;
    border: none;
    background: none;
    font: inherit;
    cursor: pointer;
    color: var(--ink-soft);
    padding: 0.1rem 0.25rem;
    border-radius: var(--radius);
    transition: color var(--dur-fast) var(--ease-out);
  }
  .kbd-help:hover {
    color: var(--accent);
  }
  .kbd-help:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
</style>
