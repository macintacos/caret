<script lang="ts">
  // The keyboard-shortcuts affordance pinned at the far right of the status bar
  // (EXC-787) — the vendored Lucide keyboard glyph paired with a ? key cap, which
  // ties the bar to the vim-shortcuts feature. StatusBar lays it out.
  import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import Icon from "@/components/Icon.svelte";

  interface Props {
    /** Open the shortcuts help modal. */
    onOpen: () => void;
  }
  let { onOpen }: Props = $props();
</script>

<span class="tray kbd-help-well">
  <button
    type="button"
    class="kbd-help float-chip"
    aria-label="Keyboard shortcuts"
    aria-keyshortcuts={ariaKeyshortcutsFor("help.show")}
    onclick={onOpen}
  >
    <Icon name="keyboard" size={15} />
    <Kbd class="kbd-sm">?</Kbd>
  </button>
</span>

<style>
  /* A small key in a well of its own, sized to fill the status bar's height. */
  .kbd-help {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    appearance: none;
    font: inherit;
    cursor: pointer;
    height: 1.5rem;
    padding: 0 0.4rem;
    border-radius: var(--key-radius);
  }
</style>
