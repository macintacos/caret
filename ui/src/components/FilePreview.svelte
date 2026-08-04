<script lang="ts">
  // The filename preview (EXC-687, click-opened since EXC-840): an in-flow panel
  // filling the drawer lane docked to the plan surface, showing a
  // syntax-highlighted excerpt of the file a plan references. Shown only for
  // references the daemon confirmed are real files (DiffPlanView gates it on the
  // resolved set), so it never promises a preview it can't deliver. The excerpt
  // centers on the reference's line when it carries one, else the file's head,
  // and the boundary strips load the next chunk toward the file's ends on click,
  // appending to what is already there until the whole file is reachable without
  // leaving the review — a step costs one chunk, however many came before. The header
  // carries an "esc to close" hint — the panel stays put until dismissed (Escape,
  // or a click away; DiffPlanView owns that).
  import { tick, untrack } from "svelte";

  import { appearance } from "@/state/appearance.svelte.ts";
  import { getFileExcerpt, HttpError } from "$lib/api.ts";
  import { type ChunkState, highlightChunk } from "$lib/diffview/highlight.ts";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import type { ThemeId } from "$lib/theme.ts";

  interface Props {
    reviewId: string;
    /** The referenced path (without any `:line`). */
    path: string;
    /** 1-based line to center the excerpt on, if the reference carried one. */
    line?: number;
    /** Whether the shortcut-hint affordances are shown (EXC-826); gates the
     * header's "esc to close" chip. Defaults to shown; Escape still closes the
     * preview regardless. */
    showShortcutHints?: boolean;
  }
  let { reviewId, path, line, showShortcutHints = true }: Props = $props();

  // One rendered source line: its real file line number, plus either the
  // highlighted token HTML (shiki) or the raw text (plain fallback).
  interface Row {
    num: number;
    html?: string;
    text?: string;
  }
  // The loaded region: contiguous, grown one chunk at a time. `lines` is the raw
  // text — kept so a theme switch can recolour without refetching a byte — and
  // `rows` its rendered form, one entry per line. `state` is the grammar state
  // the region's last line ended on, which is where the next chunk below it
  // starts from; `themeId` is the palette `rows` were coloured in.
  interface Loaded {
    kind: "ready";
    path: string;
    language: string;
    totalLines: number;
    startLine: number;
    lines: string[];
    rows: Row[];
    themeId: ThemeId;
    state?: ChunkState;
  }
  type Preview = { kind: "loading" } | { kind: "error" } | { kind: "too-large" } | Loaded;
  // Raw, not deep-proxied: `preview` is only ever replaced wholesale, and its
  // `rows` array is one object per source line — unbounded once the reader
  // expands toward a large file's ends. Proxying every row would buy reactivity
  // nothing here and cost a signal per row read.
  let preview = $state.raw<Preview>({ kind: "loading" });

  /** Lines one strip click adds to that side of the loaded region. */
  const EXPAND_STEP = 50;

  const lastLine = (loaded: Loaded) => loaded.startLine + loaded.lines.length - 1;

  // Colour a contiguous span beginning at `startLine` and pair each line with its
  // real file line number. `state` continues the grammar of the chunk above, so a
  // block comment or template literal opened up there still colours these lines;
  // omitting it starts clean, which is what a span read from its own first line
  // wants. Line numbers always come from the span (authoritative); the highlighted
  // HTML is used only when there is exactly one row per line, so a drift can never
  // mislabel a line.
  async function paint(
    lines: string[],
    startLine: number,
    language: string,
    themeId: ThemeId,
    state?: ChunkState,
  ): Promise<{ rows: Row[]; state?: ChunkState }> {
    const chunk = await highlightChunk(lines.join("\n"), language, themeId, state);
    const useHtml = chunk.rows.length === lines.length;
    return {
      rows: lines.map((text, i) => ({
        num: startLine + i,
        html: useHtml ? chunk.rows[i] : undefined,
        text: useHtml ? undefined : text,
      })),
      state: chunk.state,
    };
  }

  // Fetch the opening chunk. Re-runs when the target reference changes
  // (DiffPlanView reuses this instance for a newly-clicked reference), dropping
  // everything the previous reference accumulated, and deliberately depends on
  // nothing else — expansion is a handler, not an effect, so a grown region never
  // re-enters here. The theme is read untracked for the same reason: a switch
  // recolours what is loaded (see the repaint effect) rather than refetching it.
  $effect(() => {
    const id = reviewId;
    const p = path;
    const ln = line;
    let cancelled = false;
    preview = { kind: "loading" };
    centred = false;
    void (async () => {
      try {
        const excerpt = await getFileExcerpt(id, p, ln);
        const themeId = untrack(() => appearance.themeId);
        const painted = await paint(excerpt.lines, excerpt.startLine, excerpt.language, themeId);
        if (cancelled) return;
        preview = {
          kind: "ready",
          path: excerpt.path,
          language: excerpt.language,
          totalLines: excerpt.totalLines,
          startLine: excerpt.startLine,
          lines: excerpt.lines,
          themeId,
          ...painted,
        };
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

  // A theme switch recolours every line already loaded, so the panel is never
  // part one palette and part another. Nothing is refetched — the raw text is
  // already here. `preview` is read untracked so this can write it without
  // re-entering itself; the only dependency is the live theme.
  $effect(() => {
    const themeId = appearance.themeId;
    const loaded = untrack(() => preview);
    if (loaded.kind !== "ready" || loaded.themeId === themeId) return;
    void (async () => {
      const painted = await paint(loaded.lines, loaded.startLine, loaded.language, themeId);
      // A later switch or an expansion landed first, and painted in the theme
      // showing now; this pass is stale either way.
      const live = untrack(() => preview);
      if (live !== loaded || untrack(() => appearance.themeId) !== themeId) return;
      preview = { ...loaded, themeId, ...painted };
    })();
  });

  // Reactive so the strips can show they are busy: a click that lands while a
  // chunk is in flight is dropped, and the wait is the load of one step.
  let expanding = $state(false);
  // Fetch the next chunk toward `direction` and add it to the region. Only the
  // new lines are asked for, so a step costs the same at the fortieth expansion
  // as at the first; the rows already on screen stay put while it loads, so the
  // panel never blanks.
  //
  // Downward the chunk continues the region's grammar, so only it is coloured.
  // Upward is the awkward direction — colouring a chunk correctly needs
  // everything above it, and nothing above it is loaded — so the region is
  // recoloured from its new first line, exactly the pass a widened window used to
  // take. A theme that moved mid-flight takes the same path, so the two halves
  // can't end up in different palettes.
  // ponytail: a fixed EXPAND_STEP means a 20k-line file is hundreds of clicks
  // from end to end; a step that tracks the visible row count is the upgrade path.
  async function expand(direction: "up" | "down"): Promise<void> {
    if (preview.kind !== "ready" || expanding) return;
    const loaded = preview;
    const range =
      direction === "up"
        ? { start: Math.max(1, loaded.startLine - EXPAND_STEP), end: loaded.startLine - 1 }
        : { start: lastLine(loaded) + 1, end: lastLine(loaded) + EXPAND_STEP };
    const id = reviewId;
    const p = path;
    const ln = line;
    const region = codeEl;
    const before =
      region === undefined ? null : { top: region.scrollTop, height: region.scrollHeight };
    // The parent reuses one instance across references; a chunk whose reference
    // moved on while it was in flight belongs to a file no longer on screen.
    const superseded = () => id !== reviewId || p !== path || ln !== line;
    expanding = true;
    try {
      const excerpt = await getFileExcerpt(id, p, undefined, range);
      if (superseded()) return;
      const themeId = untrack(() => appearance.themeId);
      const startLine = direction === "up" ? excerpt.startLine : loaded.startLine;
      const lines =
        direction === "up"
          ? [...excerpt.lines, ...loaded.lines]
          : [...loaded.lines, ...excerpt.lines];
      let painted: { rows: Row[]; state?: ChunkState };
      if (direction === "down" && themeId === loaded.themeId) {
        const chunk = await paint(
          excerpt.lines,
          excerpt.startLine,
          loaded.language,
          themeId,
          loaded.state,
        );
        painted = { rows: [...loaded.rows, ...chunk.rows], state: chunk.state };
      } else {
        painted = await paint(lines, startLine, loaded.language, themeId);
      }
      if (superseded()) return;
      preview = { ...loaded, startLine, lines, themeId, ...painted };
      if (direction === "up" && region !== undefined && before !== null) {
        await tick();
        // Every revealed line sits above what the reader was looking at, so
        // adding the growth back to the offset holds their place exactly. The
        // browser clamps the result when the region is taller than its content.
        region.scrollTop = before.top + (region.scrollHeight - before.height);
      }
    } catch {
      // Keep the loaded region on screen; the strip stays clickable.
    } finally {
      expanding = false;
    }
  }

  let codeEl = $state<HTMLElement>();
  let centred = false;
  // Bring the cited line into view on first open. The opening window is taller
  // than the code region, so the marked row would otherwise sit below the fold.
  // scrollTop directly rather than scrollIntoView, which would also scroll the
  // plan view beside the drawer.
  $effect(() => {
    if (preview.kind !== "ready" || centred || line === undefined) return;
    const region = codeEl;
    // Wait for the region to have a settled height: centring against one that
    // has yet to be laid out puts the row wherever the later height lands.
    if (region === undefined || region.clientHeight === 0) return;
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

  const lineWord = (n: number) => (n === 1 ? "line" : "lines");

  // Framing for the loaded region: how much file sits above/below it (so the
  // boundary strips can say so), the header label, and the digit width the
  // line-number gutter needs. A region covering the whole file reads as the full
  // file, not a slice.
  const meta = $derived.by(() => {
    if (preview.kind !== "ready") return undefined;
    const { startLine, totalLines } = preview;
    const endLine = lastLine(preview);
    const above = startLine - 1;
    const below = totalLines - endLine;
    const whole = above === 0 && below === 0;
    const label = whole
      ? `${totalLines} ${lineWord(totalLines)}`
      : `lines ${startLine}–${endLine} of ${totalLines}`;
    return { above, below, label, gutter: `${String(endLine).length}ch` };
  });
</script>

<div class="file-preview" data-file-preview>
  <div class="fp-header">
    <span class="fp-badge">Preview</span>
    <span class="fp-path">{preview.kind === "ready" ? preview.path : path}</span>
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
  /* The preview panel: an in-flow column filling the lane it is docked in, on the
     app's own paper. A column so the header and both strips stay pinned while
     only .fp-code scrolls between them, and it takes the lane whole so a widened
     window pages inside the panel rather than stretching it. */
  .file-preview {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--paper);
    color: var(--ink);
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
  /* The explicit "Preview" label — a filled chip so the panel is unmistakably a
     snippet, not the file itself. Neutral ink fill (amber stays brand-reserved);
     high-contrast against the panel in both schemes. */
  .fp-badge {
    flex: 0 0 auto;
    align-self: center;
    padding: 0.05rem 0.4rem;
    border-radius: var(--radius);
    background: var(--ink-soft);
    color: var(--paper);
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
     part of the panel until the pointer or keyboard lands on it. */
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
  /* Inset the app-wide focus ring rather than restyling it: the drawer lane clips
     the panel, so an outset ring on a flush-edge strip would be cut off. */
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
     code. This is the panel's only scrolling region, in both axes: once the
     window outgrows the lane's height it pages here, between a pinned header and
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
    background: var(--paper);
    border-right: 1px solid var(--rule);
    user-select: none;
    white-space: pre;
  }
  .fp-lcode {
    /* Set the font stack directly on the <code>, not just on .fp-code: the UA
       stylesheet's own `code { font-family: monospace }` overrides an inherited
       family, so without this rule the excerpt lines render in the browser's
       default monospace while the rest of the panel is Berkeley Mono — two fonts
       in one panel. This pins them to the plan view's stack. */
    font-family: var(--font-mono);
    padding: 0 0.8rem;
    white-space: pre;
  }
  .fp-message {
    padding: 0.5rem 0.6rem;
    color: var(--ink-soft);
    font-size: var(--text-2xs);
  }
</style>
