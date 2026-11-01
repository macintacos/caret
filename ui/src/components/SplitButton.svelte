<script lang="ts">
  // A reusable split button (EXC-760): a primary action and a slim options key beside
  // it that opens a shadcn DropdownMenu. They are two keys, each pressed and hovered on
  // its own, rounded tighter where they face each other. bits-ui owns the menu's
  // open/Escape/outside-click; the action-specific bits (variants, labels) stay with the
  // caller via snippets.
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
    menuAlign = "end",
    menuMinWidth = "15rem",
  }: Props = $props();
</script>

<div class="split">
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
  /* Two keys a small gap apart, each squared a little where it faces the other. The
     :global reaches the composed shadcn Buttons but is bounded by `.split`, so nothing
     leaks. */
  .split {
    display: inline-flex;
    gap: 4px;
  }
  .split :global(.split-primary) {
    border-top-right-radius: 4px;
    border-bottom-right-radius: 4px;
    /* Pull the label's end in so the options key sits close, not stranded. */
    padding-right: 0.5rem;
  }
  .split :global(.split-toggle) {
    border-top-left-radius: 4px;
    border-bottom-left-radius: 4px;
    /* Slim the toggle; height stays 2rem from size-8. */
    width: auto;
    padding-inline: 0.375rem;
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
