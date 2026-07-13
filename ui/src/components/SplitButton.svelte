<script lang="ts">
  // A reusable split button (EXC-760): a primary action fused to an options
  // toggle that opens a shadcn DropdownMenu. It reads as ONE control at rest —
  // the two halves share a radius with no divider between them — and splits only
  // on hover, where each half tints just itself. bits-ui owns the menu's
  // open/Escape/outside-click. First used by the TopBar's Approve control; the
  // approve-specific bits (variants, labels) stay with the caller via snippets.
  import type { Snippet } from "svelte";
  import { Button, type ButtonVariant } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import Icon from "./Icon.svelte";

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
    disabled = false,
    variant = "default",
    hoverBg = "var(--accent-bright)",
    menuAlign = "end",
    menuMinWidth = "15rem",
  }: Props = $props();
</script>

<div class="split" style="--split-hover-bg: {hoverBg}">
  <Button {variant} class="split-primary" {onclick} {disabled}>
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
  /* One control at rest, split on hover. The halves abut with a shared radius:
     the inner corners are squared and their inner (transparent) borders removed
     so the two fills touch with no gap and no divider line. Hovering either half
     tints only that half (--split-hover-bg, transitioned by the Button's own
     transition-all), so the seam surfaces as a soft color edge while hovering and
     is invisible otherwise. The :global reaches the composed shadcn Buttons but
     is bounded by `.split`, so nothing leaks. */
  .split {
    display: inline-flex;
  }
  .split :global(.split-primary) {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right-width: 0;
  }
  .split :global(.split-toggle) {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-left-width: 0;
  }
  .split :global(.split-primary:not(:disabled):hover),
  .split :global(.split-toggle:not(:disabled):hover) {
    background: var(--split-hover-bg);
  }

  /* Mac disclosure affordance on the options toggle: the chevron points RIGHT at
     rest and rotates DOWN while the menu is open. Targets the Icon's .icon wrapper
     inside the toggle (Icon has no class prop); reduced-motion is caught by the
     global guard in app.css. */
  .split :global(.split-toggle .icon) {
    transform: rotate(-90deg);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .split :global(.split-toggle[aria-expanded="true"] .icon) {
    transform: rotate(0deg);
  }
</style>
