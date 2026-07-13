<script lang="ts">
  // Test-only fixture: composes an open shadcn Dialog (Trigger + portalled
  // Content with Title/Description) so the mount test can characterize bits-ui's
  // portal + focus-trap under happy-dom. Not shipped — lives beside its test.
  import * as Dialog from "$lib/components/ui/dialog/index.js";

  let { open = false }: { open?: boolean } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger data-testid="trigger">Open</Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Proof of life</Dialog.Title>
      <Dialog.Description>bits-ui under happy-dom</Dialog.Description>
    </Dialog.Header>
  </Dialog.Content>
</Dialog.Root>
