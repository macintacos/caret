<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import type { ThemeId } from "../lib/theme.ts";
  import Modal from "./Modal.svelte";
  import ThemePicker from "./ThemePicker.svelte";

  interface Props {
    /** The theme currently applied — drives the picker's selected value + label. */
    current: ThemeId;
    /** Choose a theme. The host applies it immediately (with the wipe), so the whole
     * UI — this dialog included — retints in place; there is no Save. */
    onSelect: (id: ThemeId) => void;
    /** Dismiss the dialog. */
    onClose: () => void;
  }
  let { current, onSelect, onClose }: Props = $props();
</script>

<!-- Composes the shared Modal (kind="dialog": Escape + backdrop dismiss, routed to
     onClose). App gates this with {#if showSettings}, so it mounts open. -->
<Modal kind="dialog" open eyebrow="Appearance" title="Settings" onDismiss={onClose}>
  {#snippet description()}Switching the theme restyles the whole interface.{/snippet}

  <div class="field">
    <span class="field-label">Theme</span>
    <ThemePicker {current} {onSelect} />
  </div>

  {#snippet footer()}
    <Button onclick={onClose}>Done</Button>
  {/snippet}
</Modal>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .field-label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
</style>
