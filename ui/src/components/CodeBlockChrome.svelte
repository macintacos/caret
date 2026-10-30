<script lang="ts">
  // A plan code block's copy and wrap tray, pinned over the block's top-right corner
  // (positioning and the hover key live in DiffPlanView / lib/diffview/codeChrome.ts). It
  // sits in the .diff-plan light DOM, a sibling of the source view or the preview, so —
  // unlike the motionless shadow render surface — it may animate; app.css's
  // reduced-motion kill-switch collapses that.
  //
  // The box is mounted for every block rather than only the hovered one, so the controls
  // are discoverable without a hover to find them.
  import CodeChromeTray from "@/components/CodeChromeTray.svelte";

  interface Props {
    /** The code to copy (fence markers already stripped). */
    text: string;
    /** Top/left of the block's top-right corner, in .diff-plan content coordinates. */
    top: number;
    left: number;
    /** The block overflows its reading width unwrapped, so wrapping it means something.
     * A block that fits gets no wrap button. */
    carded: boolean;
    /** The block's 1-based opening line. It names this block's controls, which are
     * otherwise indistinguishable from every other block's in the tab order. */
    start: number;
    /** The reviewer has wrapped this block. */
    reflowed: boolean;
    /** The pointer is over this block — what brightens the resting box. */
    hovered: boolean;
    onToggleReflow: () => void;
    /** Clipboard writer; injectable so a test can observe it without a real clipboard. */
    copy?: (text: string) => Promise<void>;
  }

  let { text, top, left, carded, reflowed, start, hovered, onToggleReflow, copy }: Props =
    $props();
</script>

<div class="code-chrome" style="top: {top}px; left: {left}px;" data-lit={hovered ? "" : undefined}>
  <CodeChromeTray
    {text}
    copyName="code from line {start}"
    wrapName="from line {start}"
    wrappable={carded}
    {reflowed}
    {onToggleReflow}
    {copy}
  />
</div>

<style>
  /* Anchored at the block's top-right corner; the translate insets the whole row just
     inside it, which is what keeps both buttons clear of the first line's text. */
  .code-chrome {
    position: absolute;
    transform: translate(calc(-100% - 0.4rem), 0.4rem);
    z-index: 4;
    /* Rests dimmed so it stays quiet while the code is read, and comes up as the reviewer
       reaches the block. Keyboard focus lights it the same way a pointer does. */
    opacity: 0.4;
    transition: opacity var(--dur-state) var(--ease-out);
  }

  .code-chrome[data-lit],
  .code-chrome:hover,
  .code-chrome:focus-within {
    opacity: 1;
  }
</style>
