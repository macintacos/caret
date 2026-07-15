<script lang="ts">
  // The theme dropdown (EXC-761 review round). A live-preview picker: opening it
  // marks the active theme selected, arrow/j/k navigation applies each theme
  // immediately while the menu stays open, and only Enter / outside-click / a second
  // trigger click dismiss it. Built on the same bits-ui DropdownMenu the topbar uses
  // (not a Select) — a Select commits-and-closes on pick, which can't "switch
  // between them live". The trigger wears the topbar's .float-chip so every neutral
  // control reads the same across the app.
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { type Theme, type ThemeId, THEME_IDS, THEMES } from "$lib/theme.ts";
  import { untrack } from "svelte";

  interface Props {
    /** The applied theme — the selected radio and the trigger label. */
    current: ThemeId;
    /** Apply a theme. The host runs the wipe and updates `current`, so a pick
     * retints the whole UI (this dialog included) live. */
    onSelect: (id: ThemeId) => void;
  }
  let { current, onSelect }: Props = $props();

  let open = $state(false);
  const triggerLabel = $derived(THEMES[current]?.label ?? "Select theme");

  // The emblematic swatch: five tokens EVERY palette must supply (the ColorToken
  // union makes them mandatory), so any future theme renders its chips automatically
  // with no per-theme wiring — background, the raised surface, ink, the accent, and
  // the positive hue. The values come from the THEMES registry (the single color
  // source), not literals, so this stays token-driven.
  const SWATCH_TOKENS = ["--paper", "--paper-raised", "--ink", "--accent", "--ok"] as const;
  function swatch(theme: Theme): string[] {
    return SWATCH_TOKENS.map((token) => theme.tokens[token]);
  }

  // Guard the wipe-to-same flash: re-applying the current theme (a click on the
  // active row, or the programmatic focus on open) would still run the 0.45s
  // view-transition for no visual change. `current` is safe to compare against —
  // each key/click is a discrete event, so the prop has flushed between them.
  function apply(id: ThemeId) {
    if (id === current) return;
    onSelect(id);
  }

  let menuEl = $state<HTMLElement | null>(null);
  function focusItem(id: ThemeId) {
    menuEl?.querySelector<HTMLElement>(`[data-theme-id="${id}"]`)?.focus();
  }

  // Navigate + preview in one step. Focusing the target keeps bits-ui's roving
  // highlight in sync via its focusin listener; the `?? current` no-ops if the
  // modulo ever fell out of range (it can't, but the index type is nullable).
  function step(delta: number) {
    const i = THEME_IDS.indexOf(current);
    const next = THEME_IDS[(i + delta + THEME_IDS.length) % THEME_IDS.length] ?? current;
    apply(next);
    focusItem(next);
  }

  // Own the navigation keys in the capture phase so bits-ui's own Arrow/typeahead
  // handling can't double-move focus; j/k mirror the arrows (vim), Enter commits by
  // closing (the theme is already applied live). Escape / outside-click / trigger
  // click are left to bits-ui to dismiss.
  function onKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
      case "j":
        e.preventDefault();
        e.stopPropagation();
        step(1);
        break;
      case "ArrowUp":
      case "k":
        e.preventDefault();
        e.stopPropagation();
        step(-1);
        break;
      case "Enter":
        e.preventDefault();
        open = false;
        break;
    }
  }

  // On open, land focus on the active theme so navigation starts from it (bits-ui
  // would otherwise focus the first item). rAF waits for the portalled content to
  // mount; reading current untracked keeps this firing on open only, not on preview.
  $effect(() => {
    if (open) {
      const active = untrack(() => current);
      requestAnimationFrame(() => focusItem(active));
    }
  });
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <button {...props} type="button" class="trigger float-chip" aria-label="Theme">
        <span class="trigger-label">{triggerLabel}</span>
        <!-- Vendored-icon convention (doc/agents/icon-rules.md): inline the Lucide
             chevron-down glyph rather than import @lucide/svelte. -->
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
    bind:ref={menuEl}
    align="start"
    class="theme-menu"
    style="min-width: var(--bits-dropdown-menu-anchor-width)"
    onkeydowncapture={onKeydown}
  >
    <DropdownMenuPrimitive.RadioGroup value={current} onValueChange={(v) => apply(v as ThemeId)}>
      {#each THEME_IDS as id (id)}
        <DropdownMenuPrimitive.RadioItem
          value={id}
          closeOnSelect={false}
          data-theme-id={id}
          class="theme-item"
        >
          {#snippet children({ checked })}
            <span class="check" aria-hidden="true">
              {#if checked}
                <!-- Inline Lucide check glyph (vendored-icon convention). -->
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              {/if}
            </span>
            <span class="name">{THEMES[id].label}</span>
            <span class="chips" aria-hidden="true">
              {#each swatch(THEMES[id]) as color, i (i)}
                <span class="chip-dot" style="background: {color}"></span>
              {/each}
            </span>
          {/snippet}
        </DropdownMenuPrimitive.RadioItem>
      {/each}
    </DropdownMenuPrimitive.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<style>
  /* Trigger: a full-width select-like control wearing the topbar's floating chip
     (soft fill, no hard border, ink-soft label brightening on hover / while open —
     the .float-chip atom supplies the fill + ink treatment). */
  .trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.7rem;
    border-radius: var(--radius);
    font-size: var(--text-sm);
    text-align: left;
  }
  .trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chevron {
    flex: none;
    opacity: 0.6;
    /* Mac disclosure affordance: the chevron points RIGHT while collapsed and
       rotates DOWN when the menu opens (reduced-motion is caught by the global
       guard in app.css). */
    transform: rotate(-90deg);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .trigger[aria-expanded="true"] .chevron {
    transform: rotate(0deg);
  }

  /* The menu carries the scope hash into the portal via these classes. Rows lay out
     as [check] [label …] [swatch]; the highlight (hover / keyboard focus) lifts to
     the topbar's --chip-hover so it matches every other neutral control, while the
     ACTIVE row carries an amber wash — the same "amber marks the selection" language
     the diff view uses — so the current theme reads distinct from a merely-hovered
     one. Highlight is declared after so it wins when a row is both. */
  :global(.theme-menu .theme-item) {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.55rem;
    border-radius: var(--radius);
    font-size: var(--text-sm);
    color: var(--ink-soft);
    cursor: default;
    outline: none;
  }
  :global(.theme-menu .theme-item[aria-checked="true"]) {
    background: var(--accent-wash);
    color: var(--ink);
  }
  :global(.theme-menu .theme-item[data-highlighted]) {
    background: var(--chip-hover);
    color: var(--ink);
  }
  :global(.theme-menu .check) {
    flex: none;
    display: inline-flex;
    width: 0.95rem;
    color: var(--accent);
  }
  :global(.theme-menu .name) {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
  }
  /* The palette preview: five color chips, right-aligned. A hairline inset ring
     keeps a chip visible when its color is near the menu surface (e.g. a near-black
     paper on caret-dark). */
  :global(.theme-menu .chips) {
    flex: none;
    display: flex;
    gap: 3px;
    margin-left: auto;
    padding-left: 0.5rem;
  }
  :global(.theme-menu .chip-dot) {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px var(--rule-strong);
  }
</style>
