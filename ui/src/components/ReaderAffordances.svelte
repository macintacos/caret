<script lang="ts">
  // Reader-affordance control bar for the source-view surface. Sits in the
  // control row above the plan view and lets a reviewer wrap long lines (instead
  // of scrolling them) and hide the line-number gutter. Both affordances apply to
  // the single-version source view and the version-compare diff alike — they are
  // reader preferences for the rendered text, not compare-mode state. All state is
  // owned by the parent; this component is presentational and reports changes
  // through callback props.
  import type { Overflow } from "../lib/diffReaderPref.ts";

  interface Props {
    /** Active line-overflow behavior: scroll long lines or wrap them. */
    overflow: Overflow;
    /** Whether the line-number gutter is hidden. */
    disableLineNumbers: boolean;
    onSetOverflow: (overflow: Overflow) => void;
    onSetDisableLineNumbers: (disabled: boolean) => void;
  }

  let { overflow, disableLineNumbers, onSetOverflow, onSetDisableLineNumbers }: Props = $props();

  const wrapping = $derived(overflow === "wrap");
</script>

<div class="reader-affordances" role="group" aria-label="Reader options">
  <button
    type="button"
    class="reader-toggle wrap-toggle"
    class:on={wrapping}
    aria-pressed={wrapping}
    onclick={() => onSetOverflow(wrapping ? "scroll" : "wrap")}
  >
    Wrap lines
  </button>
  <button
    type="button"
    class="reader-toggle line-numbers-toggle"
    class:on={!disableLineNumbers}
    aria-pressed={!disableLineNumbers}
    onclick={() => onSetDisableLineNumbers(!disableLineNumbers)}
  >
    Line numbers
  </button>
</div>

<style>
  .reader-affordances {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* Each affordance echoes the compare toggle: a quiet bordered button that fills
     with the accent wash once the affordance is on. */
  .reader-toggle {
    background: transparent;
    color: var(--ink);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    padding: 0.35rem 0.75rem;
    font-size: var(--text-sm);
    font-weight: 600;
    white-space: nowrap;
  }
  .reader-toggle:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .reader-toggle.on {
    background: var(--accent-wash);
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
