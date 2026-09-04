<script lang="ts">
  // The vim `/` search HUD (EXC-832): a floating pill in caret's float-chip
  // language, docked (by DiffPlanView) top-right of the plan. It reads as a HUD, not
  // a modal — the plan stays visible underneath. The pill renders only the surface;
  // DiffPlanView owns the search state, the highlight, and the cursor/commit
  // behaviour, reaching them through these callbacks.
  import { untrack } from "svelte";
  import Icon from "@/components/Icon.svelte";
  import * as InputGroup from "$lib/components/ui/input-group/index.js";

  interface Props {
    /** The live query text, two-way bound so typing drives the parent's incremental
     * match highlighting. */
    query: string;
    /** Total matches for the current query. */
    matchCount: number;
    /** 0-based index of the current (active) match, or -1 when there is none. */
    currentIndex: number;
    /** Whether the search is committed — the pill is a passive HUD, not being edited.
     * Drives two things: the field is read-only (a click can't then desync the counter
     * from a stale index; re-edit is via `/`, which sets this false), and the pill does
     * NOT grab focus on mount — an n/N resume reopens as a blurred HUD so bare n/N keep
     * reaching the global dispatcher, while `/` open/reopen lets the parent focus it. */
    committed?: boolean;
    /** Whether the pill is animating closed — plays the collapse-back-to-the-chip
     * keyframe (the reverse of the open expand). The parent keeps the pill mounted for
     * the animation's duration, then unmounts it (DiffPlanView owns that timer). */
    closing?: boolean;
    /** Commit the search (Enter): the parent moves the line cursor to the nearest
     * match and returns focus to the plan, keeping this pill as a HUD. */
    oncommit: () => void;
    /** Step to the next match (wrapping). */
    onnext: () => void;
    /** Step to the previous match (wrapping). */
    onprev: () => void;
    /** Dismiss the search: clear highlights and return focus to the plan. */
    onclose: () => void;
  }

  let {
    query = $bindable(),
    matchCount,
    currentIndex,
    committed = false,
    closing = false,
    oncommit,
    onnext,
    onprev,
    onclose,
  }: Props = $props();

  const current = $derived(currentIndex >= 0 ? currentIndex + 1 : 0);
  const hasMatches = $derived(matchCount > 0);

  // Field-mode keys: Enter commits, Escape closes. Handled here, not the global
  // dispatcher (which suppresses bare keys while a field is focused), so the pill
  // owns its own field — the same local-handler idiom the breadcrumbs filter uses.
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      oncommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onclose();
    }
  }

  // Focus and select on mount so typing replaces the prefilled last query, like browser
  // find. Skipped when the pill opens committed (an n/N resume), which returns as a
  // blurred HUD. `committed` is read UNTRACKED so this stays a mount-once effect keyed
  // on `field`.
  let field = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (untrack(() => committed)) return;
    field?.focus();
    field?.select();
  });
</script>

