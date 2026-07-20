<script lang="ts">
  // The vim `/` search HUD (EXC-832): a floating pill in caret's float-chip
  // language, docked (by DiffPlanView) top-right of the plan. A leading `/` glyph,
  // the query input, a tabular current-of-total counter (the one amber moment),
  // prev/next chevrons, and a close ✕. It reads as a HUD, not a modal — the plan
  // stays visible underneath. The pill renders only the surface; DiffPlanView owns
  // the search state, the highlight, and the cursor/commit behaviour, reaching them
  // through these callbacks.
  import Icon from "@/components/Icon.svelte";
  import { Input } from "$lib/components/ui/input/index.js";

  interface Props {
    /** The live query text, two-way bound so typing drives the parent's incremental
     * match highlighting. */
    query: string;
    /** Total matches for the current query. */
    matchCount: number;
    /** 0-based index of the current (active) match, or -1 when there is none. */
    currentIndex: number;
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
    oncommit,
    onnext,
    onprev,
    onclose,
  }: Props = $props();

  // 1-based current for display; 0 when nothing is active.
  const current = $derived(currentIndex >= 0 ? currentIndex + 1 : 0);
  const hasMatches = $derived(matchCount > 0);

  // Field-mode keys: Enter commits, Escape closes. Handled here, not the global
  // dispatcher (which suppresses bare keys while a field is focused), so the pill
  // owns its own field — the same local-handler idiom SourceToc's filter uses.
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      oncommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onclose();
    }
  }

  // `/` opens the pill ready to type: focus the field once it mounts.
  let field = $state<HTMLInputElement | null>(null);
  $effect(() => {
    field?.focus();
  });
</script>

<div class="plan-search" role="search">
  <span class="search-slash mono" aria-hidden="true">/</span>
  <div class="search-field">
    <Input
      bind:ref={field}
      bind:value={query}
      class="search-input"
      type="text"
      placeholder="Search plan…"
      aria-label="Search plan"
      autocomplete="off"
      spellcheck="false"
      onkeydown={onKeydown}
    />
    <span
      class="search-count metric"
      class:has-matches={hasMatches}
      aria-live="polite"
      aria-label="{current} of {matchCount} matches"
    >
      {current} / {matchCount}
    </span>
  </div>
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
  <button type="button" class="search-close float-chip" aria-label="Close search" onclick={onclose}>
    <Icon name="x" size={14} />
  </button>
</div>

<style>
  /* The HUD pill: caret's float-chip surface (paper-raised nudged translucent so
     the plan reads faintly through it — a HUD, not a modal), lifted with the shared
     card shadow and the larger chip radius. Enters with the same quick slide the
     drag-readout uses; the global #app reduced-motion guard zeroes it. */
  .plan-search {
    display: inline-flex;
    align-items: start;
    gap: 0.35rem;
    padding: 0.3rem 0.4rem 0.3rem 0.55rem;
    background: color-mix(in lab, var(--paper-raised), transparent 6%);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    animation: search-in var(--dur-fast) var(--ease-out);
  }
  /* Focus lives on the pill (the field's own border/ring is stripped below), a quiet
     neutral ring — no amber spent on focus; amber is reserved for the counter. */
  .plan-search:focus-within {
    box-shadow:
      var(--shadow-card),
      inset 0 0 0 1px var(--rule-strong);
  }

  .search-slash {
    color: var(--ink-faint);
    font-size: var(--text-sm);
    /* Center the glyph against the input row now the pill top-aligns its items
       (align-items: start) so the counter can hang below the field. */
    line-height: 1.65rem;
    user-select: none;
  }

  /* Input over its counter: a two-row column so the counter can live below the field
     (see .search-count) instead of inline, keeping the pill's width fixed. */
  .search-field {
    display: flex;
    flex-direction: column;
  }

  /* The shadcn Input molded into the chip: transparent, borderless, unshadowed, so
     the pill is the surface. Its border/ring/height/padding come from the Input
     recipe; only the blend-into-the-chip overrides live here (reached via :global
     under the scoped root, since the class is handed to <Input>). */
  .plan-search :global(.search-input) {
    height: 1.65rem;
    width: 12rem;
    border: none;
    background: transparent;
    box-shadow: none;
    border-radius: 0;
    padding: 0 0.15rem;
    font-size: var(--text-sm);
  }
  .plan-search :global(.search-input:focus-visible) {
    border: none;
    outline: none;
    box-shadow: none;
  }

  /* The counter sits BELOW the input, right-aligned under it, so a changing total (or
     a single↔double-digit count) never reflows the pill's width. Tabular figures (via
     .metric) keep the digits from shifting as n/N cycles; the pill's one amber moment
     while there are matches to stand on, a quiet faint tone when there are none. */
  .search-count {
    text-align: right;
    margin-top: 0.1rem;
    font-size: var(--text-xs);
    color: var(--ink-faint);
    white-space: nowrap;
    padding: 0 0.15rem;
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

  @keyframes search-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
