<script lang="ts">
  // Version-compare control bar for the source-view surface. Sits above the
  // plan view and lets a reviewer enter compare mode, pick any two stored
  // versions (base vs. target), switch the diff layout between split and unified,
  // and switch the gutter change markers between vertical bars and classic +/-
  // glyphs. The "Compare versions" toggle is always present, but disabled (greyed
  // out) when fewer than two versions exist, since there is nothing to compare —
  // shown-but-disabled keeps the affordance discoverable (EXC-664). All state is
  // owned by the parent (the compare state factory); this component is
  // presentational and reports changes through callback props.
  //
  // The controls are composed from the shadcn-svelte catalog (EXC-764): the two
  // version pickers reuse the same bits-ui DropdownMenu the Settings ThemePicker
  // uses (soft float-chip trigger, chevron that points right when collapsed and
  // rotates down when open); the layout/indicator segmented controls are
  // single-select ToggleGroups (each option a role="radio"); the enter/exit
  // control is a Button toggle; and the disabled-state explanation is a Tooltip.
  // Every control shares the topbar's neutral float-chip surface language and one
  // fixed height, so the bar reads as one row and never changes height between the
  // resting and comparing views. Amber stays reserved for the topbar's Approve
  // primary; here it appears only as the --accent-wash "active-state" marker (the
  // ThemePicker/diff-selection language) on the pressed compare toggle. All colors
  // ride the shadcn↔caret token bridge; no raw colors.
  import type { PlanVersion } from "@core/types";
  import type { DiffIndicators, DiffStyle } from "../lib/diffview/types.ts";
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import Icon from "./Icon.svelte";

  interface Props {
    /** Every stored plan version, oldest first. */
    versions: PlanVersion[];
    /** Whether compare mode is active. */
    comparing: boolean;
    /** Whether there are enough versions to compare (the parent owns the rule). */
    canCompare: boolean;
    /** Selected reference version (the diff's "after" side). */
    baseVersion: number;
    /** Selected version compared against (the diff's "before" side). */
    targetVersion: number;
    /** Active diff layout. */
    diffStyle: DiffStyle;
    /** Active gutter change markers. */
    diffIndicators: DiffIndicators;
    onSetComparing: (comparing: boolean) => void;
    onSelectBase: (version: number) => void;
    onSelectTarget: (version: number) => void;
    onSetDiffStyle: (style: DiffStyle) => void;
    onSetDiffIndicators: (indicators: DiffIndicators) => void;
  }

  let {
    versions,
    comparing,
    canCompare,
    baseVersion,
    targetVersion,
    diffStyle,
    diffIndicators,
    onSetComparing,
    onSelectBase,
    onSelectTarget,
    onSetDiffStyle,
    onSetDiffIndicators,
  }: Props = $props();

  // Newest first reads most naturally in a picker — the current version is the
  // default base and sits at the top.
  const ordered = $derived([...versions].sort((a, b) => b.version - a.version));
</script>

