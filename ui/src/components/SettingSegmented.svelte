<script lang="ts">
  // A setting rendered as an always-visible segmented control (EXC-773) — every
  // option readable at a glance, no menu to open — for a small fixed option set
  // where the current choice should never need a click to discover. The theme
  // Mode control (Light / Dark / System) is the case it exists for.
  //
  // Composed from the shadcn ToggleGroup (single-select, each option role="radio"),
  // the same primitive the compare bar's layout/marker controls use. It carries NO
  // amber, unlike those: in the theme section amber marks which palette is actually
  // showing (the IN USE pill), so spending it on the mode segment too would flatten
  // the distinction between what you picked and what that resolves to. The active
  // segment instead wears the topbar's lifted-chip fill, which is the app's neutral
  // "this control is engaged" language.
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import type { SettingOption } from "$lib/settingsRegistry.ts";
  import Icon from "@/components/Icon.svelte";

  interface Props {
    /** The current value — the pressed segment. */
    value: string;
    /** The choices, in display order. */
    options: readonly SettingOption[];
    /** Apply the picked value. */
    onSelect: (value: string) => void;
    /** Accessible name for the group (the field's label). */
    ariaLabel: string;
  }
  let { value, options, onSelect, ariaLabel }: Props = $props();
</script>

<div class="segmented">
  <ToggleGroup.Root
    type="single"
    size="sm"
    aria-label={ariaLabel}
    bind:value={
      () => value,
      (v) => {
        // bits-ui clears the value when the pressed segment is re-pressed; a mode
        // is never "none", so hold the current one instead of applying undefined.
        if (v) onSelect(v);
      }
    }
  >
    {#each options as option (option.value)}
      <ToggleGroup.Item value={option.value} data-setting-option={option.value}>
        {#if option.icon}
          <Icon name={option.icon} size={14} />
        {/if}
        <span>{option.label}</span>
      </ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>
</div>

<style>
  /* The track: a hairline-bounded group, transparent at rest, so the segments
     read as one control without adding a second surface to the pane. */
  .segmented :global([data-slot="toggle-group"]) {
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius);
    box-shadow: inset 0 0 0 1px var(--rule);
  }
  /* A segment: icon + label, quiet ink-soft at rest. Height matches the
     SettingSelect trigger beside it in the same pane, so the rows keep one rhythm. */
  .segmented :global([data-slot="toggle-group-item"]) {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 1.85rem;
    padding: 0 0.6rem;
    border-radius: calc(var(--radius) - 1px);
    font-size: var(--text-sm);
    color: var(--ink-soft);
    background: transparent;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  /* Hover on an unpressed segment takes the topbar's chip tint — the same
     neutral hover every other control in the modal uses. */
  .segmented :global([data-slot="toggle-group-item"][data-state="off"]:hover) {
    background: var(--chip);
    color: var(--ink);
  }
  /* The pressed segment is the lifted chip: a solid neutral fill and full ink,
     so which mode is on reads at a glance without opening anything. */
  .segmented :global([data-slot="toggle-group-item"][data-state="on"]) {
    background: var(--chip-hover);
    color: var(--ink);
    font-weight: 600;
  }
</style>
