<script lang="ts">
  // The vim `/` search sheet (EXC-832), hung by SearchDock from the plan pane's top edge.
  // It renders only the surface; DiffPlanView owns the search state, the highlight, and
  // the cursor/commit behaviour, reaching them through these callbacks.
  import Icon from "@/components/Icon.svelte";
  import KbdCap from "@/components/KbdCap.svelte";
  import * as InputGroup from "$lib/components/ui/input-group/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";

  interface Props {
    /** The live query text, two-way bound so typing drives the parent's incremental
     * match highlighting. */
    query: string;
    /** Total matches for the current query. */
    matchCount: number;
    /** 0-based index of the current (active) match, or -1 when there is none. */
    currentIndex: number;
    /** Enter committed the query: it is stamped rather than editable, and the sheet
     * holds no focusable field, so bare n / N keep reaching the global dispatcher.
     * `/` reopens editing by setting this false. */
    committed?: boolean;
    /** Whether the sheet is tucking away; the parent keeps it mounted for the
     * animation's duration (planKeyboard owns that timer). */
    closing?: boolean;
    /** Show the keys that apply now in the lip (the Show Hints setting). */
    hints?: boolean;
    /** Commit the search (Enter): the parent moves the line cursor to the nearest
     * match and returns focus to the plan. */
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
    hints = false,
    oncommit,
    onnext,
    onprev,
    onclose,
  }: Props = $props();

  const current = $derived(currentIndex >= 0 ? currentIndex + 1 : 0);
  const hasMatches = $derived(matchCount > 0);
  const noMatches = $derived(query !== "" && !hasMatches);

  // Field-mode keys: Enter commits, Escape closes. Handled here, not the global
  // dispatcher (which suppresses bare keys while a field is focused), so the sheet
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

  // The field exists only while editing, so whenever it mounts — the first `/` or a
  // reopen over a stamped query — it takes focus with its text selected, and typing
  // replaces the prefilled last query, like browser find.
  let field = $state<HTMLInputElement | null>(null);
  $effect(() => {
    field?.focus();
    field?.select();
  });
</script>

