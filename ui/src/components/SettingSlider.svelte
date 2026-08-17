<script lang="ts">
  // A setting rendered as a continuous slider (EXC-1101) — the sound volume is the
  // one caret has. Composed from the vendored shadcn Slider, the same thin-wrapper
  // shape SettingSegmented.svelte takes over ToggleGroup: the primitive keeps its
  // behaviour and ARIA, and everything caret-specific lives in this file's scoped
  // style rather than inside the vendored tree, which a re-sync reverts wholesale
  // (doc/agents/shadcn-rules.md § Adding a component that collides with the vendored
  // tree). Svelte does not scope-hash a class handed to a COMPONENT, so those rules
  // are written in the `.volume :global(…)` form, exactly as SettingSegmented's are.
  //
  // The value is a WHOLE PERCENT. Its field converts to whatever unit the preference
  // stores (volume keeps a 0–1 multiplier), which is what lets the thumb announce
  // "40%" rather than "0.4" — a number a listener can act on.
  //
  // WHY THE WRITE IS COALESCED. Every settings write raises a confirmation toast, and
  // every toast plays a cue — so a write per step means a stack of toasts and a burst
  // of chimes. bits-ui fires its commit on EVERY arrow keydown (SliderThumbState's
  // onkeydown calls onValueCommit unconditionally), so nudging the volume from 25% to
  // 60% by keyboard is seven of them. Holding the value until the reviewer stops
  // moving turns one adjustment into one write, and the single chime that follows
  // plays AT the volume just set — which is the audible preview a volume control
  // wants, with no preview-sound code of its own.
  import { Slider } from "$lib/components/ui/slider/index.js";

  interface Props {
    /** The persisted value, as a whole percent. */
    value: number;
    /** Apply a new value once the reviewer settles on it. */
    onSelect: (value: number) => void;
    /** The id of the row's `<label>` element, which names this control (EXC-1112).
     * bits-ui puts `role="slider"` on the thumb inside a plain `<span>` root, so
     * `<label for>` has nothing labelable to bind to and `aria-labelledby` is the
     * association ARIA gives instead. The name still comes from the visible label. */
    labelledBy: string;
    /**
     * setTimeout-shaped: run `fn` after `ms`, returning a cancel fn. Injectable so
     * tests drive the commit window deterministically, the same seam
     * state/alerts.ts and lib/safeMode.ts take. Defaults to setTimeout.
     */
    schedule?: (fn: () => void, ms: number) => () => void;
  }

  const defaultSchedule = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  };

  let { value, onSelect, labelledBy, schedule = defaultSchedule }: Props = $props();

  /** Coarse enough that the whole range is a few keypresses away, fine enough that
   * the step below the default is still audibly different. */
  const STEP = 5;

  /** How long the control waits for the next nudge before writing. Short enough to
   * feel immediate, long enough to swallow a run of keypresses. */
  const COMMIT_MS = 200;

  // The value the reviewer is currently choosing, or undefined when they aren't — in
  // which case the persisted prop is what shows. Holding the override in its own
  // state (rather than mirroring the prop through an $effect) is what keeps the thumb
  // under the reviewer's finger without a resync loop: once the write lands the
  // override clears and the prop, freshly re-read by the shell, takes back over.
  let picking = $state<number | undefined>(undefined);
  const shown = $derived(picking ?? value);

  let cancel: (() => void) | undefined;

  function commit(): void {
    cancel?.();
    cancel = undefined;
    const next = picking;
    if (next === undefined) return;
    // Landing back where it started is not a change — writing it would raise a
    // "Volume updated" toast for a volume that did not move.
    if (next !== value) onSelect(next);
    picking = undefined;
  }

  function change(next: number): void {
    picking = next;
    cancel?.();
    cancel = schedule(commit, COMMIT_MS);
  }

  // Destroying the row — switching settings category, or dismissing the dialog —
  // must not drop a value the reviewer already chose.
  $effect(() => () => commit());
</script>

<div class="volume">
  <Slider
    type="single"
    min={0}
    max={100}
    step={STEP}
    aria-labelledby={labelledBy}
    aria-valuetext={`${shown}%`}
    bind:value={() => shown, change}
  />
  <!-- The level, legible without dragging to find out. Hidden from the reader
       because the thumb's aria-valuetext already announces it; exposing both narrates
       the same number twice. -->
  <span class="readout" aria-hidden="true">{shown}%</span>
</div>

<style>
  .volume {
    display: flex;
    align-items: center;
    gap: 0.625rem;
  }
  /* A fixed track rather than the vendored `w-full`: this sits in the flush-right
     control slot of a settings row, where a full-width slider would push the label
     block off its own line. */
  .volume :global([data-slot="slider"]) {
    width: 9rem;
  }
  /* The track's SIZE is set here, not left to the vendored classes. The registry ships
     `data-horizontal:h-1 data-horizontal:w-full` on the track and `data-horizontal:h-full`
     on the range, which Tailwind compiles to `[data-horizontal]` — but the component
     stamps `data-orientation="horizontal"`, so none of them ever match and the track
     renders 0px tall. It is the same dead-variant shape shadcn-rules.md § The vendored
     `sheet` tree stays records for sheet-content's `data-open:` utilities, and it is
     invisible to the unit and e2e suites because neither computes layout — only looking
     at it catches it. Spelling the geometry here rather than fixing the vendored classes
     keeps it out of reach of a re-sync's wholesale revert, and caret renders no vertical
     slider for the orientation variants to matter to.

     Track and fill are the Switch's two fills, unrolled — --rule-strong for the empty
     part (the Switch's off state) and --accent for the filled part (its on state). The
     Sound pane's two rows then read as one control surface rather than two languages,
     and the fill inherits the app's "amber marks the live value" convention. */
  .volume :global([data-slot="slider-track"]) {
    width: 100%;
    height: 0.25rem;
    background: var(--rule-strong);
  }
  .volume :global([data-slot="slider-range"]) {
    height: 100%;
    background: var(--accent);
  }
  /* The thumb matches the Switch's knob: same 1rem circle, same --paper fill (which
     the vendored `bg-background` bridges to). Its border is retinted off the amber
     --ring to a neutral hairline so the knob stays separable from the amber fill it
     rides — the ring itself is left alone, since that IS the focus indicator. */
  .volume :global([data-slot="slider-thumb"]) {
    width: 1rem;
    height: 1rem;
    border-color: var(--rule-strong);
  }
  /* Tabular figures and a reserved width, so the track does not shift as the number
     goes 5% → 100%. */
  .volume .readout {
    min-width: 2.5rem;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--ink-soft);
  }
</style>
