<script lang="ts">
  // The filename-hover preview (EXC-687): a caret-surface card that shows a
  // syntax-highlighted excerpt of the file a plan references, anchored to the
  // hovered token. Shown only for references the daemon confirmed are real files
  // (DiffPlanView gates it on the resolved set), so it never promises a preview
  // it can't deliver. The excerpt centers on the reference's line when it carries
  // one, else the file's head. Chrome echoes the link tooltip's card language;
  // pointer-events stay on so the reader can move onto the card (to scroll a long
  // line) — DiffPlanView's hover-intent tracker reads this card's rect and keeps
  // the preview alive while the pointer is on it or heading toward it (EXC-799).
  import { getFileExcerpt } from "../lib/api.ts";
  import { highlightExcerpt } from "../lib/diffview/highlight.ts";
  import type { FileExcerpt } from "@core/lib/types";

  interface Props {
    reviewId: string;
    /** The referenced path (without any `:line`). */
    path: string;
    /** 1-based line to center the excerpt on, if the reference carried one. */
    line?: number;
    /** Viewport rect of the hovered token, for anchoring. */
    anchor: DOMRect;
  }
  let { reviewId, path, line, anchor }: Props = $props();

  // One rendered source line: its real file line number, plus either the
  // highlighted token HTML (shiki) or the raw text (plain fallback).
  interface Row {
    num: number;
    html?: string;
    text?: string;
  }
  type Preview =
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "ready"; excerpt: FileExcerpt; rows: Row[] };
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

  // Split shiki's `<pre><code>` blob into one HTML string per line (the inner
  // token spans of each `.line`), so each source line can render in its own
  // numbered row. Returns null when there's nothing to split (highlight failed),
  // so the caller falls back to plain text.
  function splitHighlightedLines(html: string): string[] | null {
    if (html === "") return null;
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const lines = tpl.content.querySelectorAll(".line");
    return lines.length > 0 ? [...lines].map((el) => el.innerHTML) : null;
  }

  // Pair each excerpt line with its real file line number. Line numbers always
  // come from the excerpt (authoritative); the highlighted HTML is used only when
  // it splits into exactly one span per line, so a numbering drift can never
  // mislabel a line.
  function buildRows(excerpt: FileExcerpt, html: string): Row[] {
    const highlighted = splitHighlightedLines(html);
    const useHtml = highlighted !== null && highlighted.length === excerpt.lines.length;
    return excerpt.lines.map((text, i) => ({
      num: excerpt.startLine + i,
      html: useHtml ? highlighted[i] : undefined,
      text: useHtml ? undefined : text,
    }));
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
        if (!cancelled) preview = { kind: "ready", excerpt, rows: buildRows(excerpt, html) };
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
  // Gates the fade-in: the card stays hidden (offscreen, opacity 0) until its
  // FINAL content is measured and placed, then reveals once. Without this the card
  // was measured at its tiny "Loading…" height, placed, then leapt to full height —
  // a visible expansion on first hover. Positioning only ever happens for the
  // settled (ready/error) card, never the loading one.
  let shown = $state(false);
  $effect(() => {
    // Only position (and reveal) the settled card, never the loading one, so the
    // first hover appears once at its final size instead of expanding from the tiny
    // loading height. This early return also holds the last position across a
    // ref→ref switch, so the card never jumps (its body may briefly show "Loading…").
    if (preview.kind === "loading") return;
    const node = el;
    if (node === undefined) return;
    const rect = node.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - rect.width - MARGIN));
    placement =
      anchor.top > rect.height + GAP
        ? { left, bottom: window.innerHeight - anchor.top + GAP }
        : { left, top: anchor.bottom + GAP };
    shown = true;
  });

  const lineWord = (n: number) => (n === 1 ? "line" : "lines");

  // Framing for the excerpt: how much file sits above/below the window (so the
  // boundary strips can say so), the header label, and the digit width the
  // line-number gutter needs. A window covering the whole file reads as the full
  // file, not a slice.
  const meta = $derived.by(() => {
    if (preview.kind !== "ready") return undefined;
    const { startLine, endLine, totalLines } = preview.excerpt;
    const above = startLine - 1;
    const below = totalLines - endLine;
    const whole = above === 0 && below === 0;
    const label = whole
      ? `${totalLines} ${lineWord(totalLines)}`
      : `lines ${startLine}–${endLine} of ${totalLines}`;
    return { above, below, label, gutter: `${String(endLine).length}ch` };
  });
</script>

<div
  bind:this={el}
  class="file-preview"
  class:fp-shown={shown}
  data-file-preview
  role="tooltip"
  style:left="{placement.left}px"
  style:top={placement.top === undefined ? null : `${placement.top}px`}
  style:bottom={placement.bottom === undefined ? null : `${placement.bottom}px`}
