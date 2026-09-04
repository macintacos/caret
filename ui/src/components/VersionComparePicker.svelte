<script lang="ts">
  // Version-compare control bar for the source-view surface: enter compare mode,
  // pick any two stored versions (base vs. target), and switch the diff layout and
  // the gutter change markers. The "Versions" toggle is shown-but-disabled when
  // fewer than two versions exist, which keeps the affordance discoverable
  // (EXC-664). All state is owned by the parent (the compare state factory); this
  // component is presentational and reports changes through callback props.
  //
  // The controls are composed from the shadcn-svelte catalog (EXC-764), and every
  // one shares the topbar's neutral float-chip surface language and one fixed
  // height, so the bar reads as one row and never changes height between the
  // resting and comparing views. Amber stays reserved for the topbar's Approve
  // primary; here it appears only as the --accent-wash "active-state" marker (the
  // SettingSelect/diff-selection language) on the pressed compare toggle. All colors
  // ride the shadcn↔caret token bridge; no raw colors.
  import type { PlanVersion } from "@core/lib/types";
  import type { DiffIndicators, DiffStyle } from "$lib/diffview/types.ts";
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";
  import Icon from "@/components/Icon.svelte";

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
    /** When the parent forces unified (below --w-narrow, where split's two
     * columns can't fit), the Split/Unified toggle is removed — there's nothing
     * to pick. The Bars/+−/Both marker toggle stays; markers work in a unified
     * diff. Defaults false (the wide-width layout is unchanged). */
    layoutLocked?: boolean;
    /** Whether to render the `d` keyboard-shortcut hint on the compare toggle,
     * gated on the app's shortcut-hints setting like the other hints. Defaults
     * false (the hint is opt-in via the parent). */
    showShortcutHints?: boolean;
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
    layoutLocked = false,
    showShortcutHints = false,
    onSetComparing,
    onSelectBase,
    onSelectTarget,
    onSetDiffStyle,
    onSetDiffIndicators,
  }: Props = $props();

  // Newest first reads most naturally in a picker — the current version is the
  // default base and sits at the top.
  const ordered = $derived([...versions].sort((a, b) => b.version - a.version));

  // How many OTHER versions the current one can be diffed against — the toggle's
  // count badge (EXC-804). N-1, not N: it answers "what is there to compare
  // against", the same framing as the disabled tooltip's "No other versions to
  // compare yet". Can go negative on an empty set; the render guard reads `> 0`, so
  // that needs no clamp here.
  const otherCount = $derived(versions.length - 1);

  // The newest version — the plan as it stands now, annotated in the pickers so a
  // reviewer choosing a pair can tell which end is current without counting.
  // `ordered`'s head rather than a re-derived max: it is already sorted newest-first.
  const currentVersion = $derived(ordered[0]?.version);

  // Sliding pill for the segmented ToggleGroups: one shared pill rides behind the
  // options rather than each painting its own background, so a CSS transform/width
  // transition carries the selection and redirects mid-slide when a third option is
  // clicked. mountSlider injects the pill and keeps it aligned to the active
  // [data-state="on"] option via measurement — options are content-sized, so a
  // pure-CSS index offset wouldn't line up.
  let layoutTrack = $state<HTMLElement | null>(null);
  let indicatorsTrack = $state<HTMLElement | null>(null);

  function mountSlider(node: HTMLElement) {
    const pill = document.createElement("span");
    pill.className = "seg-pill";
    pill.setAttribute("aria-hidden", "true");
    node.prepend(pill);

    const sync = () => {
      const active = node.querySelector<HTMLElement>('[data-state="on"]');
      if (!active) {
        pill.style.opacity = "0";
        return;
      }
      const nb = node.getBoundingClientRect();
      const ab = active.getBoundingClientRect();
      pill.style.width = `${ab.width}px`;
      pill.style.height = `${ab.height}px`;
      pill.style.transform = `translate(${ab.left - nb.left}px, ${ab.top - nb.top}px)`;
      pill.style.opacity = "1";
    };

    // Place the pill on the initial selection without animating in from the corner.
    pill.style.transition = "none";
    let raf = requestAnimationFrame(() => {
      sync();
      raf = requestAnimationFrame(() => {
        pill.style.transition = "";
      });
    });

    // bits-ui flips data-state on the options when the value changes; re-measure
    // then, and on any resize (font load, window resize).
    const mo = new MutationObserver(sync);
    mo.observe(node, { attributes: true, attributeFilter: ["data-state"], subtree: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(node);

    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro?.disconnect();
      pill.remove();
    };
  }

  $effect(() => (layoutTrack ? mountSlider(layoutTrack) : undefined));
  $effect(() => (indicatorsTrack ? mountSlider(indicatorsTrack) : undefined));
</script>

<!-- A version picker, reused for both base and target. The chevron rotation (right
     when collapsed, down when open) rides bits-ui's aria-expanded via CSS, so no
     local open state is needed. -->
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
              {#if v.version === currentVersion}<span class="cur">(current)</span>{/if}
            {/snippet}
          </DropdownMenuPrimitive.RadioItem>
        {/each}
      </DropdownMenuPrimitive.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<!-- The toggle's leading git-compare glyph + label (EXC-808), shared by the enabled
     and disabled buttons so the affordance stays identical. The icon is decorative
     (aria-hidden via Icon.svelte), so the accessible name is this text alone —
     extended with the version count when there is one (EXC-804). -->
{#snippet compareLabel()}
  <Icon name="git-compare" size={14} />Versions
{/snippet}

<div class="compare-picker">
  {#if canCompare}
    <Button
      variant="secondary"
      size="sm"
      class="compare-toggle float-chip"
      aria-pressed={comparing}
      aria-keyshortcuts={ariaKeyshortcutsFor("actions.toggleDiff")}
      aria-label={otherCount > 0
        ? `Versions, ${otherCount} other version${otherCount === 1 ? "" : "s"}`
        : undefined}
      onclick={() => onSetComparing(!comparing)}
    >
      {@render compareLabel()}
      <!-- How many other versions there are to compare against (EXC-804): the TopBar
           pending-count Badge, shape and hue alike — both are counts doing the
           novelty job, so both wear .count-attention (atoms.css). Guarded on the
           count, since a "0" tally would be noise. aria-hidden because ARIA prohibits
           a name on a <span> (role=generic); the count reaches AT through the
           button's own aria-label above instead. -->
      {#if otherCount > 0}
        <Badge variant="secondary" class="count count-attention metric" aria-hidden="true">
          {otherCount}
        </Badge>
      {/if}
      <!-- The `d` shortcut toggles compare mode; the cap teaches it. Only on the
           enabled toggle (the disabled one has no shortcut), aria-hidden so the
           cap's glyph never lands in the button's name. -->
      {#if showShortcutHints}
        <Kbd class="kbd-sm shortcut-cap" aria-hidden="true">d</Kbd>
      {/if}
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
                {@render compareLabel()}
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
      <!-- The layout choice is only offered when the parent isn't forcing unified.
           Below --w-narrow split can't fit, so the toggle is removed rather than
           left as a dead control (EXC-811). -->
      {#if !layoutLocked}
        <ToggleGroup.Root
          type="single"
          size="sm"
          aria-label="Diff layout"
          bind:ref={layoutTrack}
          bind:value={
            () => diffStyle, (v) => { if (v) onSetDiffStyle(v as DiffStyle); }
          }
        >
          <ToggleGroup.Item value="split">Split</ToggleGroup.Item>
          <ToggleGroup.Item value="unified">Unified</ToggleGroup.Item>
        </ToggleGroup.Root>
      {/if}

      <!-- The gutter markers inherit caret's ok/danger hue through the diffview
           bridge, so this chooses the affordance, not the color. -->
      <ToggleGroup.Root
        type="single"
        size="sm"
        aria-label="Diff indicators"
        bind:ref={indicatorsTrack}
        bind:value={
          () => diffIndicators, (v) => { if (v) onSetDiffIndicators(v as DiffIndicators); }
        }
      >
        <ToggleGroup.Item value="bars">Bars</ToggleGroup.Item>
        <ToggleGroup.Item value="classic">+/−</ToggleGroup.Item>
        <ToggleGroup.Item value="both">Both</ToggleGroup.Item>
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
    /* Wrap only when the row genuinely overflows: a no-op at wide widths (so the
       one-line bar and its toggles are unchanged), but at the narrow floor the
       pickers + marker toggle drop to a second line instead of overflowing the
       surface (EXC-811). */
    flex-wrap: wrap;
    gap: 0.85rem;
    min-height: var(--ctl-h);
    font-size: var(--text-base);
  }

  /* .float-chip (app.css) supplies the resting + hover skin; the compare toggle adds
     a pressed state carrying the --accent-wash "active-state" marker — the same amber
     wash the SettingSelect's active row and the diff selection use — so the mode
     switch is visible at a glance. */
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
  /* Nudge the `d` shortcut cap a hair further right of the label than the
     button's own gap gives it. */
  .compare-picker :global(.compare-toggle .shortcut-cap) {
    margin-inline-start: 0.15rem;
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

  /* Sized to --ctl-h so the trigger lines up with the compare Button and the
     segmented toggles. */
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
  /* Mac disclosure affordance (matching SettingSelect): the chevron points RIGHT
     while collapsed and rotates DOWN when the menu opens. bits-ui sets
     aria-expanded on the trigger; the global reduced-motion guard in app.css
     neutralizes the rotation. */
  .vpick .chevron {
    flex: none;
    width: 0.85em;
    height: 0.85em;
    opacity: 0.6;
    transform: rotate(-90deg);
    transition: transform var(--dur-micro) var(--ease-out);
  }
  .vpick[aria-expanded="true"] .chevron {
    transform: rotate(0deg);
  }

  /* The version menu is portalled, so its rows are reached through :global. The
     amber check on --accent is the DropdownMenu's own selection language. */
  :global(.vmenu .vitem) {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
    border-radius: var(--radius);
    font-size: var(--text-sm);
    color: var(--ink-soft);
    cursor: pointer;
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
  /* The "(current)" marker on the newest row: the quietest ink in the menu, so it
     reads as an annotation on the version rather than a second label competing
     with it. */
  :global(.vmenu .cur) {
    color: var(--ink-faint);
    font-size: var(--text-xs);
  }

  /* The display-option cluster (layout + indicators), pushed to the trailing edge
     of the bar so the version pickers stay left and the toggles read as a group. */
  .controls {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
  }

  /* One recessed track with a lifted pill on the active option — neutral, no amber
     — sized to --ctl-h so it matches the compare Button and the version pickers. The
     active fill is NOT painted per-option: one shared .seg-pill (injected by
     mountSlider) rides behind them and slides, and position: relative anchors it. */
  .compare-picker :global([data-slot="toggle-group"]) {
    position: relative;
    gap: 2px;
    height: var(--ctl-h);
    padding: 2px;
    background: var(--paper-sunk);
    border-radius: var(--radius);
  }
  /* The sliding active-option pill, behind the option labels. Its transition
     redirects mid-slide when a new option is clicked, so rapid switches stay fluid;
     the #app reduced-motion guard zeroes it, so it simply snaps. */
  .compare-picker :global(.seg-pill) {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 0;
    opacity: 0;
    border-radius: calc(var(--radius) - 2px);
    background: var(--chip);
    pointer-events: none;
    transition:
      transform var(--dur-enter) var(--ease-spring),
      width var(--dur-enter) var(--ease-spring);
  }
  .compare-picker :global([data-slot="toggle-group-item"]) {
    position: relative;
    z-index: 1;
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
    color: var(--ink);
  }

  /* Entering compare mode reveals both clusters together with a quick slide-in
     (EXC-664); the global #app reduced-motion rule neutralizes the movement. */
  .pair,
  .controls {
    animation: compare-reveal var(--dur-enter) var(--ease-out);
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
