<script lang="ts">
  // A generic setting dropdown (EXC-843): a float-chip trigger showing the current
  // option's label, opening a bits-ui DropdownMenu radio list that commits and closes
  // on pick. Unlike a live-preview picker that applies each value as you arrow through
  // it, this fires onSelect only for the chosen value, then closes — the setting
  // applies immediately on pick. One component renders every `select` control in the
  // registry (theme, diff layout, diff markers).
  //
  // Theme preview (EXC-753): when the HIGHLIGHTED option carries `preview` tokens (only
  // the theme options do), a single abstract ThemePreviewCard floats beside the open
  // menu, tinted by that option BEFORE it is selected — a palette seen on Caret's own
  // chrome. It tracks the highlight (pointer or keyboard), portals to document.body to
  // escape the menu's overflow, and clamps into the viewport. The card paints from the
  // option's tokens scoped to itself, so hovering never retints the real app.
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { placeOnNextFrame } from "$lib/themePreviewPlacement.ts";
  import ThemePreviewCard from "@/components/ThemePreviewCard.svelte";

  interface Option {
    value: string;
    label: string;
    /** Optional palette preview — CSS colors shown as dots after the label (theme). */
    swatch?: readonly string[];
    /** Optional full theme token map — when present, highlighting this option floats a
     * ThemePreviewCard tinted by it beside the menu (EXC-753). */
    preview?: Record<string, string>;
  }

  interface Props {
    /** The current value — the selected radio and the trigger label. */
    value: string;
    /** The choices, in display order. */
    options: readonly Option[];
    /** Apply the picked value. bits-ui commits and closes the menu on select. */
    onSelect: (value: string) => void;
    /** Accessible name for the trigger (the field's label). */
    ariaLabel: string;
  }
  let { value, options, onSelect, ariaLabel }: Props = $props();

  // The trigger shows the current option's label; fall back to the raw value so an
  // unknown value stays visible rather than blanking.
  const triggerLabel = $derived(options.find((o) => o.value === value)?.label ?? value);

  // --- Theme preview (EXC-753) --------------------------------------------------
  // The open menu and the highlighted option: `highlightedValue` is set on an item's
  // pointer-enter / focus (covering mouse and keyboard roving) and cleared when the
  // menu closes, so a single preview card can track the highlight.
  let menuOpen = $state(false);
  let highlightedValue = $state<string | null>(null);
  let menuEl = $state<HTMLElement | null>(null);
  let cardEl = $state<HTMLElement | null>(null);
  let posTop = $state<number>();
  let posLeft = $state<number>();

  const highlighted = $derived(options.find((o) => o.value === highlightedValue));
  const preview = $derived(highlighted?.preview);

  $effect(() => {
    if (!menuOpen) highlightedValue = null;
  });

  const CARD_GAP = 10;
  const VIEWPORT_MARGIN = 8;

  // Position the card beside the menu, measuring on the NEXT animation frame rather than
  // synchronously. The menu is a bits-ui popover positioned ASYNCHRONOUSLY — Floating UI
  // applies its transform a microtask after mount, so a synchronous measurement taken during
  // a fast reopen can read the menu at the viewport origin and strand the card in the
  // top-left corner. Deferring to a frame lands the measurement after that microtask, so the
  // card anchors to the menu's settled rect (see themePreviewPlacement.ts). Re-runs when the
  // highlighted option changes, so each move re-measures on its own frame. Coords stay
  // undefined until the frame; the card's reveal keyframe fades from opacity 0 so the
  // pre-measure frame never shows.
  $effect(() => {
    if (!preview || !menuEl || !cardEl) return;
    const menu = menuEl;
    const card = cardEl;
    return placeOnNextFrame(
      {
        menu: () => menu.getBoundingClientRect(),
        card: () => card.getBoundingClientRect(),
        view: () => ({ width: window.innerWidth, height: window.innerHeight }),
        place: ({ top, left }) => {
          posTop = top;
          posLeft = left;
        },
        raf: (cb) => requestAnimationFrame(cb),
        cancel: (handle) => cancelAnimationFrame(handle),
      },
      { gap: CARD_GAP, margin: VIEWPORT_MARGIN },
    );
  });

  // A fixed card can't track a scrolling / resizing anchor, so back the preview out
  // rather than let it drift away from the menu.
  $effect(() => {
    if (!preview) return;
    const drop = () => (highlightedValue = null);
    window.addEventListener("scroll", drop, true);
    window.addEventListener("resize", drop);
    return () => {
      window.removeEventListener("scroll", drop, true);
      window.removeEventListener("resize", drop);
    };
  });

  // Portal the card to document.body so the menu's own overflow (Content is
  // overflow-y-auto) can't clip it. Svelte removes the node on unmount.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

