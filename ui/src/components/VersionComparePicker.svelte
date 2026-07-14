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
  // control is a Toggle, and the disabled-state explanation is a Tooltip. The
  // caret skin (amber-wash selection, hairline borders) is applied over the
  // catalog defaults through the shadcn↔caret token bridge — no raw colors.
  import type { PlanVersion } from "@core/types";
  import type { DiffIndicators, DiffStyle } from "../lib/diffview/types.ts";
  import * as Select from "$lib/components/ui/select/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import { Toggle } from "$lib/components/ui/toggle/index.js";
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
    <Toggle
      variant="outline"
      size="sm"
      class="compare-toggle"
      bind:pressed={() => comparing, (v) => onSetComparing(v)}
    >
      Compare versions
    </Toggle>
  {:else}
    <!-- Nothing to compare: shown-but-disabled (EXC-664). A disabled button
         swallows pointer events, so the "why" tooltip hangs off a span-wrapped
         trigger rather than the button itself. -->
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <span {...props} class="compare-toggle-wrap">
              <Toggle variant="outline" size="sm" class="compare-toggle" disabled pressed={false}>
                Compare versions
              </Toggle>
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
          <Select.Trigger size="sm" aria-label="Base version">v{baseVersion}</Select.Trigger>
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
          <Select.Trigger size="sm" aria-label="Target version">v{targetVersion}</Select.Trigger>
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
        variant="outline"
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
        variant="outline"
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

  /* The catalog Toggle brings the bordered chip shape; the caret skin recolors
     it: quiet at rest, amber wash once compare mode is on, greyed when there is
     nothing to compare. Scoped under .compare-picker so these token rules win
     over the component's own bridged utilities. */
  .compare-picker :global(.compare-toggle) {
    border-color: var(--rule-strong);
    color: var(--ink);
    padding-inline: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .compare-picker :global(.compare-toggle:hover:not(:disabled)) {
    border-color: var(--accent);
    color: var(--accent);
  }
  /* Neutralize the outline variant's chip-hover fill, but only while the toggle
     is off — an on toggle keeps its amber wash when hovered. */
  .compare-picker :global(.compare-toggle:not([data-state="on"]):hover:not(:disabled)) {
    background: transparent;
  }
  .compare-picker :global(.compare-toggle[data-state="on"]) {
    background: var(--accent-wash);
    border-color: var(--accent);
    color: var(--accent);
  }
  .compare-picker :global(.compare-toggle:disabled) {
    color: var(--ink-faint);
    border-color: var(--rule);
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

  /* The display-option cluster (layout + indicators), pushed to the trailing edge
     of the bar so the version pickers stay left and the toggles read as a group. */
  .controls {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
  }

  /* The active segment carries the amber selection wash — the same "amber marks
     the selection" language the diff view and menus use — so the current choice
     reads distinct from one merely hovered. */
  .compare-picker :global([data-slot="toggle-group-item"][data-state="on"]) {
    background: var(--accent-wash);
    color: var(--accent);
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
