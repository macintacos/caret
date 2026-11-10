<script lang="ts">
  // Test-only fixture: reads ModalPresence's `open` from a derived record of two
  // flags, the way App hosts its modals. Not shipped; lives beside its test.
  import ModalPresence from "@/components/ModalPresence.svelte";

  let settings = $state(true);
  let other = $state(false);
  const modals = $derived({ settings, other });
</script>

<button type="button" class="toggle-settings" onclick={() => (settings = !settings)}
  >settings</button
>
<button type="button" class="toggle-other" onclick={() => (other = !other)}>other</button>
<ModalPresence open={modals.settings}>
  {#snippet modal()}
    <div class="surface"></div>
  {/snippet}
</ModalPresence>
