<script lang="ts">
  // The filename-hover preview (EXC-687): a caret-surface card that shows a
  // syntax-highlighted excerpt of the file a plan references, anchored to the
  // hovered token. Shown only for references the daemon confirmed are real files
  // (DiffPlanView gates it on the resolved set), so it never promises a preview
  // it can't deliver. The excerpt centers on the reference's line when it carries
  // one, else the file's head. Chrome echoes the link tooltip's card language;
  // pointer-events stay on so the reader can move into it to scroll a tall
  // excerpt (DiffPlanView keeps it alive while the pointer is inside).
  import { getFileExcerpt } from "../lib/api.ts";
  import { highlightExcerpt } from "../lib/diffview/highlight.ts";
  import type { FileExcerpt } from "@core/types";

  interface Props {
    reviewId: string;
    /** The referenced path (without any `:line`). */
    path: string;
    /** 1-based line to center the excerpt on, if the reference carried one. */
    line?: number;
    /** Viewport rect of the hovered token, for anchoring. */
    anchor: DOMRect;
    /** Pointer entered the card — keep it open. */
    onKeepAlive: () => void;
    /** Pointer left the card — dismiss it. */
    onDismiss: () => void;
  }
  let { reviewId, path, line, anchor, onKeepAlive, onDismiss }: Props = $props();

  type Preview =
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "ready"; excerpt: FileExcerpt; html: string };
  let preview = $state<Preview>({ kind: "loading" });

  // Current color scheme, honoring caret's manual data-theme override before the
  // system preference. Read per fetch — a transient popover needn't track a
  // theme flip that happens mid-hover.
  function prefersDark(): boolean {
    const attr = document.documentElement.dataset.theme;
    if (attr === "dark") return true;
    if (attr === "light") return false;
    return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  }

  // Fetch the excerpt and highlight it. Re-runs when the target reference changes
  // (DiffPlanView reuses this instance for a newly-hovered reference).
  $effect(() => {
    const id = reviewId;
    const p = path;
    const ln = line;
    let cancelled = false;
    preview = { kind: "loading" };
    void (async () => {
      try {
        const excerpt = await getFileExcerpt(id, p, ln);
        const html = await highlightExcerpt(
          excerpt.lines.join("\n"),
          excerpt.language,
          prefersDark(),
        );
        if (!cancelled) preview = { kind: "ready", excerpt, html };
      } catch {
        if (!cancelled) preview = { kind: "error" };
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const GAP = 8;
  const MARGIN = 8;
  let el = $state<HTMLElement>();
  // Fixed (viewport) placement: prefer above the token, flipping below when the
  // card wouldn't fit. Seeded offscreen so it never flashes at the wrong spot
  // before the effect measures the content height and positions it.
  let placement = $state<{ left: number; top?: number; bottom?: number }>({
    left: -9999,
    top: -9999,
  });
  $effect(() => {
    void preview; // re-measure once the content (and height) settles
    const node = el;
    if (node === undefined) return;
    const rect = node.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - rect.width - MARGIN));
    placement =
      anchor.top > rect.height + GAP
        ? { left, bottom: window.innerHeight - anchor.top + GAP }
        : { left, top: anchor.bottom + GAP };
  });

  const range = $derived.by(() => {
    if (preview.kind !== "ready") return "";
    const { startLine, endLine, totalLines } = preview.excerpt;
    return startLine === endLine
      ? `line ${startLine}`
      : `lines ${startLine}–${endLine} of ${totalLines}`;
  });
</script>

<div
  bind:this={el}
  class="file-preview"
  data-file-preview
  role="tooltip"
  style:left="{placement.left}px"
  style:top={placement.top === undefined ? null : `${placement.top}px`}
  style:bottom={placement.bottom === undefined ? null : `${placement.bottom}px`}
  onmouseenter={onKeepAlive}
  onmouseleave={onDismiss}
>
  <div class="fp-header">
    <span class="fp-path">{preview.kind === "ready" ? preview.excerpt.path : path}</span>
    {#if range}<span class="fp-range">{range}</span>{/if}
  </div>
  {#if preview.kind === "ready"}
    {#if preview.html}
      <div class="fp-code">{@html preview.html}</div>
    {:else}
      <pre class="fp-code fp-plain">{preview.excerpt.lines.join("\n")}</pre>
    {/if}
  {:else if preview.kind === "error"}
    <div class="fp-message">Couldn't load this file.</div>
  {:else}
    <div class="fp-message">Loading…</div>
  {/if}
</div>

<style>
  /* A caret-surface hover card echoing the link tooltip's chrome: paper-raised,
     hairline rule, card shadow. Fixed to the viewport at the hovered token, so it
     escapes the .diff-plan scroll clip; pointer-events stay on so the reader can
     move into it to scroll a tall excerpt. */
  .file-preview {
    position: fixed;
    z-index: 20;
    max-width: min(72ch, 90vw);
    overflow: hidden;
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    animation: fp-in var(--dur-fast) var(--ease-out);
  }
  /* Path on the left, line range pushed to the right — the same reading order as
     a "path:line" reference. */
  .fp-header {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.3rem 0.6rem;
    border-bottom: 1px solid var(--rule);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }
  .fp-path {
    color: var(--ink);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fp-range {
    margin-left: auto;
    color: var(--ink-faint);
    white-space: nowrap;
  }
  .fp-code {
    max-height: 40vh;
    margin: 0;
    padding: 0.4rem 0.6rem;
    overflow: auto;
    font-size: var(--text-2xs);
  }
  /* shiki emits its own <pre class="shiki"> carrying a theme background; strip it
     so the card's paper shows through, and give it caret's mono type. */
  .fp-code :global(pre.shiki) {
    margin: 0;
    background: transparent !important;
    font-family: var(--font-mono);
    line-height: var(--leading-snug);
  }
  .fp-plain {
    color: var(--ink);
    font-family: var(--font-mono);
    line-height: var(--leading-snug);
    white-space: pre;
  }
  .fp-message {
    padding: 0.5rem 0.6rem;
    color: var(--ink-soft);
    font-size: var(--text-2xs);
  }
  @keyframes fp-in {
    from {
      opacity: 0;
      transform: translateY(2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
