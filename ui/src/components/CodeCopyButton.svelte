<script lang="ts">
  // The per-code-block copy affordance (EXC-692). A caret-owned button shown at the
  // top-right of the code block the reviewer is hovering (positioning + hover
  // tracking live in DiffPlanView / lib/diffview/codeCopy.ts). Clicking it writes the
  // block's code to the clipboard and briefly swaps the copy glyph for a checkmark as
  // confirmation, then swaps back. It sits in the .diff-plan light DOM (a sibling of
  // the diff surface), so — unlike the motionless shadow render surface — it may
  // animate; the app.css reduced-motion kill-switch collapses it for that preference.
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import Icon from "@/components/Icon.svelte";

  interface Props {
    /** The code to copy (fence markers already stripped). */
    text: string;
    /** Top/left of the block's top-right corner, in .diff-plan content coordinates. */
    top: number;
    left: number;
    /** Clipboard writer; injectable so a test can observe it without a real clipboard. */
    copy?: (text: string) => Promise<void>;
  }

  let { text, top, left, copy = (t) => navigator.clipboard.writeText(t) }: Props = $props();

  // True for a short window after a successful copy — drives the checkmark + label.
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function onClick(event: MouseEvent): Promise<void> {
    // Keep the click off the diff surface beneath (line-click commenting / drag).
    event.stopPropagation();
    try {
      await copy(text);
    } catch {
      return; // clipboard can reject (permissions / unavailable) — leave the copy glyph.
    }
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      copied = false;
    }, 1400);
  }

  // Cancel a pending revert if the button unmounts (the reviewer left the block).
  $effect(() => () => clearTimeout(timer));
</script>

<!-- The affordance is a shadcn Button (icon size) wrapped in a shadcn Tooltip,
     following the TopBar precedent. The button stays the absolutely-positioned
     element (inline top/left set by DiffPlanView), so its `.code-copy` surface is
     molded in place. `{...props}` from the tooltip trigger is spread first so the
     explicit handlers/label below win. -->
<Tooltip.Provider delayDuration={300}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="outline"
          size="icon"
          type="button"
          class="code-copy"
          style="top: {top}px; left: {left}px;"
          aria-label={copied ? "Copied" : "Copy code"}
          onpointerdown={(event) => event.stopPropagation()}
          onclick={onClick}
        >
          {#key copied}
            <span class="glyph" class:done={copied}>
              <Icon name={copied ? "check" : "copy"} size={14} />
            </span>
          {/key}
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{copied ? "Copied" : "Copy code"}</Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>

<style>
  /* `.code-copy` is handed to <Button>, so it carries no Svelte scope hash and is
     styled via :global. These unlayered rules mold the Button's surface in place —
     they beat the Button recipe's layered Tailwind utilities, so the resting chip
     is caret's paper-raised affordance, not the shadcn outline variant. The
     unlayered box-shadow also suppresses the Button's focus ring, so focus is shown
     by the explicit outline below. */
  :global(.code-copy) {
    position: absolute;
    /* Anchored at the block's top-right corner; translate insets it just inside. */
    transform: translate(calc(-100% - 0.4rem), 0.4rem);
    display: grid;
    place-items: center;
    width: 1.7rem;
    height: 1.7rem;
    padding: 0;
    color: var(--ink-soft);
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
    cursor: pointer;
    z-index: 4;
    /* Fades in with the block hover (the button only mounts while hovered). */
    animation: code-copy-in var(--dur-fast) var(--ease-out);
  }

  :global(.code-copy:hover) {
    color: var(--ink);
    background: var(--paper);
  }

  :global(.code-copy:focus-visible) {
    outline: 2px solid var(--accent-bright);
    outline-offset: 2px;
  }

  .glyph {
    display: grid;
    place-items: center;
  }

  /* The checkmark pops in on a short scale; the copy glyph returns as a plain swap. */
  .glyph.done {
    color: var(--ok);
    animation: code-copy-pop var(--dur-fast) var(--ease-out);
  }

  /* Global keyframe: referenced from the :global(.code-copy) rule above, so it
     can't be Svelte-scoped or the name would mismatch and the fade wouldn't play. */
  @keyframes -global-code-copy-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes code-copy-pop {
    from {
      opacity: 0.4;
      transform: scale(0.6);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
