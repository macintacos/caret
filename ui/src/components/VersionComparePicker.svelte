<script lang="ts">
  // Version-compare control bar for the source-view surface. Sits above the
  // plan view and lets a reviewer enter compare mode, pick any two stored
  // versions (base vs. target), and switch the diff layout between split and
  // unified. The whole control is hidden — not disabled — when fewer than two
  // versions exist, since there is nothing to compare. All state is owned by the
  // parent (the compare state factory); this component is presentational and
  // reports changes through callback props.
  import type { PlanVersion } from "@core/types";
  import type { DiffStyle } from "../lib/diffview/types.ts";

  interface Props {
    /** Every stored plan version, oldest first. */
    versions: PlanVersion[];
    /** Whether compare mode is active. */
    comparing: boolean;
    /** Selected reference version (the diff's "after" side). */
    baseVersion: number;
    /** Selected version compared against (the diff's "before" side). */
    targetVersion: number;
    /** Active diff layout. */
    diffStyle: DiffStyle;
    onSetComparing: (comparing: boolean) => void;
    onSelectBase: (version: number) => void;
    onSelectTarget: (version: number) => void;
    onSetDiffStyle: (style: DiffStyle) => void;
  }

  let {
    versions,
    comparing,
    baseVersion,
    targetVersion,
    diffStyle,
    onSetComparing,
    onSelectBase,
    onSelectTarget,
    onSetDiffStyle,
  }: Props = $props();

  // Newest first reads most naturally in a picker — the current version is the
  // default base and sits at the top.
  const ordered = $derived([...versions].sort((a, b) => b.version - a.version));
</script>

{#if versions.length >= 2}
  <div class="compare-picker">
    <button
      type="button"
      class="compare-toggle"
      class:on={comparing}
      aria-pressed={comparing}
      onclick={() => onSetComparing(!comparing)}
    >
      Compare versions
    </button>

    {#if comparing}
      <div class="pair">
        <label class="field">
          <span class="lbl">Base</span>
          <select
            class="base-select metric"
            value={String(baseVersion)}
            onchange={(e) => onSelectBase(Number(e.currentTarget.value))}
          >
            {#each ordered as v (v.version)}
              <option value={String(v.version)}>v{v.version}</option>
            {/each}
          </select>
        </label>

        <span class="arrow" aria-hidden="true">→</span>

        <label class="field">
          <span class="lbl">Target</span>
          <select
            class="target-select metric"
            value={String(targetVersion)}
            onchange={(e) => onSelectTarget(Number(e.currentTarget.value))}
          >
            {#each ordered as v (v.version)}
              <option value={String(v.version)}>v{v.version}</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="layout" role="group" aria-label="Diff layout">
        <button
          type="button"
          data-style="split"
          class:active={diffStyle === "split"}
          aria-pressed={diffStyle === "split"}
          onclick={() => onSetDiffStyle("split")}
        >
          Split
        </button>
        <button
          type="button"
          data-style="unified"
          class:active={diffStyle === "unified"}
          aria-pressed={diffStyle === "unified"}
          onclick={() => onSetDiffStyle("unified")}
        >
          Unified
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .compare-picker {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.5rem clamp(1rem, 3vw, 2rem);
    border-bottom: 1px solid var(--rule);
    background: var(--paper-raised);
    font-size: var(--text-base);
  }

  /* The mode toggle echoes the topbar's accent treatment: a quiet bordered
     button that fills with the accent wash once compare mode is on. */
  .compare-toggle {
    background: transparent;
    color: var(--ink);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    padding: 0.35rem 0.75rem;
    font-size: var(--text-sm);
    font-weight: 600;
    white-space: nowrap;
  }
  .compare-toggle:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .compare-toggle.on {
    background: var(--accent-wash);
    border-color: var(--accent);
    color: var(--accent);
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
  .field select {
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    padding: 0.25rem 0.4rem;
    font-size: var(--text-sm);
  }
  .field select:hover {
    border-color: var(--accent);
  }
  .arrow {
    color: var(--ink-faint);
  }

  /* Segmented split/unified control. The active segment carries the accent fill,
     mirroring the primary-action emphasis used elsewhere in the shell. */
  .layout {
    display: inline-flex;
    margin-left: auto;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .layout button {
    background: var(--paper);
    color: var(--ink-soft);
    border: none;
    padding: 0.3rem 0.7rem;
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .layout button + button {
    border-left: 1px solid var(--rule-strong);
  }
  .layout button:hover:not(.active) {
    color: var(--ink);
    background: var(--paper-sunk);
  }
  .layout button.active {
    background: var(--accent);
    color: var(--accent-ink);
  }
</style>
