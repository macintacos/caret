<script lang="ts">
  // The filename preview (EXC-687, click-opened since EXC-840): a caret-surface
  // card that shows a syntax-highlighted excerpt of the file a plan references,
  // anchored to the clicked token. Shown only for references the daemon confirmed are real files
  // (DiffPlanView gates it on the resolved set), so it never promises a preview
  // it can't deliver. The excerpt centers on the reference's line when it carries
  // one, else the file's head, and the boundary strips widen that window toward
  // the file's ends on click until the whole file is reachable without leaving
  // the review. Chrome echoes the link tooltip's card language, and the header
  // carries an "esc to close" hint — the preview is a click-opened popover that
  // stays put until dismissed (Escape, or a click outside it; DiffPlanView owns
  // that). pointer-events stay on so the reader can move onto the card to scroll
  // it or select text in it without dismissing it.
  import { tick, untrack } from "svelte";

  import { appearance } from "@/state/appearance.svelte.ts";
  import { getFileExcerpt, HttpError } from "$lib/api.ts";
  import { highlightExcerpt } from "$lib/diffview/highlight.ts";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import type { FileExcerpt } from "@core/lib/types";

  interface Props {
    reviewId: string;
    /** The referenced path (without any `:line`). */
    path: string;
    /** 1-based line to center the excerpt on, if the reference carried one. */
    line?: number;
    /** Viewport rect of the clicked token, for anchoring. */
    anchor: DOMRect;
    /** Whether the shortcut-hint affordances are shown (EXC-826); gates the
     * header's "esc to close" chip. Defaults to shown; Escape still closes the
     * preview regardless. */
    showShortcutHints?: boolean;
  }
  let { reviewId, path, line, anchor, showShortcutHints = true }: Props = $props();

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
    | { kind: "too-large" }
    | { kind: "ready"; excerpt: FileExcerpt; rows: Row[] };
  // Raw, not deep-proxied: `preview` is only ever replaced wholesale, and its
  // `rows` array is one object per source line — unbounded once the reader
  // expands toward a large file's ends. Proxying every row would buy reactivity
  // nothing here and cost a signal per row read.
  let preview = $state.raw<Preview>({ kind: "loading" });

  /** Lines one strip click adds to that side of the window. */
  const EXPAND_STEP = 50;

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

  // Fetch one window and pair it with its highlighted rows. The live theme is
  // resolved per fetch — a transient popover needn't track a theme switch that
  // happens while it is open, so the read is untracked rather than a dependency
  // that would re-fetch the excerpt on every switch.
  async function load(
    id: string,
    p: string,
    ln: number | undefined,
    range?: { start: number; end: number },
  ): Promise<Extract<Preview, { kind: "ready" }>> {
    // An explicit range wins over `line` server-side, so don't send both — one
    // window per request, with no precedence for a future edit to invert.
    const excerpt = await getFileExcerpt(id, p, range === undefined ? ln : undefined, range);
    const html = await highlightExcerpt(
      excerpt.lines.join("\n"),
      excerpt.language,
      untrack(() => appearance.themeId),
    );
    return { kind: "ready", excerpt, rows: buildRows(excerpt, html) };
  }

  // Fetch the opening window. Re-runs when the target reference changes
  // (DiffPlanView reuses this instance for a newly-clicked reference), and
  // deliberately depends on nothing else — expansion is a handler, not an
  // effect, so a widened window never re-enters here.
  $effect(() => {
    const id = reviewId;
    const p = path;
    const ln = line;
    let cancelled = false;
    preview = { kind: "loading" };
    centred = false;
    void (async () => {
      try {
        const ready = await load(id, p, ln);
        if (!cancelled) preview = ready;
      } catch (err) {
        if (cancelled) return;
        // A file past the daemon's preview ceiling is its own state: the reader
        // is told why there's nothing to show, not that the load broke.
        preview =
          err instanceof HttpError && err.status === 413 ? { kind: "too-large" } : { kind: "error" };
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  // Reactive so the strips can show they are busy: a click that lands while a
  // widened window is in flight is dropped, and the wait grows with the window.
  let expanding = $state(false);
  // Widen the window one step toward `direction` and refetch it whole. Refetching
  // rather than splicing in a delta chunk is what keeps the colouring right:
  // shiki needs the full window to close multi-line constructs (a block comment,
  // a template literal) that begin outside a fragment. The current rows stay on
  // screen while the wider window loads, so the card never blanks.
  // ponytail: both costs here scale with the file — re-highlighting redoes the
  // whole widened window each step, and a fixed EXPAND_STEP means a 20k-line file
  // is hundreds of clicks from end to end. Chunked or virtualized rendering, and
  // a step that tracks the visible row count, are the upgrade paths if either bites.
  async function expand(direction: "up" | "down"): Promise<void> {
    if (preview.kind !== "ready" || expanding) return;
    const { startLine, endLine } = preview.excerpt;
    const range =
      direction === "up"
        ? { start: Math.max(1, startLine - EXPAND_STEP), end: endLine }
        : { start: startLine, end: endLine + EXPAND_STEP };
    const id = reviewId;
    const p = path;
    const ln = line;
    const region = codeEl;
    const before =
      region === undefined ? null : { top: region.scrollTop, height: region.scrollHeight };
    expanding = true;
    try {
      const ready = await load(id, p, ln, range);
      // The parent reuses one instance across references; drop a window whose
      // reference moved on while it was in flight.
      if (id !== reviewId || p !== path || ln !== line) return;
      preview = ready;
      if (direction === "up" && region !== undefined && before !== null) {
        await tick();
        // Every revealed line sits above what the reader was looking at, so
        // adding the growth back to the offset holds their place exactly. The
        // browser clamps the result when the card grew instead of the region.
        region.scrollTop = before.top + (region.scrollHeight - before.height);
      }
    } catch {
      // Keep the current window on screen; the strip stays clickable.
    } finally {
      expanding = false;
    }
  }

  let codeEl = $state<HTMLElement>();
  let centred = false;
  // Bring the cited line into view on first open. The opening window is taller
  // than the code region, so the marked row would otherwise sit below the fold.
  // scrollTop directly rather than scrollIntoView, which would also scroll the
  // plan view behind the card.
  $effect(() => {
    if (preview.kind !== "ready" || centred || line === undefined) return;
    // Wait for the placement pass to put its cap on the card. Until it does the
    // card is bounded only by the `100vh` fallback, and a row centred against
    // that taller region drops below the fold the moment the cap shrinks it.
    if (placement.maxHeight === undefined) return;
    const region = codeEl;
    if (region === undefined) return;
    centred = true;
    // A reference citing a line past EOF gets a window clamped to the last line,
    // so no row is marked and there is nothing to centre — stop looking.
    const row = region.querySelector<HTMLElement>(".fp-target");
    if (row === null) return;
    region.scrollTop +=
      row.getBoundingClientRect().top -
      region.getBoundingClientRect().top -
      (region.clientHeight - row.offsetHeight) / 2;
  });

  const GAP = 8;
  const MARGIN = 8;
  let el = $state<HTMLElement>();
  // Fixed (viewport) placement: prefer above the token, flipping below when the
  // card wouldn't fit. Seeded offscreen so it never flashes at the wrong spot
  // before the effect measures the content height and positions it.
  let placement = $state<{
    left: number;
    top?: number;
    bottom?: number;
    // Whether the card landed above the token (else below) and where the token sits
    // across the card — together they origin the pop-in at the filename.
    above: boolean;
    originX: number;
    // How tall the card may grow on the side it landed on, so an expanded window
    // stops at the viewport edge and scrolls internally from there. Undefined
    // until first placed — the card is then bounded only by the `100vh` fallback,
    // rather than collapsed by a seeded cap that would make the first
    // measurement meaningless.
    maxHeight?: number;
  }>({
    left: -9999,
    top: -9999,
    above: false,
    originX: 0,
  });
  // Gates the fade-in: the card stays hidden (offscreen, opacity 0) until its
  // FINAL content is measured and placed, then reveals once. Without this the card
  // was measured at its tiny "Loading…" height, placed, then leapt to full height —
  // a visible expansion on first open. Positioning only ever happens for the
  // settled (ready/error) card, never the loading one.
  let shown = $state(false);
  $effect(() => {
    // Only position (and reveal) the settled card, never the loading one, so the
    // first open appears once at its final size instead of expanding from the tiny
    // loading height. This early return also holds the last position across a
    // ref→ref switch, so the card never jumps (its body may briefly show "Loading…").
    if (preview.kind === "loading") return;
    const node = el;
    if (node === undefined) return;
    const rect = node.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - rect.width - MARGIN));
    const spaceAbove = anchor.top - GAP - MARGIN;
    const spaceBelow = window.innerHeight - anchor.bottom - GAP - MARGIN;
    // What the card would measure with no cap on it. Whenever the card is capped
    // — by a previous pass, or by the `100vh` fallback on the first one —
    // `rect.height` is that cap rather than the content's height, so whatever the
    // code region is currently hiding has to be added back; else the card judges
    // itself short enough for a gap it has long outgrown.
    const hidden = codeEl === undefined ? 0 : codeEl.scrollHeight - codeEl.clientHeight;
    const natural = rect.height + hidden;
    // Prefer above while the card fits there; once it has outgrown both sides,
    // take the roomier one. Position is height-independent on either branch
    // (bottom when above, top when below), so only the side choice reads the
    // height and one pass settles it. Reassigning `preview` on an expansion
    // re-runs this, so the side is re-judged as the card grows.
    const above = natural <= spaceAbove || spaceAbove > spaceBelow;
    const maxHeight = Math.max(0, above ? spaceAbove : spaceBelow);
    // The token's horizontal centre as an offset within the card, so the pop-in
    // origins at the filename (clamped to the card when the card was shifted to fit).
    const originX = Math.max(0, Math.min(rect.width, anchor.left + anchor.width / 2 - left));
    placement = above
      ? { left, bottom: window.innerHeight - anchor.top + GAP, above, originX, maxHeight }
      : { left, top: anchor.bottom + GAP, above, originX, maxHeight };
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
  class:fp-above={placement.above}
  data-file-preview
  role="tooltip"
  style:left="{placement.left}px"
  style:top={placement.top === undefined ? null : `${placement.top}px`}
  style:bottom={placement.bottom === undefined ? null : `${placement.bottom}px`}
  style:--fp-origin-x="{placement.originX}px"
  style:--fp-max-height={placement.maxHeight === undefined ? null : `${placement.maxHeight}px`}
>
  <div class="fp-header">
    <span class="fp-badge">Preview</span>
    <span class="fp-path">{preview.kind === "ready" ? preview.excerpt.path : path}</span>
    <span class="fp-header-end">
      {#if meta}<span class="fp-range">{meta.label}</span>{/if}
      {#if showShortcutHints}
        <span class="fp-hint"><Kbd class="kbd-sm">esc</Kbd> to close</span>
      {/if}
    </span>
  </div>
  {#if preview.kind === "ready" && meta}
    {#if meta.above > 0}
      <button
        type="button"
        class="fp-edge fp-edge-top"
        aria-label="{meta.above} {lineWord(meta.above)} above — show {Math.min(
          EXPAND_STEP,
          meta.above,
        )} more"
        aria-busy={expanding}
        onclick={() => expand("up")}>↑ {meta.above} {lineWord(meta.above)} above</button
      >
    {/if}
    <div bind:this={codeEl} class="fp-code" style:--fp-gutter={meta.gutter}>
      {#each preview.rows as row (row.num)}
        <div class="fp-row" class:fp-target={row.num === line}>
          <span class="fp-lnum">{row.num}</span
          >{#if row.html !== undefined}<code class="fp-lcode">{@html row.html}</code
            >{:else}<code class="fp-lcode">{row.text}</code>{/if}
        </div>
      {/each}
    </div>
    {#if meta.below > 0}
      <button
        type="button"
        class="fp-edge fp-edge-bottom"
        aria-label="{meta.below} {lineWord(meta.below)} below — show {Math.min(
          EXPAND_STEP,
          meta.below,
        )} more"
        aria-busy={expanding}
        onclick={() => expand("down")}>↓ {meta.below} {lineWord(meta.below)} below</button
      >
    {/if}
  {:else if preview.kind === "too-large"}
    <div class="fp-message" data-preview-state="too-large">This file is too large to preview.</div>
  {:else if preview.kind === "error"}
    <div class="fp-message" data-preview-state="error">Couldn't load this file.</div>
  {:else}
    <div class="fp-message" data-preview-state="loading">Loading…</div>
  {/if}
</div>

<style>
  /* A caret-surface preview card echoing the link tooltip's chrome: paper-raised,
     hairline rule, card shadow. Fixed to the viewport at the clicked token, so it
     escapes the .diff-plan scroll clip; pointer-events stay on so the reader can
     move onto it (to scroll a long line) without it dismissing. */
  .file-preview {
    position: fixed;
    /* Above the top bar (z 30), the review switcher and badges (z 40), so an
       active preview is never occluded by the chrome; below modal dialogs (z 100),
       which supersede the preview entirely. */
    z-index: 60;
    max-width: min(72ch, 90vw);
    /* A column so the header and both strips stay pinned while only .fp-code
       scrolls between them. The card grows with the window the reader expands
       until it reaches the viewport edge the placement effect measured. */
    display: flex;
    flex-direction: column;
    max-height: var(--fp-max-height, 100vh);
    overflow: hidden;
    /* The card paints on the shadcn popover surface (bridged: --popover =
       --paper-raised, --border = --rule), so this preview card reads as one family
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
       then jumps to full height on first open. */
    opacity: 0;
  }
  .file-preview.fp-shown {
    opacity: 1;
    animation: fp-pop var(--dur-fast) var(--ease-out);
    /* Spring from where the card meets the token: x tracks the filename (--fp-origin-x),
       y sits on the card's near edge — top by default (card below the token), flipped
       to bottom when it landed above — so it reads as popping off the name, not scaling
       from its own centre. */
    transform-origin: var(--fp-origin-x, 50%) top;
  }
  .file-preview.fp-above.fp-shown {
    transform-origin: var(--fp-origin-x, 50%) bottom;
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
    color: var(--ink-faint);
    white-space: nowrap;
  }
  /* Range + the esc hint pushed to the header's right edge as one group. */
  .fp-header-end {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    margin-left: auto;
  }
  /* The "esc to close" affordance — a quiet recessed chip wrapping the esc keycap,
     naming the way out of the click-opened preview (EXC-840). Faint ink so it reads
     as ambient guidance, not a control; the keycap tints off that same faint ink. */
  .fp-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    padding: 0.1rem 0.4rem;
    border-radius: var(--radius);
    background: var(--paper-sunk);
    color: var(--ink-faint);
    white-space: nowrap;
  }
  /* The boundary strips: a recessed (paper-sunk) band above and/or below the
     window saying how much file it omits — and the control that reaches it. A
     click widens the window one step toward that end, so the count is both the
     label and the affordance; the strip retires once its side hits the file's
     edge. A button with the UA border and font dropped, so it keeps reading as
     part of the card until the pointer or keyboard lands on it. */
  .fp-edge {
    flex: 0 0 auto;
    border: 0;
    padding: 0.25rem 0.6rem;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    text-align: center;
    color: var(--ink-soft);
    background: var(--paper-sunk);
    user-select: none;
    transition: color var(--dur-fast) var(--ease-out);
  }
  .fp-edge:hover {
    color: var(--ink);
  }
  /* Inset the app-wide focus ring rather than restyling it: the card clips to its
     radius, so an outset ring on a flush-edge strip would be cut off. */
  .fp-edge:focus-visible {
    outline-offset: -2px;
  }
  /* A widened window is loading, and this click would be dropped — say so rather
     than looking live and doing nothing. */
  .fp-edge[aria-busy="true"] {
    color: var(--ink-faint);
    cursor: progress;
  }
  .fp-edge-top {
    border-bottom: 1px solid var(--rule);
  }
  .fp-edge-bottom {
    border-top: 1px solid var(--rule);
  }
  /* The excerpt: one flex row per source line — a sticky line-number gutter that
     stays put as long lines scroll horizontally, plus the line's highlighted
     code. This is the card's only scrolling region, in both axes: once the window
     outgrows the card's height cap it pages here, between a pinned header and
     pinned strips. The code reads at the plan source view's own grid — the same
     font stack, --text-base size, --leading-normal rhythm, and tabular figures
     the .diffview bridge sets (app.css) — so an excerpt looks like a window onto
     the plan, not a smaller sibling. The header and boundary strips stay at the
     --text-2xs label size. */
  .fp-code {
    flex: 1;
    min-height: 0;
    padding: 0.4rem 0;
    overflow: auto;
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
  @keyframes fp-pop {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