<!-- A version picker, reused for both base and target. It is the same DropdownMenu
     the Settings ThemePicker is built on: a float-chip trigger and a portalled
     radio menu that commits-and-closes on pick. The chevron rotation (right when
     collapsed, down when open) rides bits-ui's aria-expanded via CSS, so no local
     open state is needed. -->
{#snippet versionPicker(ariaLabel: string, current: number, onPick: (v: number) => void)}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <button {...props} type="button" class="vpick float-chip" aria-label={ariaLabel}>
          <span class="vpick-label">v{current}</span>
          <!-- Vendored-icon convention (doc/agents/icon-rules.md): inline the Lucide
               chevron-down glyph so it can carry the rotation class. -->
          <svg
            class="chevron"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
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
      align="start"
      class="vmenu"
      style="min-width: var(--bits-dropdown-menu-anchor-width)"
    >
      <DropdownMenuPrimitive.RadioGroup
        value={String(current)}
        onValueChange={(v) => onPick(Number(v))}
      >
        {#each ordered as v (v.version)}
          <DropdownMenuPrimitive.RadioItem value={String(v.version)} class="vitem">
            {#snippet children({ checked })}
              <span class="check" aria-hidden="true">
                {#if checked}<Icon name="check" size={15} />{/if}
              </span>
              <span>v{v.version}</span>
            {/snippet}
          </DropdownMenuPrimitive.RadioItem>
        {/each}
      </DropdownMenuPrimitive.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<div class="compare-picker">
  {#if canCompare}
    <Button
      variant="secondary"
      size="sm"
      class="compare-toggle float-chip"
      aria-pressed={comparing}
      onclick={() => onSetComparing(!comparing)}
    >
      Compare versions
    </Button>
  {:else}
    <!-- Nothing to compare: shown-but-disabled (EXC-664). A disabled button
         swallows pointer events, so the "why" tooltip hangs off a span-wrapped
         trigger rather than the button itself. -->
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <span {...props} class="compare-toggle-wrap">
              <Button
                variant="secondary"
                size="sm"
                class="compare-toggle float-chip"
                disabled
                aria-pressed={false}
              >
                Compare versions
              </Button>
            </span>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>No other versions to compare yet</Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  {/if}

  {#if comparing}
    <div class="pair">
      <div class="field">
        <span class="lbl">Base</span>
        {@render versionPicker("Base version", baseVersion, (v) => onSelectBase(v))}
      </div>

      <span class="arrow" aria-hidden="true">→</span>

      <div class="field">
        <span class="lbl">Target</span>
        {@render versionPicker("Target version", targetVersion, (v) => onSelectTarget(v))}
      </div>
    </div>

    <div class="controls">
      <ToggleGroup.Root
        type="single"
        size="sm"
        aria-label="Diff layout"
        bind:value={
          () => diffStyle, (v) => { if (v) onSetDiffStyle(v as DiffStyle); }
        }
      >
        <ToggleGroup.Item value="split">Split</ToggleGroup.Item>
        <ToggleGroup.Item value="unified">Unified</ToggleGroup.Item>
      </ToggleGroup.Root>

      <!-- Gutter change markers: vertical bars (the inherited default) or the
           classic +/- glyphs many reviewers prefer. The glyphs inherit caret's
           ok/danger hue through the diffview bridge, so this only chooses the
           affordance, not the color. -->
      <ToggleGroup.Root
        type="single"
        size="sm"
        aria-label="Diff indicators"
        bind:value={
          () => diffIndicators, (v) => { if (v) onSetDiffIndicators(v as DiffIndicators); }
        }
      >
        <ToggleGroup.Item value="bars">Bars</ToggleGroup.Item>
        <ToggleGroup.Item value="classic">+/−</ToggleGroup.Item>
      </ToggleGroup.Root>
    </div>
  {/if}
</div>

<style>
  /* A group within the surface's control bar (DiffPlanView owns the bar chrome):
     a transparent inline cluster so the toolbar reads as one row. --ctl-h is the
     shared control height (matching the compare Button's h-7); min-height pins the
     row to it so entering/leaving compare mode never changes the bar's height. */
  .compare-picker {
    --ctl-h: 1.75rem;
    display: flex;
    align-items: center;
    gap: 0.85rem;
    min-height: var(--ctl-h);
    font-size: var(--text-base);
  }

  /* Neutral controls follow the topbar's float-chip language: .float-chip
     (app.css) supplies the resting + hover skin (soft --chip fill, no border,
     ink-soft label brightening to full ink). The compare toggle adds a pressed
     state that carries the --accent-wash "active-state" marker (the same amber
     wash the ThemePicker's active row and the diff selection use) while compare
     mode is on, so the mode switch is visible at a glance. */
  .compare-picker :global(.compare-toggle) {
    white-space: nowrap;
  }
  .compare-picker :global(.compare-toggle[aria-pressed="true"]:not(:disabled)) {
    background: var(--accent-wash);
    color: var(--ink);
  }
  .compare-picker :global(.compare-toggle[aria-pressed="true"]:not(:disabled):hover) {
    background: var(--accent-wash);
  }
  .compare-toggle-wrap {
    display: inline-flex;
  }

  .pair {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .field {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .lbl {
    color: var(--ink-faint);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .arrow {
    color: var(--ink-faint);
  }

  /* Version pickers reuse the Settings ThemePicker's DropdownMenu, so the trigger
     wears the same .float-chip skin as every neutral control. Sized to --ctl-h so
     it lines up with the compare Button and the segmented toggles. */
  .vpick {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    height: var(--ctl-h);
    padding: 0 0.55rem;
    border-radius: var(--radius);
    font-size: var(--text-sm);
    line-height: 1;
  }
  .vpick-label {
    font-variant-numeric: tabular-nums;
  }
  /* Mac disclosure affordance (matching ThemePicker): the chevron points RIGHT
     while collapsed and rotates DOWN when the menu opens. bits-ui sets
     aria-expanded on the trigger; the global reduced-motion guard in app.css
     neutralizes the rotation. */
  .vpick .chevron {
    flex: none;
    width: 0.85em;
    height: 0.85em;
    opacity: 0.6;
    transform: rotate(-90deg);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .vpick[aria-expanded="true"] .chevron {
    transform: rotate(0deg);
  }

  /* The portalled version menu carries this scope's classes; rows lay out
     [check] [label], with the active version's row highlighted on hover/keyboard
     via --chip-hover and marked with an amber check on --accent — the same
     language the ThemePicker menu uses. */
  :global(.vmenu .vitem) {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
    border-radius: var(--radius);
    font-size: var(--text-sm);
    color: var(--ink-soft);
    cursor: default;
    outline: none;
  }
  :global(.vmenu .vitem[data-highlighted]) {
    background: var(--chip-hover);
    color: var(--ink);
  }
  :global(.vmenu .vitem[aria-checked="true"]) {
    color: var(--ink);
  }
  :global(.vmenu .check) {
    flex: none;
    display: inline-flex;
    width: 15px;
    color: var(--accent);
  }

  /* The display-option cluster (layout + indicators), pushed to the trailing edge
     of the bar so the version pickers stay left and the toggles read as a group. */
  .controls {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
  }

  /* Segmented layout/indicator controls read as one recessed track with a lifted
     pill on the active option — neutral, borderless, no amber. The track is sized
     to --ctl-h so it matches the compare Button and the version pickers; the
     active pill rides the bar's raised paper out of the sunk track, inactive
     options stay quiet ink-soft. */
  .compare-picker :global([data-slot="toggle-group"]) {
    gap: 2px;
    height: var(--ctl-h);
    padding: 2px;
    background: var(--paper-sunk);
    border-radius: var(--radius);
  }
  .compare-picker :global([data-slot="toggle-group-item"]) {
    height: 100%;
    min-width: 0;
    border: 0;
    padding: 0 0.55rem;
    background: transparent;
    color: var(--ink-soft);
    border-radius: calc(var(--radius) - 2px);
    font-size: var(--text-sm);
  }
  .compare-picker :global([data-slot="toggle-group-item"]:hover:not([data-state="on"])) {
    color: var(--ink);
  }
  .compare-picker :global([data-slot="toggle-group-item"][data-state="on"]) {
    background: var(--chip);
    color: var(--ink);
  }

  /* Entering compare mode reveals the pickers + display toggles with a quick,
     subtle slide-in (EXC-664), timed off the shared one-shot motion tokens. Both
     revealed clusters animate together; the global #app reduced-motion rule
     neutralizes the movement. */
  .pair,
  .controls {
    animation: compare-reveal var(--dur-base) var(--ease-out);
  }
  @keyframes compare-reveal {
    from {
      opacity: 0;
      transform: translateX(-4px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
</style>
