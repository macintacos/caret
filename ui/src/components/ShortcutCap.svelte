<script lang="ts">
  // One keymap id's caps folded into a single decorative Kbd, read from the keymap
  // table so the cap and the binding cannot drift. `data-cap` names the comment key.
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { isKbdKey, keyCapsFor } from "$lib/shortcuts/index.ts";
  import KbdCap from "@/components/KbdCap.svelte";

  let { id, cap }: { id: string; cap: string } = $props();
</script>

<Kbd aria-hidden="true" data-cap={cap}
  >{#each keyCapsFor(id).flat() as k, i (i)}{#if isKbdKey(k)}<KbdCap key={k} />{:else}{k}{/if}{/each}</Kbd
>
