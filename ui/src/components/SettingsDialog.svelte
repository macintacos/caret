<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { type ThemeId, THEME_IDS, THEMES } from "../lib/theme.ts";

  interface Props {
    /** The theme currently applied — the dropdown's selected value. */
    current: ThemeId;
    /** Choose a theme. The host applies it immediately (with the wipe), so the
     * whole UI — this dialog included — retints in place; there is no Save. */
    onSelect: (id: ThemeId) => void;
    /** Dismiss the dialog. */
    onClose: () => void;
  }
  let { current, onSelect, onClose }: Props = $props();

  // The trigger shows the applied theme's human label. Controlled by `current`
  // (App owns the theme), so selecting one retints the whole UI live with no
  // local state to keep in sync.
  const triggerLabel = $derived(THEMES[current]?.label ?? "Select theme");
</script>

<!-- shadcn Dialog gives real focus-trap, scroll-lock, Escape, and backdrop-to-
     close for free (bits-ui). App gates this with {#if showSettings}, so it mounts
     open; bits-ui's close intents (Escape/backdrop) route through onOpenChange to
     the existing onClose prop. No close-X: the Done button is the explicit dismiss. -->
<Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
  <Dialog.Content showCloseButton={false}>
    <Dialog.Header>
      <span class="eyebrow">Appearance</span>
      <Dialog.Title>Settings</Dialog.Title>
      <Dialog.Description>Switching the theme restyles the whole interface.</Dialog.Description>
    </Dialog.Header>

    <div class="field">
      <span class="field-label" id="theme-label">Theme</span>
      <Select.Root type="single" value={current} onValueChange={(v) => onSelect(v as ThemeId)}>
        <Select.Trigger class="w-full" aria-labelledby="theme-label">{triggerLabel}</Select.Trigger>
        <Select.Content>
          {#each THEME_IDS as id (id)}
            <Select.Item value={id} label={THEMES[id].label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    <Dialog.Footer>
      <Button onclick={onClose}>Done</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  /* caret's signature dialog identity — the uppercase eyebrow over the title —
     carried on this component's own elements (the shadcn panel, title, and
     description wear the bridged shadcn look). Colors ride caret tokens only. */
  .eyebrow {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
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
