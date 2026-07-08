<script lang="ts">
  // The per-code-block copy affordance (EXC-692). A caret-owned button shown at the
  // top-right of the code block the reviewer is hovering (positioning + hover
  // tracking live in DiffPlanView / lib/diffview/codeCopy.ts). Clicking it writes the
  // block's code to the clipboard and briefly swaps the copy glyph for a checkmark as
  // confirmation, then swaps back. It sits in the .diff-plan light DOM (a sibling of
  // the diff surface), so — unlike the motionless shadow render surface — it may
  // animate; the app.css reduced-motion kill-switch collapses it for that preference.
  import Icon from "./Icon.svelte";

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

<button
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
</button>

<style>
  .code-copy {
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

  .code-copy:hover {
    color: var(--ink);
    background: var(--paper);
  }

  .code-copy:focus-visible {
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

  @keyframes code-copy-in {
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
