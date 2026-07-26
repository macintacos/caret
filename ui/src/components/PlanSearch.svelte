<script lang="ts">
  // The vim `/` search HUD (EXC-832): a floating pill in caret's float-chip
  // language, docked (by DiffPlanView) top-right of the plan. A leading `/` glyph,
  // the query input, a tabular current-of-total counter (the one amber moment),
  // prev/next chevrons, and a close ✕. It reads as a HUD, not a modal — the plan
  // stays visible underneath. The pill renders only the surface; DiffPlanView owns
  // the search state, the highlight, and the cursor/commit behaviour, reaching them
  // through these callbacks.
  import { untrack } from "svelte";
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

  // `/` opens the pill ready to type: focus the field once it mounts and select any
  // prefilled query (the remembered last search), so typing replaces it like browser
  // find. select() is a no-op on an empty field (a fresh, never-run search). Skipped when
  // the pill opens committed (an n/N resume), where it returns as a blurred HUD.
  // `committed` is read UNTRACKED so this stays a mount-once effect keyed on `field`.
  let field = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (untrack(() => committed)) return;
    field?.focus();
    field?.select();
  });
</script>

<div class="plan-search" class:closing role="search">
  <div class="search-row">
    <span class="search-slash mono" aria-hidden="true">/</span>
    <Input
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
  </div>
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
     it — a HUD, not a modal — lifted with the shared card shadow and the larger chip
     radius. The controls row sits on top; the
     current-of-total counter sits below it, right-aligned to the pill's edge, so a
     changing total never reflows the row's width. On open it expands from the top-right
     corner — where the "/ to search" chip sat (DiffPlanView's dock) — so `/` reads as
     the chip growing into the field; the global #app reduced-motion guard zeroes it. */
  .plan-search {
    display: inline-flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.3rem 0.4rem;
    background: var(--paper-veil);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    transform-origin: top right;
    animation: search-expand var(--dur-base) var(--ease-out);
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
  /* Closing reverses the expand, but quicker (--dur-fast, vs the open's --dur-base) for a
     snappy dismiss: the pill collapses back toward the top-right chip while DiffPlanView
     keeps it mounted for one --dur-fast, then unmounts it and the chip reappears.
     `forwards` holds the shrunk/faded end frame until that unmount so it can't flash back
     to full size; exit easing (--ease-in) mirrors the enter --ease-out. Higher
     specificity than the base rule, so this animation wins while closing. */
  .plan-search.closing {
    animation: search-collapse var(--dur-fast) var(--ease-in) forwards;
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

  /* The controls row: the leading glyph, the field, then the step / close chips. */
  .search-row {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .search-slash {
    color: var(--ink-faint);
    font-size: var(--text-sm);
    user-select: none;
  }

  /* The shadcn Input given its own recessed field surface, so it reads as distinct
     from the pill — a step off --paper-raised toward --paper-sunk, which recedes in
     both themes (a touch darker on dark paper, a warm grey on light), with a hairline
     rule and the chip radius. Its height/font come from the Input recipe; the
     field-look overrides live here (reached via :global under the scoped root, since
     the class is handed to <Input>). */
  .plan-search :global(.search-input) {
    height: 1.75rem;
    width: 12rem;
    border: 1px solid var(--rule);
    background: var(--paper-sunk);
    box-shadow: none;
    border-radius: var(--radius);
    padding: 0 0.5rem;
    font-size: var(--text-sm);
  }
  /* Dark paper's raised→sunk step is small, so drop the field to the base --paper
     there for a clearer recess; light's --paper-sunk already reads distinct. */
  :global(:root[data-theme="dark"]) .plan-search :global(.search-input) {
    background: var(--paper);
  }
  .plan-search :global(.search-input:focus-visible) {
    outline: none;
    box-shadow: none;
    border-color: var(--rule-strong);
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
