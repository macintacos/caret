<script lang="ts">
  // A reusable split button (EXC-760): a primary action fused to a slim options
  // toggle that opens a shadcn DropdownMenu. It reads as ONE control at rest — the
  // halves share one rim and dome, with no divider — and splits on hover, where each half
  // tints just itself. bits-ui owns the menu's open/Escape/outside-click; the
  // action-specific bits (variants, labels) stay with the caller via snippets.
  import type { Snippet } from "svelte";
  import { Button, type ButtonVariant } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import Icon from "@/components/Icon.svelte";

  interface Props {
    /** Primary (left) content — a label, optionally a leading icon. */
    children: Snippet;
    /** The options menu (right toggle) — DropdownMenu.Item rows. Rendered inside
     * this component's DropdownMenu.Content, so it inherits the menu context. */
    menu: Snippet;
    /** Fires when the primary half is clicked. */
    onclick: () => void;
    /** Accessible name for the options toggle. */
    optionsLabel: string;
    /** aria-keyshortcuts advertised on the primary half (e.g. the Approve key). */
    keyshortcuts?: string;
    disabled?: boolean;
    /** shadcn Button variant worn by both halves. */
    variant?: ButtonVariant;
    /** Background for whichever half is hovered — the split reveal. Defaults to
     * the brighter amber that pairs with the primary `default` variant; pass a
     * token when reusing with another variant. */
    hoverBg?: string;
    menuAlign?: "start" | "end";
    /** Menu min width; shadcn's 8rem default crowds label + description rows. */
    menuMinWidth?: string;
  }
  let {
    children,
    menu,
    onclick,
    optionsLabel,
    keyshortcuts,
    disabled = false,
    variant = "default",
    hoverBg = "var(--accent-bright)",
    menuAlign = "end",
    menuMinWidth = "15rem",
  }: Props = $props();
</script>

<div class="split" style="--split-hover-bg: {hoverBg}">
  <Button {variant} class="split-primary" {onclick} {disabled} aria-keyshortcuts={keyshortcuts}>
    {@render children()}
  </Button>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          {variant}
          size="icon"
          class="split-toggle"
          aria-label={optionsLabel}
          {disabled}
        >
          <Icon name="chevron-down" size={14} />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align={menuAlign} style="min-width: {menuMinWidth}">
      {@render menu()}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>

<style>
  /* One fused control that splits on hover. The inner corners are squared so the two
     faces touch with no gap; hovering either half tints only that half
     (--split-hover-bg, as the cap's hover face), so the seam surfaces as a soft colour
     edge and is invisible otherwise. The :global reaches the composed shadcn Buttons
     but is bounded by `.split`, so nothing leaks. */
  .split {
    position: relative;
    display: inline-flex;
    border-radius: var(--radius);
  }
  /* A rim and dome on each half would draw a divider at the seam, so the halves keep
     only their face and grain at rest, and the wrapper lays one rim and dome over
     both. A press hands the half its own rim back and lifts the shared one. */
  .split::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    box-shadow:
      inset 0 0 0 var(--split-inset, 0px) var(--well-floor),
      inset 0 calc(1px + var(--split-inset, 0px)) 0 var(--split-rim-top, var(--rim-top)),
      inset 0 0 0 calc(1px + var(--split-inset, 0px)) var(--split-rim-side, var(--rim-side)),
      inset 0 4px 5px -3px var(--split-dome-hi, var(--dome-hi)),
      inset 0 -3px 6px 0 var(--split-dome-lo, var(--dome-lo));
    transition: opacity var(--dur-state) var(--ease-out);
  }
  .split:has(> :global(.cap-accent)) {
    --split-inset: var(--tinted-inset);
    --split-rim-top: var(--tinted-rim-top);
    --split-rim-side: var(--tinted-rim-side);
    --split-dome-hi: var(--tinted-dome-hi);
    --split-dome-lo: var(--tinted-dome-lo);
  }
  .split:has(:global(button:not(:disabled):is(:active, [data-key-pressed])))::after {
    opacity: 0;
  }
  .split :global(.split-primary),
  .split :global(.split-toggle) {
    --cap-face-hover: var(--split-hover-bg);
    --cap-inset: 0px;
    --cap-rim-top: transparent;
    --cap-dome-hi: transparent;
    --cap-dome-lo: transparent;
  }
  .split :global(:is(.split-primary, .split-toggle):not(:is(:active, [data-key-pressed]))) {
    --cap-rim-side: transparent;
  }
  .split :global(.split-primary) {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    /* Pull the seam in toward the label so the chevron sits close, not stranded. */
    padding-right: 0.25rem;
  }
  .split :global(.split-toggle) {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    /* Slim the toggle to hug the seam; height stays 2rem from size-8. */
    width: auto;
    padding-left: 0.25rem;
    padding-right: 0.5rem;
  }

  /* Mac disclosure affordance on the options toggle: the chevron points RIGHT at
     rest and rotates DOWN while the menu is open. Targets the Icon's .icon wrapper
     (Icon has no class prop); reduced-motion is caught by the global app.css guard. */
  .split :global(.split-toggle .icon) {
    transform: rotate(-90deg);
    transition: transform var(--dur-state) var(--ease-out);
  }
  .split :global(.split-toggle[aria-expanded="true"] .icon) {
    transform: rotate(0deg);
  }
</style>
