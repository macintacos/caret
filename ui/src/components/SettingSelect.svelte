<script lang="ts">
  // A generic setting dropdown (EXC-843): a float-chip trigger showing the current
  // option's label, opening a bits-ui DropdownMenu radio list that commits and closes
  // on pick. Unlike a live-preview picker that applies each value as you arrow through
  // it, this fires onSelect only for the chosen value, then closes — the setting
  // applies immediately on pick. One component renders every `select` control in the
  // registry (theme, diff layout, diff markers).
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";

  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    /** The current value — the selected radio and the trigger label. */
    value: string;
    /** The choices, in display order. */
    options: readonly Option[];
    /** Apply the picked value. bits-ui commits and closes the menu on select. */
    onSelect: (value: string) => void;
    /** Accessible name for the trigger (the field's label). */
    ariaLabel: string;
  }
  let { value, options, onSelect, ariaLabel }: Props = $props();

  // The trigger shows the current option's label; fall back to the raw value so an
  // unknown value stays visible rather than blanking.
  const triggerLabel = $derived(options.find((o) => o.value === value)?.label ?? value);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <button {...props} type="button" class="trigger float-chip" aria-label={ariaLabel}>
        <span class="trigger-label">{triggerLabel}</span>
        <!-- Vendored-icon convention (doc/agents/icon-rules.md): inline the Lucide
             chevron-down glyph rather than import @lucide/svelte. -->
        <svg
          class="chevron"
          xmlns="http://www.w3.org/2000/svg"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    {/snippet}
  </DropdownMenu.Trigger>

  <DropdownMenu.Content
    align="end"
    class="setting-menu"
    style="min-width: var(--bits-dropdown-menu-anchor-width)"
  >
    <DropdownMenuPrimitive.RadioGroup {value} onValueChange={(v) => onSelect(v)}>
      {#each options as option (option.value)}
        <DropdownMenuPrimitive.RadioItem
          value={option.value}
          data-setting-option={option.value}
          class="setting-item"
        >
          {#snippet children({ checked })}
            <span class="check" aria-hidden="true">
              {#if checked}
                <!-- Inline Lucide check glyph (vendored-icon convention). -->
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              {/if}
            </span>
            <span class="name">{option.label}</span>
          {/snippet}
        </DropdownMenuPrimitive.RadioItem>
      {/each}
    </DropdownMenuPrimitive.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<style>
  /* Trigger: a compact select-like control wearing the topbar's floating chip (soft
     fill, no hard border, ink-soft label brightening on hover / while open — the
     .float-chip atom supplies the fill + ink treatment). Sizes to its content and
     sits flush-right in the field row. */
  .trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem;
    border-radius: var(--radius);
    font-size: var(--text-sm);
    text-align: left;
  }
  .trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chevron {
    flex: none;
    opacity: 0.6;
    /* Mac disclosure affordance: the chevron points RIGHT while collapsed and
       rotates DOWN when the menu opens (reduced-motion is caught by the global
       guard in app.css). */
    transform: rotate(-90deg);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .trigger[aria-expanded="true"] .chevron {
    transform: rotate(0deg);
  }

  /* The menu carries the scope hash into the portal via these classes. Rows lay out
     as [check] [label]; the highlight (hover / keyboard focus) lifts to the topbar's
     --chip-hover so it matches every other neutral control, while the ACTIVE row
     carries an amber wash — the same "amber marks the selection" language the diff
     view and theme picker use. Highlight is declared after so it wins when a row is
     both. */
  :global(.setting-menu .setting-item) {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.55rem;
    border-radius: var(--radius);
    font-size: var(--text-sm);
    color: var(--ink-soft);
    cursor: pointer;
    outline: none;
  }
  :global(.setting-menu .setting-item[aria-checked="true"]) {
    background: var(--accent-wash);
    color: var(--ink);
  }
  :global(.setting-menu .setting-item[data-highlighted]) {
    background: var(--chip-hover);
    color: var(--ink);
  }
  :global(.setting-menu .check) {
    flex: none;
    display: inline-flex;
    width: 0.95rem;
    color: var(--accent);
  }
  :global(.setting-menu .name) {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
  }
</style>
