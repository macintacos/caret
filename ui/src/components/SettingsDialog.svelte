<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import type { ThemeId } from "$lib/theme.ts";
  import Modal from "@/components/Modal.svelte";
  import ThemePicker from "@/components/ThemePicker.svelte";

  interface Props {
    /** The theme currently applied — drives the picker's selected value + label. */
    current: ThemeId;
    /** Choose a theme. The host applies it immediately (with the wipe), so the whole
     * UI — this dialog included — retints in place; there is no Save. */
    onSelect: (id: ThemeId) => void;
    /** Whether the keyboard-shortcut hint affordances are shown — drives the switch. */
    showShortcutHints: boolean;
    /** Toggle the shortcut hints. The host applies it live (persists + updates the
     * reactive flag), so the affordances hide/show in place; there is no Save. */
    onToggleShortcutHints: (show: boolean) => void;
    /** Dismiss the dialog. */
    onClose: () => void;
  }
  let { current, onSelect, showShortcutHints, onToggleShortcutHints, onClose }: Props = $props();
</script>

<!-- Composes the shared Modal (kind="dialog": Escape + backdrop dismiss, routed to
     onClose). App gates this with {#if showSettings}, so it mounts open. -->
<Modal kind="dialog" open eyebrow="Appearance" title="Settings" onDismiss={onClose}>
  {#snippet description()}Switching the theme restyles the whole interface.{/snippet}

  <div class="field">
    <span class="field-label">Theme</span>
    <ThemePicker {current} {onSelect} />
  </div>

  <!-- A toggle setting: label + one-line explainer on the left, the switch flush
       right. Distinct from the stacked theme field above — a small control reads
       better inline. Applies live like the theme picker, no Save. -->
  <div class="field field-toggle">
    <span class="field-text">
      <span class="field-label" id="shortcut-hints-label">Shortcut hints</span>
      <span class="field-desc" id="shortcut-hints-desc">Show key-cap hints and the keyboard button.</span>
    </span>
    <Switch
      checked={showShortcutHints}
      onCheckedChange={onToggleShortcutHints}
      aria-labelledby="shortcut-hints-label"
      aria-describedby="shortcut-hints-desc"
    />
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
  /* Toggle row: text block left, switch right. */
  .field-toggle {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .field-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .field-label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .field-desc {
    font-size: var(--text-xs);
    color: var(--ink-soft);
  }
</style>
