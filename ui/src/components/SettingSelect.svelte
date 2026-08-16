<script lang="ts">
  // A generic setting dropdown (EXC-843, moved onto the vendored shadcn Select in
  // EXC-1111): a float-chip trigger showing the current option's label, opening a real
  // listbox that commits and closes on pick. Unlike a live-preview picker that applies
  // each value as you arrow through it, this fires onSelect only for the chosen value,
  // then closes — the setting applies immediately on pick. One component renders every
  // `select` control in the registry (theme, diff layout, diff markers).
  //
  // Re-picking the value already selected fires nothing: bits-ui defaults
  // `allowDeselect` to false, so SelectItemState.handleSelect closes without a
  // value-change — a native <select>'s behaviour.
  //
  // Theme preview (EXC-753): when the HIGHLIGHTED option carries a `preview` theme id
  // (only the theme options do), a single abstract ThemePreviewCard floats beside the
  // open panel, tinted by that option BEFORE it is selected — a palette seen on Caret's
  // own chrome. It portals to document.body to escape the panel's overflow, and clamps
  // into the viewport. The card paints that theme onto itself, so highlighting never
  // retints the real app.
  import * as Select from "$lib/components/ui/select/index.js";
  import type { ThemeId } from "$lib/theme.ts";
  import { placeOnNextFrame } from "$lib/themePreviewPlacement.ts";
  import ThemePreviewCard from "@/components/ThemePreviewCard.svelte";

  interface Option {
    value: string;
    label: string;
    /** Optional palette preview — CSS colors shown as dots after the label (theme). */
    swatch?: readonly string[];
    /** Optional theme id — when present, highlighting this option floats a
     * ThemePreviewCard painted in that theme beside the panel (EXC-753). */
    preview?: ThemeId;
  }

  interface Props {
    /** The current value — the selected option and the trigger label. */
    value: string;
    /** The choices, in display order. */
    options: readonly Option[];
    /** Apply the picked value. bits-ui commits and closes the panel on select. */
    onSelect: (value: string) => void;
    /** Accessible name for the trigger (the field's label). */
    ariaLabel: string;
  }
  let { value, options, onSelect, ariaLabel }: Props = $props();

  // The trigger shows the current option's label; fall back to the raw value so an
  // unknown value stays visible rather than blanking.
  const triggerLabel = $derived(options.find((o) => o.value === value)?.label ?? value);

  // --- Theme preview (EXC-753) --------------------------------------------------
  // The open panel and the highlighted option. bits-ui never focuses a row — it drives
  // `aria-activedescendant` — so the highlight is mirrored through Select.Item's own
  // onHighlight / onUnhighlight, which fire for pointer and keyboard movement alike.
  // A listbox always has an active option, so opening already highlights the selected
  // row and its preview appears with the panel.
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

  // Position the card beside the panel, measuring on the NEXT animation frame rather than
  // synchronously. The panel is a bits-ui popover positioned ASYNCHRONOUSLY — Floating UI
  // applies its transform a microtask after mount, so a synchronous measurement taken during
  // a fast reopen can read the panel at the viewport origin and strand the card in the
  // top-left corner. Deferring to a frame lands the measurement after that microtask, so the
  // card anchors to the panel's settled rect (see themePreviewPlacement.ts). Coords stay
  // undefined until the frame; the card's reveal keyframe fades from opacity 0 so the
  // pre-measure frame never shows.
  //
  // Anything that can move the panel re-places the card rather than backing it out.
  // bits-ui keeps the panel glued to the trigger (Floating UI's autoUpdate), so
  // re-measuring is all the card needs. Clearing the highlight instead would strand it:
  // opening the panel scrolls — focusing the trigger reveals it inside the Settings pane,
  // and bits-ui scrolls the highlighted row into view — and `highlightedValue` is only
  // ever written by onHighlight, which does not re-fire for a highlight that never moved,
  // so the preview would stay dead for as long as the panel was open.
  $effect(() => {
    if (!preview || !menuEl || !cardEl) return;
    const menu = menuEl;
    const card = cardEl;
    const place = () =>
      placeOnNextFrame(
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

    let cancel = place();
    // Capture, because a scroll on an ancestor does not bubble.
    const reposition = () => {
      cancel();
      cancel = place();
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      cancel();
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  });

  // Portal the card to document.body so the panel's own overflow (Content is
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

<Select.Root type="single" {value} onValueChange={(v) => onSelect(v)} bind:open={menuOpen}>
  <Select.Trigger class="setting-trigger float-chip" aria-label={ariaLabel}>
    <span class="trigger-label">{triggerLabel}</span>
  </Select.Trigger>

  <Select.Content bind:ref={menuEl} align="end" class="setting-menu">
    {#each options as option (option.value)}
      <!-- No `label` prop: the vendored select-item.svelte destructures it out and never
           forwards it to the primitive, so it would set nothing. bits-ui's typeahead
           matches each row's trimmed textContent anyway (DOMTypeahead), which the
           `.name` span below is — the swatch dots contribute no text. -->
      <Select.Item
        value={option.value}
        data-setting-option={option.value}
        class="setting-item"
        onHighlight={() => (highlightedValue = option.value)}
        onUnhighlight={() => {
          // Guarded: bits-ui fires the arriving row's onHighlight and the leaving
          // row's onUnhighlight in an order this component does not control, so an
          // unguarded clear can null out a highlight that was just set.
          if (highlightedValue === option.value) highlightedValue = null;
        }}
      >
        {#snippet children()}
          <span class="name">{option.label}</span>
          {#if option.swatch}
            <span class="chips" aria-hidden="true">
              {#each option.swatch as color, i (i)}
                <span class="chip-dot" style="background: {color}"></span>
              {/each}
            </span>
          {/if}
        {/snippet}
      </Select.Item>
    {/each}
  </Select.Content>
</Select.Root>

<!-- The single highlight preview (EXC-753): portaled beside the panel, tinted by the
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
    <ThemePreviewCard themeId={preview} label={highlighted?.label ?? ""} />
  </div>
{/if}

<style>
  /* The floating preview anchor (EXC-753): portaled to document.body, so it is styled
     globally. Fixed coords come from the inline styles the positioning effect sets; it
     rides above the select's portal layer (z-50) and is non-interactive — a preview,
     not a target, so it never steals a hover from the panel underneath. */
  :global(.theme-preview-anchor) {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 60;
    pointer-events: none;
  }

  /* Trigger: the vendored Select.Trigger wearing the topbar's floating chip (soft fill,
     no hard border, ink-soft label brightening on hover / while open — the .float-chip
     atom supplies the fill + ink treatment). Global rather than scoped because Svelte
     does not scope-hash a `class` passed to a COMPONENT, which is also why the panel
     rules below are global. The vendored trigger already carries this control's gap,
     radius, padding and text size; the only thing it has that caret's language forbids
     is the outline border (doc/agents/shadcn-rules.md § The caret surface language —
     the chip fill is the affordance). */
  :global(.setting-trigger) {
    border: none;
  }
  :global(.setting-trigger .trigger-label) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Mac disclosure affordance: the vendored chevron points RIGHT while collapsed and
     rotates DOWN when the panel opens (reduced-motion is caught by the global guard in
     app.css). Keyed on the WRAPPER span rather than the glyph: select-trigger.svelte puts
     `text-muted-foreground` there, so colouring the glyph would only re-inherit it, and
     the chevron would stop brightening with the label under .float-chip's hover rule. */
  :global(.setting-trigger span:has(> [data-icon="chevron-down"])) {
    color: inherit;
    opacity: 0.6;
    transform: rotate(-90deg);
    transition: transform var(--dur-micro) var(--ease-out);
  }
  :global(.setting-trigger[aria-expanded="true"] span:has(> [data-icon="chevron-down"])) {
    transform: rotate(0deg);
  }

  /* The panel carries the scope hash into the portal via these classes. Rows lay out as
     [label] [swatch] with the vendored check indicator in the trailing column the item's
     own `pr-8` reserves. Selection wins the fill and the highlight marks the row carrying
     both with a ring; the reasoning for that ordering, which is specific to a Select, is
     in doc/agents/shadcn-rules.md § The caret surface language. */
  :global(.setting-menu [data-select-viewport]) {
    /* The rows' own container: select-content ships no padding, where
       dropdown-menu-content ships p-1. On the content instead of the viewport this would
       also inset the two scroll buttons, which are full-width children of it. */
    padding: 0.25rem;
  }
  :global(.setting-menu .setting-item) {
    color: var(--ink-soft);
  }
  :global(.setting-menu .setting-item[data-highlighted]) {
    background: var(--chip-hover);
    color: var(--ink);
  }
  :global(.setting-menu .setting-item[data-selected]) {
    background: var(--accent-wash);
    color: var(--ink);
  }
  :global(.setting-menu .setting-item[data-selected][data-highlighted]) {
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  /* The vendored indicator inherits the row's ink; amber is what marks a selection
     here, and it is what the version picker's own check wears. */
  :global(.setting-menu [data-icon="check"]) {
    color: var(--accent);
  }
  :global(.setting-menu .name) {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
  }
  /* The palette preview: color dots, right-aligned. A hairline inset ring keeps a dot
     visible when its color is near the panel surface (e.g. a dark palette's own
     surfaces, which the first two dots are). */
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