<div class="plan-search" class:closing role="search">
  <InputGroup.Root class="search-group">
    <!-- Decorative; the field's aria-label already names the search, so the whole
         addon is hidden rather than just its glyph — an addon is a role="group", and
         one holding nothing announceable is an empty group to a screen reader. -->
    <InputGroup.Addon aria-hidden="true">
      <span class="search-slash mono">/</span>
    </InputGroup.Addon>
    <InputGroup.Input
      bind:ref={field}
      bind:value={query}
      class="search-input"
      type="text"
      placeholder="Search plan…"
      aria-label="Search plan"
      autocomplete="off"
      spellcheck="false"
      readonly={committed}
      onkeydown={onKeydown}
    />
    <!-- The addon ships a click-to-focus handler for the "click the icon, start
         typing" case; a button row wants the opposite. Overriding it with a no-op
         (restProps spreads last, so a caller's handler wins) keeps a click that lands
         in the gaps between the chips from focusing the field — which on a committed
         HUD would silently suppress the bare n / N, since any focused input reads as
         an editing context to the shared dispatcher. -->
    <InputGroup.Addon align="inline-end" class="search-actions" onclick={() => {}}>
      <button
        type="button"
        class="search-step float-chip"
        aria-label="Previous match"
        disabled={!hasMatches}
        onclick={onprev}
      >
        <span class="chev-up"><Icon name="chevron-down" size={14} /></span>
      </button>
      <button
        type="button"
        class="search-step float-chip"
        aria-label="Next match"
        disabled={!hasMatches}
        onclick={onnext}
      >
        <Icon name="chevron-down" size={14} />
      </button>
      <button
        type="button"
        class="search-close float-chip"
        aria-label="Close search"
        onclick={onclose}
      >
        <Icon name="x" size={14} />
      </button>
    </InputGroup.Addon>
  </InputGroup.Root>
  <span
    class="search-count metric"
    class:has-matches={hasMatches}
    aria-live="polite"
    aria-label="{current} of {matchCount} matches"
  >
    {current} / {matchCount}
  </span>
</div>

<style>
  /* The HUD pill: the sheer --paper-veil surface, so the plan reads faintly through
     it — a HUD, not a modal — lifted on the chip-scale --shadow-chip (the same one the
     "/ to search" chip wears, so the two read as one surface growing) and the larger
     chip radius. On open it expands from the top-right corner — where that chip sat
     (DiffPlanView's dock) — so `/` reads as the chip growing into the field; the global
     #app reduced-motion guard zeroes it. */
  .plan-search {
    display: inline-flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.3rem 0.4rem;
    background: var(--paper-veil);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-chip);
    transform-origin: top right;
    animation: search-expand var(--dur-enter) var(--ease-out);
  }
  @keyframes search-expand {
    from {
      opacity: 0;
      transform: scale(0.92);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  /* Closing reverses the expand on the exit arm (--dur-exit) for a snappy dismiss, while
     planKeyboard keeps the pill mounted for that long. `forwards` holds the shrunk/faded
     end frame until the unmount so it can't flash back to full size; higher specificity
     than the base rule, so this animation wins while closing. */
  .plan-search.closing {
    animation: search-collapse var(--dur-exit) var(--ease-in) forwards;
  }
  @keyframes search-collapse {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.92);
    }
  }

  /* The controls row's recessed field surface, so the whole row reads as distinct from
     the pill — a step off --paper-raised toward --paper-sunk, which recedes in both
     themes, with a hairline rule. It hugs its content rather than taking the group's
     stock full width, since the pill is inline and sized by this row. The overrides are
     reached via :global under the scoped root, since the class is handed to
     <InputGroup.Root>. */
  .plan-search :global(.search-group) {
    height: 1.75rem;
    width: auto;
    border: 1px solid var(--rule);
    background: var(--paper-sunk);
  }
  /* Dark paper's raised→sunk step is small, so drop the field to the base --paper
     there for a clearer recess; light's --paper-sunk already reads distinct. */
  :global(:root[data-theme="dark"]) .plan-search :global(.search-group) {
    background: var(--paper);
  }
  /* Focus firms the hairline rather than drawing the group's stock ring: the pill is
     a HUD floating over the plan, and a ring would halo it against the text. Keyed on
     the slot the group's own rule keys on, so it cannot drift from it. */
  .plan-search :global(.search-group:has([data-slot="input-group-control"]:focus-visible)) {
    box-shadow: none;
    border-color: var(--rule-strong);
  }

  /* Fixed width rather than the group's stock flex-1, so the pill keeps one measure
     whatever is typed into it. */
  .plan-search :global(.search-input) {
    height: 100%;
    width: 12rem;
    flex: none;
    font-size: var(--text-sm);
  }

  /* The addons keep their inline padding but drop the block padding, which is sized
     for the stock 2rem group and would push the 1.5rem chips past this row. */
  .plan-search :global([data-slot="input-group-addon"]) {
    padding-block: 0;
    gap: 0.35rem;
  }
  /* A button row, so it drops the addon's text cursor along with the click-to-focus
     the markup already overrides. */
  .plan-search :global(.search-actions) {
    cursor: default;
  }

  .search-slash {
    color: var(--ink-faint);
    font-size: var(--text-sm);
    user-select: none;
  }

  /* The counter sits BELOW the row, right-aligned to the pill's edge, so a changing
     total (or a single↔double-digit count) never reflows the row's width. Tabular
     figures (via .metric) keep the digits from shifting as n/N cycles; the pill's one
     amber moment while there are matches to stand on, a quiet faint tone when none. */
  .search-count {
    text-align: right;
    font-size: var(--text-xs);
    color: var(--ink-faint);
    white-space: nowrap;
    padding: 0 0.2rem;
  }
  .search-count.has-matches {
    color: var(--accent);
  }

  /* The step / close buttons wear the neutral float-chip (fill + ink-soft→ink hover
     from the .float-chip atom); only the square box and disabled state are set here. */
  .search-step,
  .search-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .search-step:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .search-step:focus-visible,
  .search-close:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }
  /* Previous match points up: reuse the single chevron glyph, rotated. */
  .chev-up {
    display: inline-flex;
    transform: rotate(180deg);
  }
</style>
