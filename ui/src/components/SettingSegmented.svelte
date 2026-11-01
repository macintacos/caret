<script lang="ts">
  // A setting rendered as an always-visible segmented control (EXC-773) — every
  // option readable at a glance, no menu to open — for a small fixed option set
  // where the current choice should never need a click to discover. The theme
  // Mode control (Light / Dark / System) is the case it exists for.
  //
  // Composed from the shadcn ToggleGroup (single-select, each option role="radio"),
  // the same primitive the compare bar's layout/marker controls use. The active segment
  // wears the neutral cap's face, the app's "this control is engaged" language; amber is
  // kept for the primary action.
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
    /** The id of the row's `<label>` element, which names this group (EXC-1112).
     * A toggle group renders a `<div role="group">` — not a labelable element —
     * so `<label for>` is inert on it and `aria-labelledby` is the association
     * ARIA gives a composite widget. The name still comes from the visible label,
     * not a parallel string. */
    labelledBy: string;
  }
  let { value, options, onSelect, labelledBy }: Props = $props();
</script>

<div class="segmented">
  <ToggleGroup.Root
    type="single"
    size="sm"
    aria-labelledby={labelledBy}
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
  /* A segment: icon + label on a key (styles/atoms.css), the chosen one latched down. */
  .segmented :global([data-slot="toggle-group-item"]) {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    /* Matches the SettingSelect trigger beside it in the same pane. */
    height: 1.85rem;
    /* The settings Field nudges every role="radio" inside it down a pixel (its mt-px is
       meant for a radio beside its label), which would sit this key low in its bed. */
    margin: 0;
    padding: 0 0.6rem;
    font-size: var(--text-sm);
  }
</style>
