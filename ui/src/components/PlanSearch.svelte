<script lang="ts">
  // The vim `/` search row (EXC-832), slid open over the crumbs in the plan pane's header.
  // It renders only the surface; DiffPlanView owns the search state, the highlight, and
  // the cursor/commit behaviour, reaching them through these callbacks.
  import Icon from "@/components/Icon.svelte";
  import KbdCap from "@/components/KbdCap.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
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
    /** Enter committed the query: it is stamped rather than editable, and the row
     * holds no focusable field, so bare n / N keep reaching the global dispatcher.
     * `/` reopens editing by setting this false. */
    committed?: boolean;
    /** Whether the row is tucking away; the parent keeps it mounted for the
     * animation's duration (planKeyboard owns that timer). */
    closing?: boolean;
    /** Show the keys that apply now after the steps (the Show Hints setting). */
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
  // dispatcher (which suppresses bare keys while a field is focused), so the row
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
  // replaces the prefilled last query, like browser find. Without scrolling: the row
  // opens from past the slot's end, and the plan's body would scroll sideways to it.
  let field = $state<HTMLInputElement | null>(null);
  $effect(() => {
    field?.focus({ preventScroll: true });
    field?.select();
  });
</script>

<!-- The count reads as browser find has it, at the query's end, so a changing count never
     moves the steps. -->
{#snippet counter()}
  <span
    class="search-count"
    class:metric={hasMatches}
    aria-live="polite"
    aria-label={hasMatches ? `${current} of ${matchCount} matches` : undefined}
  >
    {#if hasMatches}{current}<span class="count-gap">{" "}</span>/<span class="count-gap"
        >{" "}</span
      >{matchCount}{:else if noMatches}No matches{/if}
  </span>
{/snippet}

<div class="plan-search" class:closing role="search">
  {#if committed}
    <span class="search-stamp stamp">
      <span class="search-slash mono" aria-hidden="true">/</span>
      <span class="search-stamp-query">{query}</span>
      {@render counter()}
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
      <InputGroup.Addon align="inline-end">{@render counter()}</InputGroup.Addon>
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
  </span>
  {#if hints && (committed || hasMatches)}
    <div class="search-lip">
      {#if committed}
        <span class="search-key" aria-hidden="true"><Kbd class="kbd-sm">n</Kbd>next</span>
        <span class="search-key" aria-hidden="true"
          ><Kbd class="kbd-sm"><KbdCap key="shift" /><KbdCap key="N" /></Kbd
          >previous</span
        >
        <span class="search-key" aria-hidden="true"><Kbd class="kbd-sm">/</Kbd>edit</span>
      {:else}
        <span class="search-key" aria-hidden="true"><Kbd class="kbd-sm">↵</Kbd>go to match</span>
      {/if}
    </div>
  {/if}
  <span class="search-close-tray tray header-tray">
    <Button
      variant="secondary"
      size="sm"
      class="search-close float-chip"
      aria-label="Close search"
      aria-keyshortcuts="Escape"
      onclick={onclose}
    >
      <Icon name="x" size={14} />
      <span class="close-word">Close</span>
      {#if hints}
        <Kbd class="kbd-sm" aria-hidden="true">esc</Kbd>
      {/if}
    </Button>
  </span>
</div>

<style>
  /* A row laid over the header's crumb slot (DiffPlanView), on the header bed's floor.
     The slot clips it at its end, where the Search entry sits, so it slides open out of
     the entry and tucks back into it. It paints the bed's floor clear of the bed's top
     shade and lower wall, so the crumbs and the entry it tucks away over stay covered. */
  .plan-search {
    --query-floor: 3rem;
    --search-cap: 24px;
    --search-row: calc(var(--search-cap) + var(--well-top) + var(--well-foot));
    --search-inner-r: calc(var(--key-radius) + var(--well-pad));
    container-type: inline-size;
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    background: linear-gradient(var(--header-bed-floor), var(--header-bed-floor)) center /
      100% calc(100% - 2 * var(--well-pad) - 0.75rem) no-repeat;
    animation: search-open var(--dur-pane) var(--ease-out);
  }
  /* Closing tucks the row back into the entry while planKeyboard keeps it mounted;
     `forwards` holds it there until the unmount. */
  .plan-search.closing {
    animation: search-tuck var(--dur-state) var(--ease-out) forwards;
  }
  @keyframes search-open {
    from {
      transform: translateX(100%);
    }
  }
  @keyframes search-tuck {
    to {
      transform: translateX(100%);
    }
  }

  /* The field and the stamp share one geometry, so a commit sets the query in place
     rather than moving it. The field gives up width first, to about 8rem; then the hints
     go (.search-lip) and Close keeps only its ×, and the field gives up the rest, down to
     five characters of query (--query-floor). The steps keep theirs, so Close always
     fits. */
  .plan-search :global(.search-field),
  .search-stamp {
    flex: 0 1 25rem;
    min-width: min-content;
    height: var(--search-row);
    border-radius: var(--search-inner-r);
  }
  .plan-search :global(.search-field [data-slot="input-group-addon"]) {
    padding-block: 0;
  }
  /* A set width rather than the input's 100%, so the field's min-content holds the query's
     floor past the input's 6px side padding. */
  .plan-search :global(.search-input) {
    flex: 1 0 auto;
    width: calc(var(--query-floor) + 0.75rem);
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
    flex: 1 0 auto;
    width: var(--query-floor);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .search-slash {
    color: var(--ink-faint);
    font-size: var(--text-sm);
    user-select: none;
  }

  /* --ink-soft rather than --ink-faint, which drops under 4.5:1 on the plan's floor in
     several bundled palettes. */
  .search-count {
    flex: none;
    margin-left: auto;
    padding-right: 0.55rem;
    font-size: var(--text-xs);
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .search-stamp .search-count {
    padding-right: 0;
  }

  .search-actions {
    flex: none;
    --tray-gap: 4px;
  }
  .search-step {
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
  /* Previous match points up: reuse the single chevron glyph, rotated. */
  .chev-up {
    display: inline-flex;
    transform: rotate(180deg);
  }

  /* The way out, a key of the header's own at the slot's end, where the Search entry
     stood. */
  .search-close-tray {
    flex: none;
    margin-left: auto;
  }

  /* The keys that apply now, as text after the steps. */
  .search-lip {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding-inline: 0.15rem 0;
    font-size: var(--text-2xs);
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .search-key {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  /* The room an 8rem field, the steps, the stamp's lip, its longest, and Close with its
     word and cap take together. Below it Close is an × of the steps' size. */
  @container (width < 30.4rem) {
    .search-lip,
    .close-word,
    .search-close-tray :global(.kbd-sm) {
      display: none;
    }
    .search-close-tray :global(.search-close) {
      width: var(--search-cap);
      height: var(--search-cap);
      padding: 0;
    }
  }
  /* Past the query's floor, what reads least goes first: the slash, then the count's
     spaces and its end padding. Each threshold is the row at its floor with that part still
     in, beside its longest count, "No matches". */
  @container (width < 16.6rem) {
    .plan-search :global(.search-field [data-align="inline-start"]),
    .search-stamp .search-slash {
      display: none;
    }
    .search-stamp {
      padding-inline-start: 0.375rem;
    }
  }
  @container (width < 15.65rem) {
    .count-gap {
      display: none;
    }
    .search-count {
      padding-right: 0;
    }
  }
</style>