<div class="plan-search" class:closing role="search">
  {#if committed}
    <span class="search-stamp stamp">
      <span class="search-slash mono" aria-hidden="true">/</span>
      <span class="search-stamp-query">{query}</span>
    </span>
  {:else}
    <InputGroup.Root class="search-field field-well">
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
        aria-invalid={noMatches}
        autocomplete="off"
        spellcheck="false"
        onkeydown={onKeydown}
      />
    </InputGroup.Root>
  {/if}
  <span class="search-actions tray">
    <button
      type="button"
      class="search-step float-chip"
      aria-label="Previous match"
      aria-keyshortcuts={ariaKeyshortcutsFor("actions.searchPrev")}
      disabled={!hasMatches}
      onclick={onprev}
    >
      <span class="chev-up"><Icon name="chevron-down" size={14} /></span>
    </button>
    <button
      type="button"
      class="search-step float-chip"
      aria-label="Next match"
      aria-keyshortcuts={ariaKeyshortcutsFor("actions.searchNext")}
      disabled={!hasMatches}
      onclick={onnext}
    >
      <Icon name="chevron-down" size={14} />
    </button>
    <button type="button" class="search-close float-chip" aria-label="Close search" onclick={onclose}>
      <Icon name="x" size={14} />
    </button>
  </span>
  <div class="search-lip">
    {#if hints}
      {#if committed}
        <span class="search-key" aria-hidden="true"><Kbd class="kbd-sm">n</Kbd>next</span>
        <span class="search-key" aria-hidden="true"
          ><Kbd class="kbd-sm"><KbdCap key="shift" size={8} /><KbdCap key="N" /></Kbd
          >previous</span
        >
        <span class="search-key" aria-hidden="true"><Kbd class="kbd-sm">/</Kbd>edit</span>
      {:else}
        {#if hasMatches}
          <span class="search-key" aria-hidden="true"><Kbd class="kbd-sm">↵</Kbd>go to match</span>
        {/if}
        <span class="search-key" aria-hidden="true"><Kbd class="kbd-sm">Esc</Kbd>close</span>
      {/if}
    {/if}
    <span
      class="search-count"
      class:metric={hasMatches}
      aria-live="polite"
      aria-label={hasMatches ? `${current} of ${matchCount} matches` : undefined}
    >
      {#if hasMatches}{current} / {matchCount}{:else if noMatches}No matches{/if}
    </span>
  </div>
</div>

<style>
  /* A sheet hanging from the plan pane's top edge: square where it tucks under the
     edge (the pane's lip paints that edge across it), rounded at its foot. Its radii
     nest: cap, tight bezel, then the sheet's pad. */
  .plan-search {
    --search-cap: 24px;
    --search-pad: 4px;
    --search-row: calc(var(--search-cap) + 2 * var(--well-pad-tight));
    --search-inner-r: calc(var(--radius) + var(--well-pad-tight));
    --search-r: calc(var(--search-inner-r) + var(--search-pad));
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--search-pad);
    width: 21rem;
    max-width: 100%;
    padding: var(--search-pad) var(--search-pad) 0;
    border-radius: 0 0 var(--search-r) var(--search-r);
    background: var(--paper-raised);
    box-shadow:
      0 0 0 1px var(--rule),
      var(--float-mid);
    animation: search-drop var(--dur-state) var(--ease-out);
  }
  /* Closing tucks the sheet back under the edge while planKeyboard keeps it mounted;
     `forwards` holds it there until the unmount. */
  .plan-search.closing {
    animation: search-tuck var(--dur-state) var(--ease-out) forwards;
  }
  @keyframes search-drop {
    from {
      transform: translateY(-100%);
    }
  }
  @keyframes search-tuck {
    to {
      transform: translateY(-100%);
    }
  }

  /* The field and the stamp share one cell and one geometry, so a commit sets the
     query in place rather than moving it. */
  .plan-search :global(.search-field),
  .search-stamp {
    grid-area: 1 / 1;
    min-width: 0;
    height: var(--search-row);
    border-radius: var(--search-inner-r);
  }
  .plan-search :global(.search-field) {
    width: auto;
  }
  .plan-search :global(.search-field [data-slot="input-group-addon"]) {
    padding-block: 0;
  }
  .plan-search :global(.search-input) {
    height: 100%;
    font-size: var(--text-sm);
    caret-color: var(--accent);
  }

  /* The border and gap match the field's (its border is transparent but still there),
     so the slash and the query land on the field's exact pixels. */
  .search-stamp {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid transparent;
    padding-inline: 0.5rem 0.6rem;
    font-size: var(--text-sm);
    color: var(--ink);
    white-space: nowrap;
  }
  .search-stamp-query {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .search-slash {
    color: var(--ink-faint);
    font-size: var(--text-sm);
    user-select: none;
  }

  .search-actions {
    grid-area: 1 / 2;
    --well-pad: var(--well-pad-tight);
    --tray-gap: var(--well-pad-tight);
  }
  .search-step,
  .search-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--search-cap);
    height: var(--search-cap);
    border: none;
    cursor: pointer;
  }
  /* A step with nowhere to go can't be pressed, so it isn't raised: it lies flat in
     its well. */
  .search-step:disabled {
    --cap-face: var(--well-floor);
    background-image: none;
    box-shadow: none;
    color: var(--ink-faint);
    opacity: 0.75;
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

  /* The lip: the keys that apply now, and the counter. The counter sits here, below
     the row, so a changing count never reflows the row. --ink-soft rather than
     --ink-faint, which drops under 4.5:1 on --paper-raised in several bundled
     palettes. */
  .search-lip {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    height: 1.6rem;
    padding-inline: 0.35rem 0.4rem;
    font-size: var(--text-2xs);
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
  }
  .search-key {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .search-count {
    margin-left: auto;
    font-size: var(--text-xs);
  }
</style>
