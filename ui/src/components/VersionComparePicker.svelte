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
  // version pickers are Selects, the layout/indicator segmented controls are
  // single-select ToggleGroups (each option a role="radio"), the enter/exit
  // control is a Button toggle, and the disabled-state explanation is a Tooltip.
  // They wear the topbar's neutral float-chip surface language (soft --chip fill,
  // no border, ink-soft label brightening to ink) rather than a bordered look —
  // amber stays brand-reserved for the topbar's Approve primary. All colors ride
  // the shadcn↔caret token bridge; no raw colors.
  import type { PlanVersion } from "@core/types";
  import type { DiffIndicators, DiffStyle } from "../lib/diffview/types.ts";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";

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
        <Select.Root
          type="single"
          bind:value={
            () => String(baseVersion), (v) => { if (v) onSelectBase(Number(v)); }
          }
        >
          <Select.Trigger size="sm" class="float-chip metric" aria-label="Base version"
            >v{baseVersion}</Select.Trigger
          >
          <Select.Content>
            {#each ordered as v (v.version)}
              <Select.Item value={String(v.version)} label={`v${v.version}`}>v{v.version}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <span class="arrow" aria-hidden="true">→</span>

      <div class="field">
        <span class="lbl">Target</span>
        <Select.Root
          type="single"
          bind:value={
            () => String(targetVersion), (v) => { if (v) onSelectTarget(Number(v)); }
          }
        >
          <Select.Trigger size="sm" class="float-chip metric" aria-label="Target version"
            >v{targetVersion}</Select.Trigger
          >
          <Select.Content>
            {#each ordered as v (v.version)}
              <Select.Item value={String(v.version)} label={`v${v.version}`}>v{v.version}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
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
     a transparent inline cluster so the toolbar reads as one row. */
  .compare-picker {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    font-size: var(--text-base);
  }

  /* Neutral controls follow the topbar's float-chip language: .float-chip
     (app.css) supplies the resting + hover skin (soft --chip fill, no border,
     ink-soft label brightening to full ink). The compare toggle adds a pressed
     state that brightens like an open dropdown trigger while compare mode is on. */
  .compare-picker :global(.compare-toggle) {
    white-space: nowrap;
  }
  .compare-picker :global(.compare-toggle[aria-pressed="true"]:not(:disabled)) {
    background: var(--chip-hover);
    color: var(--ink);
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

  /* Version pickers wear the same float-chip skin as the topbar's dropdown
     triggers (ReviewSwitcher): .float-chip supplies the fill + label tones; drop
     the catalog trigger's border so it reads as a soft chip, not a boxed field. */
  .compare-picker :global([data-slot="select-trigger"]) {
    border: 0;
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
     pill on the active option — neutral, borderless, no amber (the topbar keeps
     amber brand-reserved for Approve). The active pill rides the bar's raised
     paper out of the sunk track; inactive options stay quiet ink-soft. */
  .compare-picker :global([data-slot="toggle-group"]) {
    gap: 2px;
    padding: 2px;
    background: var(--paper-sunk);
    border-radius: var(--radius);
  }
  .compare-picker :global([data-slot="toggle-group-item"]) {
    border: 0;
    background: transparent;
    color: var(--ink-soft);
    border-radius: calc(var(--radius) - 2px);
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
