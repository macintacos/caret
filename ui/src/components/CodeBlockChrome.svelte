<script lang="ts">
  // The per-code-block control box: copy (EXC-692) and soft wrap (EXC-1386). One
  // caret-owned box at the block's top-right rather than a control per affordance, so
  // both buttons derive the corner once (positioning and the hover key live in
  // DiffPlanView / lib/diffview/codeChrome.ts). It sits in the .diff-plan light DOM, a
  // sibling of the diff surface, so — unlike the motionless shadow render surface — it
  // may animate; app.css's reduced-motion kill-switch collapses that.
  //
  // Both buttons are always mounted, so the affordances are discoverable without a
  // hover to find them; the box rests dimmed and brightens once the reviewer's pointer
  // reaches the block, which is what keeps it from competing with the code.
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { sound } from "$lib/sound.ts";
  import Icon from "@/components/Icon.svelte";

  interface Props {
    /** The code to copy (fence markers already stripped). */
    text: string;
    /** Top/left of the block's top-right corner, in .diff-plan content coordinates. */
    top: number;
    left: number;
    /** The block overflows its reading width unwrapped, so wrapping it means something.
     * A block that fits gets no wrap button. */
    carded: boolean;
    /** The reviewer has wrapped this block. */
    reflowed: boolean;
    /** The pointer is over this block — what brightens the resting box. */
    hovered: boolean;
    onToggleReflow: () => void;
    /** Clipboard writer; injectable so a test can observe it without a real clipboard. */
    copy?: (text: string) => Promise<void>;
  }

  let {
    text,
    top,
    left,
    carded,
    reflowed,
    hovered,
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

  // Cancel a pending revert if the chrome unmounts (the block left the document).
  $effect(() => () => clearTimeout(timer));
</script>

<!-- The box is the absolutely-positioned element (inline top/left set by DiffPlanView) and
     carries the inset from the corner, so both buttons clear the first line's text. Each
     Button's `{...props}` from its tooltip trigger is spread first so the explicit
     handlers/label below win. The wrap button's name stays put across the toggle —
     aria-pressed is what carries the state. -->
<div class="code-chrome" style="top: {top}px; left: {left}px;" data-lit={hovered ? "" : undefined}>
  {#if carded}
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="outline"
              size="icon"
              type="button"
              class="code-chrome-button code-wrap"
              aria-label="Wrap long lines"
              aria-pressed={reflowed}
              onpointerdown={(event) => event.stopPropagation()}
              onclick={onWrapClick}
            >
              <span class="glyph"><Icon name="text-wrap" size={14} /></span>
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Wrap long lines</Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  {/if}
  <Tooltip.Provider delayDuration={300}>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="outline"
            size="icon"
            type="button"
            class="code-chrome-button code-copy"
            aria-label={copied ? "Copied" : "Copy code"}
            onpointerdown={(event) => event.stopPropagation()}
            onclick={onCopyClick}
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
</div>

<style>
  /* Anchored at the block's top-right corner; the translate insets the whole row just
     inside it, which is what keeps both buttons clear of the first line's text. */
  .code-chrome {
    position: absolute;
    transform: translate(calc(-100% - 0.4rem), 0.4rem);
    display: flex;
    gap: 0.25rem;
    z-index: 4;
    /* The chrome is always mounted, so it rests dimmed and comes up as the reviewer
       reaches the block — discoverable without a hover to find it, quiet while they are
       reading the code. Keyboard focus lights it the same way a pointer does. */
    opacity: 0.4;
    transition: opacity var(--dur-micro) var(--ease-out);
  }

  .code-chrome[data-lit],
  .code-chrome:hover,
  .code-chrome:focus-within {
    opacity: 1;
  }

  /* `.code-chrome-button` is handed to <Button>, so it carries no Svelte scope hash and is
     styled via :global. These unlayered rules beat the Button recipe's layered Tailwind
     utilities, so the resting chip is caret's paper-raised affordance rather than the
     shadcn outline variant. The unlayered box-shadow also suppresses the Button's focus
     ring, so focus is shown by the explicit outline below. */
  :global(.code-chrome-button) {
    display: grid;
    place-items: center;
    width: 1.7rem;
    height: 1.7rem;
    padding: 0;
    color: var(--ink-soft);
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    box-shadow: var(--shadow-chip);
    cursor: pointer;
  }

  :global(.code-chrome-button:hover) {
    color: var(--ink);
    background: var(--paper);
  }

  :global(.code-chrome-button:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }

  /* The wrap toggle stays down while the block is wrapped. Neutral rather than amber:
     amber is the selection and the primary action, and a view option is neither. */
  :global(.code-wrap[aria-pressed="true"]) {
    color: var(--ink);
    background: var(--chip-hover);
  }

  .glyph {
    display: grid;
    place-items: center;
  }

  /* The checkmark pops in on a short scale; the copy glyph returns as a plain swap. */
  .glyph.done {
    color: var(--ok);
    animation: code-copy-pop var(--dur-micro) var(--ease-out);
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