<DropdownMenu.Root bind:open={menuOpen}>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <button {...props} type="button" class="trigger float-chip" aria-label={ariaLabel}>
        <span class="trigger-label">{triggerLabel}</span>
        <!-- Vendored-icon convention (doc/agents/icon-rules.md): inline the Lucide
             chevron-down glyph rather than import @lucide/svelte. -->
        <svg
          class="chevron"
          xmlns="http://www.w3.org/2000/svg"
          width="15"
          height="15"
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
    align="end"
    class="setting-menu"
    style="min-width: var(--bits-dropdown-menu-anchor-width)"
  >
    <DropdownMenuPrimitive.RadioGroup {value} onValueChange={(v) => onSelect(v)}>
      {#each options as option (option.value)}
        <DropdownMenuPrimitive.RadioItem
          value={option.value}
          data-setting-option={option.value}
          class="setting-item"
          onpointerenter={() => (highlightedValue = option.value)}
          onfocus={() => (highlightedValue = option.value)}
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
            <span class="name">{option.label}</span>
            {#if option.swatch}
              <span class="chips" aria-hidden="true">
                {#each option.swatch as color, i (i)}
                  <span class="chip-dot" style="background: {color}"></span>
                {/each}
              </span>
            {/if}
          {/snippet}
        </DropdownMenuPrimitive.RadioItem>
      {/each}
    </DropdownMenuPrimitive.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<!-- The single hover preview (EXC-753): portaled beside the menu, tinted by the
     highlighted theme option. Only theme options carry `preview`, so other selects
     render nothing here. -->
{#if menuOpen && preview}
  <div
    class="theme-preview-anchor"
    bind:this={cardEl}
    use:portal
    style:top={posTop !== undefined ? `${posTop}px` : null}
    style:left={posLeft !== undefined ? `${posLeft}px` : null}
  >
    <ThemePreviewCard tokens={preview} label={highlighted?.label ?? ""} />
  </div>
{/if}

<style>
  /* The floating preview anchor (EXC-753): portaled to document.body, so it is styled
     globally. Fixed coords come from the inline styles the positioning effect sets; it
     rides above the dropdown's portal layer (z-50) and is non-interactive — a preview,
     not a target, so it never steals a hover from the menu underneath. */
  :global(.theme-preview-anchor) {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 60;
    pointer-events: none;
  }

  /* Trigger: a compact select-like control wearing the topbar's floating chip (soft
     fill, no hard border, ink-soft label brightening on hover / while open — the
     .float-chip atom supplies the fill + ink treatment). Sizes to its content and
     sits flush-right in the field row. */
  .trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem;
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
     as [check] [label]; the highlight (hover / keyboard focus) lifts to the topbar's
     --chip-hover so it matches every other neutral control, while the ACTIVE row
     carries an amber wash — the same "amber marks the selection" language the diff
     view and theme picker use. Highlight is declared after so it wins when a row is
     both. */
  :global(.setting-menu .setting-item) {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.55rem;
    border-radius: var(--radius);
    font-size: var(--text-sm);
    color: var(--ink-soft);
    cursor: pointer;
    outline: none;
  }
  :global(.setting-menu .setting-item[aria-checked="true"]) {
    background: var(--accent-wash);
    color: var(--ink);
  }
  :global(.setting-menu .setting-item[data-highlighted]) {
    background: var(--chip-hover);
    color: var(--ink);
  }
  :global(.setting-menu .check) {
    flex: none;
    display: inline-flex;
    width: 0.95rem;
    color: var(--accent);
  }
  :global(.setting-menu .name) {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
  }
  /* The palette preview: color dots, right-aligned. A hairline inset ring keeps a dot
     visible when its color is near the menu surface (e.g. a near-black paper on
     caret-dark). */
  :global(.setting-menu .chips) {
    flex: none;
    display: flex;
    gap: 3px;
    margin-left: auto;
    padding-left: 0.5rem;
  }
  :global(.setting-menu .chip-dot) {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px var(--rule-strong);
  }
</style>
