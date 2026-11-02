<script lang="ts">
  // The outline's peek: a row's section, as the plan's view draws it, standing past the
  // outline's right edge level with the row. When it opens and which row it shows is
  // PlanToc's (outlinePeek.ts); what it shows is a copy of the live view (peekSnippet.ts).
  // It is inert, never taking the pointer, focus or a screen reader's attention: it
  // repeats text the plan already holds, a jump away.
  import { untrack } from "svelte";

  import { type PeekTarget, peekTop, peekWidth } from "$lib/outlinePeek.ts";

  interface Props {
    /** The row to stand beside, or null to hide. */
    target: PeekTarget | null;
    /** The section a heading line opens, copied from the live view; null where the view
     * has not drawn it. A new function whenever what the view draws may have changed,
     * which the open peek copies again from. */
    snippet: (line: number) => HTMLElement | null;
    /** The plan's view, whose floor the peek takes. */
    view: "source" | "preview";
    /** The box the peek stays inside. */
    bounds: HTMLElement | undefined;
  }

  let { target, snippet, view, bounds }: Props = $props();

  // In rem: the gap past the outline and the margin kept inside the bounds, then the least
  // and the most width. The height is the stylesheet's.
  const GAP = 0.5;
  const MARGIN = 0.5;
  const MIN_WIDTH = 18;
  const MAX_WIDTH = 36;
  // How many frames a view that has just flipped gets to draw the section before the open
  // peek gives up on it and closes.
  const DRAW_FRAMES = 3;

  let el = $state<HTMLElement | null>(null);
  let body = $state<HTMLElement | null>(null);
  let open = $state(false);
  let cut = $state(false);
  let copy = $state<HTMLElement | null>(null);
  let placed: PeekTarget | null = null;

  $effect(() => {
    const next = target;
    const copyOf = snippet;
    let frames = 0;
    let raf = 0;
    const attempt = () =>
      untrack(() => {
        const ok = place(next, copyOf);
        if (!ok && next !== null && open && frames++ < DRAW_FRAMES)
          raf = requestAnimationFrame(attempt);
        else open = ok;
      });
    attempt();
    return () => cancelAnimationFrame(raf);
  });

  // Images in the copy load after it opens, and grow it.
  $effect(() => {
    const node = copy;
    if (!open || node === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  });

  // Once it has faded out, the closed peek lets go of its copy, so the page holds the plan
  // once. The copy stays in the host's cache.
  $effect(() => {
    if (open || el === null || copy === null) return;
    let reopened = false;
    void Promise.allSettled(el.getAnimations().map((a) => a.finished)).then(() => {
      if (reopened) return;
      body?.replaceChildren();
      copy = null;
    });
    return () => {
      reopened = true;
    };
  });

  // Stands the peek beside `next` with its section, or reports that it cannot.
  function place(next: PeekTarget | null, copyOf: (line: number) => HTMLElement | null): boolean {
    if (next === null || el === null || body === null || bounds === undefined) return false;
    if (!next.row.isConnected) return false;
    const node = copyOf(next.line);
    if (node === null) return false;
    const rem = remPx();
    const edge = next.outline.getBoundingClientRect().right;
    const size = { gap: GAP * rem, margin: MARGIN * rem, minWidth: MIN_WIDTH * rem, maxWidth: MAX_WIDTH * rem };
    const width = peekWidth(edge, bounds.getBoundingClientRect().right, size);
    if (width === null) return false;
    // Whole pixels, so its one-pixel edge stays one crisp pixel.
    el.style.left = `${Math.round(edge + size.gap)}px`;
    el.style.width = `${Math.floor(width)}px`;
    if (body.firstChild !== node) body.replaceChildren(node);
    copy = node;
    placed = next;
    measure();
    return true;
  }

  // Cuts the copy where it runs past the peek's height, and stands the peek level with its
  // row, inside the bounds.
  function measure(): void {
    if (placed === null || el === null || body === null || bounds === undefined) return;
    cut = body.scrollHeight > body.clientHeight;
    const top = peekTop(
      placed.row.getBoundingClientRect().top,
      el.offsetHeight,
      bounds.getBoundingClientRect(),
      MARGIN * remPx(),
    );
    el.style.top = `${Math.round(top)}px`;
  }

  function remPx(): number {
    return Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  }
</script>

<div
  class="outline-peek"
  bind:this={el}
  data-outline-peek
  data-view={view}
  data-open={open ? "" : undefined}
  data-cut={cut ? "" : undefined}
  inert
>
  <div class="peek-body" bind:this={body}></div>
</div>

<style>
  /* A float over the plan whose face is the view's own floor, so the copy reads as the
     plan it came from. It arrives from the row's side and leaves twice as fast; moving
     between rows it jumps, with no re-entry.

     Its plan text lies over the plan's own, so its edge is the one cue between the two,
     and holds 3:1 against both floors. --ink-faint does in every bundled palette but on
     catppuccin-latte's source floor, so it steps a quarter toward --ink-soft. */
  .outline-peek {
    --peek-floor: var(--paper-sunk);
    --peek-edge: color-mix(in oklab, var(--ink-faint), var(--ink-soft) 25%);
    position: fixed;
    z-index: 30;
    top: 0;
    left: 0;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: var(--peek-floor);
    box-shadow: var(--float-rim), 0 0 0 1px var(--peek-edge), var(--float-mid);
    opacity: 0;
    visibility: hidden;
    translate: -0.375rem 0;
    transition:
      opacity calc(var(--dur-state) / 2) var(--ease-out),
      translate calc(var(--dur-state) / 2) var(--ease-out),
      visibility calc(var(--dur-state) / 2);
  }
  .outline-peek[data-open] {
    opacity: 1;
    visibility: visible;
    translate: none;
    transition:
      opacity var(--dur-state) var(--ease-out),
      translate var(--dur-state) var(--ease-out),
      visibility var(--dur-state);
  }
  .outline-peek[data-view="preview"] {
    --peek-floor: var(--paper);
  }

  /* Cut to a fixed height, fading at the foot where the section runs on. A source line
     runs past the right edge, so the source view's copy fades there too. */
  .peek-body {
    --fade-foot: 0px;
    --fade-end: 0px;
    max-height: 16rem;
    overflow: hidden;
    mask-image:
      linear-gradient(to bottom, #000 calc(100% - var(--fade-foot)), transparent),
      linear-gradient(to right, #000 calc(100% - var(--fade-end)), transparent);
    mask-composite: intersect;
  }
  .outline-peek[data-cut] .peek-body {
    --fade-foot: 3rem;
  }
  .outline-peek[data-view="source"] .peek-body {
    --fade-end: 1.5rem;
  }

  /* The preview's text wraps to the peek, inset evenly: the plan's own column and its
     margin for the comment "+" are wider than the peek. */
  .peek-body :global(.plan-preview) {
    min-width: 0;
    padding-inline: 1.1em;
  }
  /* So a section that fits ends on its text, and only one that runs on fades. */
  .peek-body :global(.plan-preview > :last-child > :last-child) {
    margin-block-end: 0;
  }
</style>
