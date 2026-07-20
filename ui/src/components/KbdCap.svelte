<script lang="ts">
  // Renders one typed keyboard cap: the shared shift icon for the "shift" key,
  // else the key's own glyph text. It renders the cap *content* only — the caller
  // supplies the <Kbd> box, so the help modal can wrap one cap per key while the
  // status bar folds a whole chord (⇧C) into a single key. The KbdKey prop is the
  // schema kbdCap() exhausts, so the shift icon is reachable only by passing the
  // literal "shift". `size` tunes the icon to the surrounding cap (smaller in the
  // dense status bar than in the help modal); it is inert for a text cap.
  import { kbdCap, type KbdKey } from "$lib/shortcuts/index.ts";
  import Icon from "@/components/Icon.svelte";

  let { key, size = 12 }: { key: KbdKey; size?: number } = $props();
  const render = $derived(kbdCap(key));
</script>

{#if "icon" in render}<Icon name={render.icon} {size} label={render.label} />{:else}{render.text}{/if}