>
  <div class="fp-header">
    <span class="fp-badge">Preview</span>
    <span class="fp-path">{preview.kind === "ready" ? preview.excerpt.path : path}</span>
    {#if meta}<span class="fp-range">{meta.label}</span>{/if}
  </div>
  {#if preview.kind === "ready" && meta}
    {#if meta.above > 0}
      <div class="fp-edge fp-edge-top">↑ {meta.above} {lineWord(meta.above)} above</div>
    {/if}
    <div class="fp-code" style:--fp-gutter={meta.gutter}>
      {#each preview.rows as row (row.num)}
        <div class="fp-row" class:fp-target={row.num === line}>
          <span class="fp-lnum">{row.num}</span
          >{#if row.html !== undefined}<code class="fp-lcode">{@html row.html}</code
            >{:else}<code class="fp-lcode">{row.text}</code>{/if}
        </div>
      {/each}
    </div>
    {#if meta.below > 0}
      <div class="fp-edge fp-edge-bottom">↓ {meta.below} {lineWord(meta.below)} below</div>
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
     move onto it (to scroll a long line) without it dismissing. */
  .file-preview {
    position: fixed;
    /* Above the top bar (z 30), the review switcher and badges (z 40), so an
       active preview is never occluded by the chrome; below modal dialogs (z 100),
       which supersede a hover entirely. */
    z-index: 60;
    max-width: min(72ch, 90vw);
    overflow: hidden;
    /* The card paints on the shadcn popover surface (bridged: --popover =
       --paper-raised, --border = --rule), so this hover card reads as one family
       with the app's other floating panels (menus, dropdowns). The panel radius
       (--radius-lg, 10px) and card shadow are already the kit's; only the border
       softens from --rule-strong to the popover hairline. */
    background: var(--popover);
    color: var(--popover-foreground);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    /* Hidden until measured + placed at final size (see the `shown` gate). Revealed
       once with a single fade-in, so the card never appears at its loading size and
       then jumps to full height on first hover. */
    opacity: 0;
  }
  .file-preview.fp-shown {
    opacity: 1;
    animation: fp-in var(--dur-fast) var(--ease-out);
  }
  /* Path on the left, line range pushed to the right — the same reading order as
     a "path:line" reference. */
  .fp-header {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    padding: 0.3rem 0.6rem;
    border-bottom: 1px solid var(--rule);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }
  /* The explicit "Preview" label — a filled chip so the card is unmistakably a
     snippet, not the file itself. Neutral ink fill (amber stays brand-reserved);
     high-contrast against the card in both schemes. */
  .fp-badge {
    flex: 0 0 auto;
    align-self: center;
    padding: 0.05rem 0.4rem;
    border-radius: var(--radius);
    background: var(--ink-soft);
    color: var(--popover);
    font-weight: 700;
    font-size: var(--text-2xs);
    letter-spacing: 0.09em;
    text-transform: uppercase;
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
  /* The muted boundary strips: a recessed (paper-sunk) band above and/or below
     the window saying how much file it omits, so the excerpt never reads as the
     whole file starting or ending here. Shown only on the side that has more. */
  .fp-edge {
    padding: 0.25rem 0.6rem;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    text-align: center;
    color: var(--ink-soft);
    background: var(--paper-sunk);
    user-select: none;
  }
  .fp-edge-top {
    border-bottom: 1px solid var(--rule);
  }
  .fp-edge-bottom {
    border-top: 1px solid var(--rule);
  }
  /* The excerpt: one flex row per source line — a sticky line-number gutter that
     stays put as long lines scroll horizontally, plus the line's highlighted
     code. Long lines scroll horizontally; there is deliberately NO vertical
     scroll — the backend caps the window to a snippet that fits, so the card can
     never be paged like the whole file. The code reads at the plan source view's
     own grid — the same font stack, --text-base size, --leading-normal rhythm,
     and tabular figures the .diffview bridge sets (app.css) — so an excerpt looks
     like a window onto the plan, not a smaller sibling. The header and boundary
     strips stay at the --text-2xs label size. */
  .fp-code {
    padding: 0.4rem 0;
    overflow-x: auto;
    overflow-y: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    line-height: var(--leading-normal);
    font-feature-settings: "tnum";
    color: var(--ink);
  }
  .fp-row {
    display: flex;
  }
  /* The referenced line — washed so the reader's eye lands on it. Uses caret's
     content-mark amber (--mark, the same attention wash source annotations use)
     with a metadata-accent line number, NOT the brand-solid accent fill. Only a
     reference that carried a :line has a target row; head previews mark nothing. */
  .fp-target {
    background: var(--mark);
  }
  .fp-target .fp-lnum {
    color: var(--accent);
    font-weight: 700;
  }
  .fp-lnum {
    position: sticky;
    left: 0;
    z-index: 1;
    flex: 0 0 auto;
    /* content-box so the digit column is exactly `--fp-gutter` wide and the
       padding + border sit outside it — a real gutter, clearly parted from code. */
    box-sizing: content-box;
    width: var(--fp-gutter, 2ch);
    padding: 0 0.7rem;
    text-align: right;
    color: var(--ink-faint);
    background: var(--popover);
    border-right: 1px solid var(--rule);
    user-select: none;
    white-space: pre;
  }
  .fp-lcode {
    /* Set the font stack directly on the <code>, not just on .fp-code: the UA
       stylesheet's own `code { font-family: monospace }` overrides an inherited
       family, so without this rule the excerpt lines render in the browser's
       default monospace while the rest of the card is Berkeley Mono — two fonts
       in one card. This pins them to the plan view's stack. */
    font-family: var(--font-mono);
    padding: 0 0.8rem;
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
