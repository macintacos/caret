<script lang="ts">
  // One keymap id's caps folded into a single decorative Kbd, read from the keymap
  // table so the cap and the binding cannot drift.
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { isKbdKey, keyCapsFor } from "$lib/shortcuts/index.ts";
  import KbdCap from "@/components/KbdCap.svelte";

  let { id }: { id: string } = $props();
</script>

<Kbd class="shortcut-cap" aria-hidden="true"
  >{#each keyCapsFor(id).flat() as k}{#if isKbdKey(k)}<KbdCap key={k} />{:else}{k}{/if}{/each}</Kbd
>

<style>
  /* Fades in when the cursor lands and leaves at once, so a hop between stops never
     shows two sets of caps. Opacity only: the caps sit inside measured rows. */
  :global(.shortcut-cap) {
    animation: -global-cap-in var(--dur-state) var(--ease-out);
  }
  @keyframes -global-cap-in {
    from {
      opacity: 0;
    }
  }
</style>
