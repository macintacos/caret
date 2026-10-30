<script lang="ts">
  // A code block's copy (EXC-692) and soft-wrap (EXC-1386) caps, in one tray. It carries
  // no placement: the plan pins it over a block's corner (CodeBlockChrome), Settings
  // sits it in the corner of each Advanced block.
  import type { Snippet } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { sound } from "$lib/sound.ts";
  import Icon from "@/components/Icon.svelte";

  interface Props {
    /** What the copy cap writes. */
    text: string;
    /** The copy cap's name reads "Copy {copyName}", then "Copied {copyName}". It tells
     * this block's caps from every other block's in the tab order. */
    copyName: string;
    /** The wrap cap's name reads "Wrap long lines {wrapName}". */
    wrapName: string;
    /** The block overflows unwrapped, so wrapping it means something. A block that fits
     * gets no wrap cap. */
    wrappable: boolean;
    /** The reviewer has wrapped this block. */
    reflowed: boolean;
    onToggleReflow: () => void;
    /** Clipboard writer; injectable so a test can observe it without a real clipboard. */
    copy?: (text: string) => Promise<void>;
  }

  /** One chrome button. */
  interface Control {
    className: string;
    ariaLabel: string;
    tooltip: string;
    /** Omitted on a non-toggle: undefined renders no aria-pressed at all. */
    pressed?: boolean;
    onclick: (event: MouseEvent) => void;
    glyph: Snippet;
  }

  let {
    text,
    copyName,
    wrapName,
    wrappable,
    reflowed,
    onToggleReflow,
    copy = (t) => navigator.clipboard.writeText(t),
  }: Props = $props();

  // True for a short window after a successful copy — drives the checkmark + label.
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function onCopyClick(event: MouseEvent): Promise<void> {
    // Keep the click off the diff surface beneath (line-click commenting / drag).
    event.stopPropagation();
    try {
      await copy(text);
    } catch {
      return; // clipboard can reject (permissions / unavailable) — leave the copy glyph.
    }
    copied = true;
    // Only on the path that actually copied — a rejected write is not a success.
    sound.play("copyCode");
    clearTimeout(timer);
    timer = setTimeout(() => {
      copied = false;
    }, 1400);
  }

  function onWrapClick(event: MouseEvent): void {
    event.stopPropagation();
    onToggleReflow();
  }

  // Cancel a pending revert if the tray unmounts (its block left the document).
  $effect(() => () => clearTimeout(timer));
</script>

{#snippet wrapGlyph()}
  <span class="glyph"><Icon name="text-wrap" size={14} /></span>
{/snippet}

{#snippet copyGlyph()}
  {#key copied}
    <span class="glyph" class:done={copied}>
      <Icon name={copied ? "check" : "copy"} size={14} />
    </span>
  {/key}
{/snippet}

<!-- `{...props}` from the tooltip trigger is spread first so the explicit handlers and
     label below win. The wrap control's name stays put across the toggle — aria-pressed
     is what carries the state. -->
{#snippet control(chromeButton: Control)}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="outline"
          size="icon"
          type="button"
          class="code-chrome-button float-chip {chromeButton.className}"
          aria-label={chromeButton.ariaLabel}
          aria-pressed={chromeButton.pressed}
          onpointerdown={(event) => event.stopPropagation()}
          onclick={chromeButton.onclick}
        >
          {@render chromeButton.glyph()}
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{chromeButton.tooltip}</Tooltip.Content>
  </Tooltip.Root>
{/snippet}

<!-- One Provider over both Roots: the delay is shared, and a plan mounts one tooltip
     context per block rather than two. -->
<div class="code-chrome-tray tray">
  <Tooltip.Provider delayDuration={300}>
    {#if wrappable}
      {@render control({
        className: "code-wrap",
        ariaLabel: `Wrap long lines ${wrapName}`,
        tooltip: "Wrap long lines",
        pressed: reflowed,
        onclick: onWrapClick,
        glyph: wrapGlyph,
      })}
    {/if}
    {@render control({
      className: "code-copy",
      ariaLabel: copied ? `Copied ${copyName}` : `Copy ${copyName}`,
      tooltip: copied ? "Copied" : "Copy code",
      onclick: onCopyClick,
      glyph: copyGlyph,
    })}
  </Tooltip.Provider>
</div>

<style>
  .code-chrome-tray {
    --well-pad: var(--well-pad-tight);
    --tray-gap: var(--well-pad-tight);
    display: flex;
  }

  /* `.code-chrome-button` is handed to <Button>, so it carries no Svelte scope hash and is
     styled via :global; the .float-chip cap supplies its face, press and latch (the wrap
     toggle stays down while the block is wrapped). The cap's box-shadow suppresses the
     Button's focus ring, so focus is shown by the explicit outline below. */
  :global(.code-chrome-button) {
    display: grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    padding: 0;
    border-radius: var(--radius);
  }

  :global(.code-chrome-button:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }

  .glyph {
    display: grid;
    place-items: center;
  }

  /* The checkmark pops in on a short scale; the copy glyph returns as a plain swap. */
  .glyph.done {
    color: var(--ok);
    animation: code-copy-pop var(--dur-state) var(--ease-out);
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
