<script lang="ts">
  // The filename preview (EXC-687, click-opened since EXC-840): an in-flow panel
  // filling the drawer lane docked to the plan surface, showing a
  // syntax-highlighted excerpt of the file a plan references. Shown only for
  // references the daemon confirmed are real files (DiffPlanView gates it on the
  // resolved set), so it never promises a preview it can't deliver. The excerpt
  // frames the lines the reference cites — one line, or the whole `:start-end`
  // span (EXC-938), every one of them washed — else the file's head, and
  // scrolling near either end of it grows the region that way (EXC-969), one
  // chunk at a time and unprompted, until the whole file is reachable without
  // leaving the review — a downward step costs one chunk however many came
  // before. There is nothing to click for it: the boundaries carry no control,
  // because reading on is the gesture that loads — and reading on is a keyboard
  // gesture too (EXC-972): the region takes a tab stop, so the browser's own key
  // scrolling walks the file exactly as the wheel does. Only the rows near the
  // viewport are mounted (EXC-970): scrolling on is what loads a whole file, so a
  // spacer above and below carries the height of everything the window left out
  // and the DOM stays a screenful however much has arrived. That trades away
  // reach for anything that walks the DOM — find-in-page and assistive tech see
  // the mounted rows, not the whole loaded region — which is the standing cost of
  // windowing; the header's line range is what still names the whole of it, and
  // is a live region besides, so a landed chunk is announced as one sentence
  // rather than as rows that may not even be mounted. It carries the "esc to
  // close" hint too. The panel stays put until dismissed (Escape, or a click
  // away; DiffPlanView owns that).
  import { tick, untrack } from "svelte";

  import { EXCERPT_RADIUS, MAX_CITED_SPAN_LINES } from "@core/config/constants";
  import { appearance } from "@/state/appearance.svelte.ts";
  import { getFileExcerpt, HttpError } from "$lib/api.ts";
  import { type ChunkState, highlightChunk } from "$lib/diffview/highlight.ts";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { rowWindow } from "$lib/previewWindow.ts";
  import type { ThemeId } from "$lib/theme.ts";

  interface Props {
    reviewId: string;
    /** The referenced path (without any `:line`). */
    path: string;
    /** 1-based line to frame the excerpt on, if the reference carried one. For a
     * cited range this is its first line. */
    line?: number;
    /** 1-based inclusive last line of a cited range (`path:154-162`). Always ≥
     * `line`; absent for a single-line reference, which frames that one row. */
    endLine?: number;
    /** Whether the shortcut-hint affordances are shown (EXC-826); gates the
     * header's "esc to close" chip. Defaults to shown; Escape still closes the
     * preview regardless. */
    showShortcutHints?: boolean;
  }
  let { reviewId, path, line, endLine, showShortcutHints = true }: Props = $props();

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
  interface Ready {
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
  type Preview = { kind: "loading" } | { kind: "error" } | { kind: "too-large" } | Ready;
  // Raw, not deep-proxied: `preview` is only ever replaced wholesale, and its
  // `rows` array is one object per source line — unbounded once the reader
  // expands toward a large file's ends. Proxying every row would buy reactivity
  // nothing here and cost a signal per row read.
  let preview = $state.raw<Preview>({ kind: "loading" });

  /** Floor on a chunk, so a short viewport still walks a file at a sane rate. */
  const MIN_CHUNK = 50;

  const lastLine = (loaded: Ready) => loaded.startLine + loaded.lines.length - 1;

  // How near an edge starts a load, and how many lines arrive when one does,
  // both off the region's own measurements rather than a fixed count: a quarter
  // screen of slack, two screens of content.
  //
  // The step is deliberately much larger than the threshold. That is what makes
  // a gesture cost exactly one round trip — the chunk that lands carries the
  // edge back out of range, so the fill loop stops instead of walking the file.
  //
  // A quarter screen rather than a half is what leaves a freshly opened preview
  // alone. A bare-line reference opens a ~60-line window centred on the cited
  // line — under two screens on a typical lane — so its two edges sit close
  // together, and a slacker threshold would reach both of them before the reader
  // had moved and spend two round trips on a window nobody has read yet. A cited
  // range widens that window by its own span, which only pushes the edges
  // further apart; MAX_CITED_SPAN_LINES is what stops it widening without end.
  //
  // The measured row height is the figure to divide by, not `scrollHeight` over
  // the row count: rows are windowed (EXC-970), so `scrollHeight` is the region's
  // spacers plus its mounted rows, and it carries the code region's own padding
  // on top. It still measures the whole region — that is what the spacers are
  // for, and what keeps `pendingEdge`'s distance-to-the-end honest — but dividing
  // it by the row count charges that padding to every row. `rowH` is one row's
  // real height; the division stands in only before a row has been laid out.
  function step(region: HTMLElement, rows: number): { threshold: number; chunk: number } {
    const rowHeight = rowH > 0 ? rowH : region.scrollHeight / Math.max(1, rows);
    const visible = Math.ceil(region.clientHeight / Math.max(1, rowHeight));
    return { threshold: region.clientHeight / 4, chunk: Math.max(MIN_CHUNK, visible * 2) };
  }

  // Colour a contiguous span beginning at `startLine` and pair each line with its
  // real file line number. Line numbers always come from the span
  // (authoritative); the highlighted HTML is used only when there is exactly one
  // row per line, so a drift can never mislabel a line.
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

  // Whether the region on screen belongs to a reference the reader has already
  // moved off. It stays mounted and animates away while the next one loads, so a
  // switch reads as a departure rather than a blank — the panel not blanking
  // mid-load is the same property expand() preserves for chunk arrival.
  let departing = $state(false);

  // Take the newly loaded region: reset the offset and the framing latch in the
  // same step that puts it on screen. Both belong here rather than at the top of
  // the fetch, because until this moment the rows on screen are the *previous*
  // reference's — winding their offset back to zero would jump the outgoing file
  // to its first line just as it starts to leave.
  // Hold the swap until the outgoing region has actually finished leaving.
  // A warm local daemon answers well inside one frame, and the departure would
  // otherwise be set and cleared before the browser ever painted it — the
  // animation would play only when the fetch happened to be slow, which is the
  // one thing a reader would never predict. Waiting on the region's own
  // animations rather than on a duration keeps the timing in the stylesheet with
  // the tokens; a fetch slower than the animation finds it already finished and
  // waits for nothing. `getAnimations` is also the guard for happy-dom, which
  // lays nothing out and runs no animations.
  async function awaitDeparture(): Promise<void> {
    const region = codeEl;
    if (region === null || typeof region.getAnimations !== "function") return;
    // The class reaches the DOM on the next flush; asking before that finds no
    // animation to wait for and returns instantly.
    await tick();
    await Promise.allSettled(region.getAnimations().map((animation) => animation.finished));
  }

  function settle(next: Preview): void {
    // The new region is a fresh, unscrolled `.fp-code` — the {#key} on the
    // loaded path recreates it — and nothing scrolls it back to the top for us.
    // Carrying the old file's offset over would window the new one around a row
    // it may not even have, leaving a spacer where the opening chunk should be.
    scrollTop = 0;
    framed = false;
    preview = next;
    departing = false;
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
    const end = endLine;
    let cancelled = false;
    // A reference clicked while another file is already up keeps that file's
    // rows on screen to leave with (see .fp-leaving); a first open has nothing
    // to hold and shows the loading message as before.
    if (untrack(() => preview).kind === "ready") {
      departing = true;
    } else {
      preview = { kind: "loading" };
      framed = false;
      scrollTop = 0;
    }
    void (async () => {
      try {
        // A cited RANGE is framed through the endpoint's existing 1-based
        // inclusive range — the same one expand() threads for chunk growth —
        // padded by the daemon's own radius so the span gets the context a
        // single-line reference already gets. With no range only `line` goes,
        // and the daemon builds its own ±window around it.
        //
        // Both clamps are load-bearing rather than defensive. handleFileExcerpt
        // parses params with /^\d+$/, so a negative start would be dropped, the
        // range would come back undefined, and a reference near a file's head
        // would silently degrade to a head preview. And the span is the one
        // fetch size a plan rather than the viewport decides, so a citation of
        // thousands of lines would be highlighted and mounted whole on open —
        // MAX_CITED_SPAN_LINES is what keeps that bounded.
        const range =
          ln !== undefined && end !== undefined
            ? {
                start: Math.max(1, ln - EXCERPT_RADIUS),
                end: Math.min(end, ln + MAX_CITED_SPAN_LINES) + EXCERPT_RADIUS,
              }
            : undefined;
        const excerpt = await getFileExcerpt(id, p, ln, range);
        const themeId = untrack(() => appearance.themeId);
        const painted = await paint(excerpt.lines, excerpt.startLine, excerpt.language, themeId);
        if (cancelled) return;
        if (untrack(() => departing)) await awaitDeparture();
        if (cancelled) return;
        settle({
          kind: "ready",
          path: excerpt.path,
          language: excerpt.language,
          totalLines: excerpt.totalLines,
          startLine: excerpt.startLine,
          lines: excerpt.lines,
          themeId,
          ...painted,
        });
      } catch (err) {
        if (cancelled) return;
        // A file past the daemon's preview ceiling is its own state: the reader
        // is told why there's nothing to show, not that the load broke.
        settle(
          err instanceof HttpError && err.status === 413 ? { kind: "too-large" } : { kind: "error" },
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  // A theme switch recolours every line already loaded, so the panel is never
  // part one palette and part another, and never left in a palette the app has
  // moved off. Nothing is refetched — the raw text is already here. Both inputs
  // are tracked, so this reconciles whichever moves: a switch, or a write that
  // landed carrying the theme read before it. Re-entry costs two comparisons —
  // a region already in the live palette returns at once — so it settles rather
  // than looping.
  $effect(() => {
    const themeId = appearance.themeId;
    const loaded = preview;
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

  // Fetch the next chunk toward `direction` and add it to the region, reporting
  // whether it grew. Either way only the new lines are asked for, and the rows
  // already on screen stay put while they load, so the panel never blanks.
  //
  // Downward the chunk continues the region's grammar, so only it is coloured and
  // a step costs the same at the fortieth expansion as at the first. Upward is
  // the awkward direction — colouring a chunk correctly needs everything above
  // it, and nothing above it is loaded — so the whole region is recoloured from
  // its new first line. A theme that moved while the chunk was in flight takes
  // that same path, so the two halves can't end up in different palettes.
  // ponytail: one ceiling left. Upward recolouring is linear in the region, so
  // walking to the file's head is quadratic — caching each chunk's ending grammar
  // state would let a prepend keep the rows below it.
  async function expand(direction: "up" | "down"): Promise<boolean> {
    const region = codeEl;
    if (preview.kind !== "ready" || region === null) return false;
    const loaded = preview;
    const { chunk: span } = step(region, loaded.rows.length);
    const range =
      direction === "up"
        ? { start: Math.max(1, loaded.startLine - span), end: loaded.startLine - 1 }
        : { start: lastLine(loaded) + 1, end: lastLine(loaded) + span };
    const id = reviewId;
    const p = path;
    const ln = line;
    const end = endLine;
    // The parent reuses one instance across references; a chunk whose reference
    // moved on while it was in flight belongs to a file no longer on screen.
    const superseded = () => id !== reviewId || p !== path || ln !== line || end !== endLine;
    try {
      const excerpt = await getFileExcerpt(id, p, undefined, range);
      if (superseded()) return false;
      // The daemon clamps a range to the file, so a file edited down to fewer
      // lines than the region already holds answers with a line already on
      // screen. Take its count — that is what retires this side — and add
      // nothing, rather than putting one line number in two rows.
      const abuts =
        direction === "up"
          ? excerpt.endLine === loaded.startLine - 1
          : excerpt.startLine === lastLine(loaded) + 1;
      if (!abuts) {
        preview = { ...loaded, totalLines: excerpt.totalLines };
        return false;
      }
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
      if (superseded()) return false;
      // Bracket the prepend, not the fetch: this is the last read before the
      // region's content height changes, and a downward chunk never needs it.
      const heightBefore = direction === "up" ? region.scrollHeight : 0;
      preview = {
        ...loaded,
        totalLines: excerpt.totalLines,
        startLine,
        lines,
        themeId,
        ...painted,
      };
      if (direction === "up") {
        await tick();
        // Every revealed line sits above what the reader was looking at, so
        // adding the growth to the offset holds their place exactly. The spacers
        // carry the unmounted rows' height, so the growth the region reports is
        // the chunk's whether or not its rows were mounted (EXC-970). The browser
        // clamps the result when the region is taller than its content, and
        // rounds `scrollHeight` to whole pixels, so the shift is the chunk's
        // height to within one — the slack the e2e allows.
        //
        // The offset is read here rather than captured before the fetch: loading
        // is scroll-driven (EXC-969) and key-driven (EXC-972), so the gesture
        // that asked for this chunk is usually still going when it lands, and
        // restoring the offset it started from would discard everything the
        // reader scrolled in between, sliding the line they were on out from
        // under them. Only the height is captured beforehand, because a delta
        // needs both ends. Reading it live is also what makes `overflow-anchor:
        // none` on `.fp-code` load-bearing rather than tidy — see that rule.
        region.scrollTop += region.scrollHeight - heightBefore;
        syncScroll();
      }
      return true;
    } catch {
      // Keep the loaded region on screen and stop, rather than retrying into a
      // daemon that just refused: the next scroll is the reader's retry.
      return false;
    }
  }

  // Which end of the region, if either, is close enough to want its next chunk.
  // Downward first: a reader who has scrolled to a boundary is far more often
  // heading further into the file than back out of it.
  function pendingEdge(): "up" | "down" | undefined {
    const region = codeEl;
    const framing = meta;
    if (region === null || framing === undefined || preview.kind !== "ready") return undefined;
    // An unmeasured region — the lane mid-wipe, or a panel not yet laid out —
    // has no proximity to read and would size a chunk off a zero height.
    if (region.clientHeight === 0) return undefined;
    const { threshold } = step(region, preview.rows.length);
    const toBottom = region.scrollHeight - region.scrollTop - region.clientHeight;
    if (framing.below > 0 && toBottom <= threshold) return "down";
    if (framing.above > 0 && region.scrollTop <= threshold) return "up";
    return undefined;
  }

  let filling = false;
  // Load toward whichever edge is in reach, and keep going while one still is —
  // that repetition is what lets scrolling alone reach the end of the file. It
  // settles rather than runs away: each landed chunk is two screens against a
  // half-screen threshold, so it carries the edge out of reach, and a side that
  // hits the file's end stops offering a direction. Single-flight, so the flurry
  // of scroll events one wheel gesture emits asks for a range once.
  async function fillEdges(): Promise<void> {
    if (filling) return;
    filling = true;
    try {
      for (;;) {
        const direction = pendingEdge();
        if (direction === undefined) return;
        if (!(await expand(direction))) return;
      }
    } finally {
      filling = false;
    }
  }

  // The keys a focused scroll container moves on. The browser does the moving —
  // nothing here calls preventDefault — so the scroll they cause loads chunks
  // through `onscroll` exactly as a wheel notch does. This handler is the
  // keyboard's half of the `onwheel` retry: a region already pinned at its scroll
  // limit emits no scroll event, so a key press that moves nothing has to ask on
  // its own, and it is the only retry a keyboard reader has.
  const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);
  function onKeyDown(e: KeyboardEvent): void {
    if (SCROLL_KEYS.has(e.key)) void fillEdges();
  }

  let codeEl = $state<HTMLElement | null>(null);
  // The code region's live geometry, which is what decides how much of the
  // loaded region is worth mounting. Row height is measured off a real row
  // rather than computed from the type scale — see previewWindow.ts for the
  // fixed-height assumption it stands on. `padTop` is the region's own leading
  // padding, which sits above the first row and so is not part of any row's
  // offset.
  let scrollTop = $state(0);
  let viewportH = $state(0);
  let rowH = $state(0);
  let padTop = $state(0);

  /** Take the region's scroll offset back into state — on scroll, and after each
   * programmatic scroll, so the mounted rows never trail a jump by a frame. */
  function syncScroll(): void {
    scrollTop = codeEl?.scrollTop ?? 0;
  }

  // Keep the region's height and its row height current: the lane animates open
  // and is resizable by the reader, so neither is measured once. Rows are
  // uniform, so the first one answers for all of them — measured off its rect
  // rather than offsetHeight, which rounds to whole pixels: a line-height of
  // 20.34px read back as 20 loses a third of a pixel per row, which over a
  // thousand rows is a scrollbar that no longer reaches the file's end.
  //
  // The same callback covers the one case a scroll handler structurally cannot:
  // a region shorter than its viewport can't be scrolled, so it emits no event,
  // and the rest of the file would be unreachable with nothing left to click.
  // Deliberately *only* that case — a region that can scroll waits for the
  // reader to actually scroll it, so opening a preview never spends a round trip
  // on a window nobody has read yet, however tall the lane happens to be.
  $effect(() => {
    const region = codeEl;
    if (region === null) return;
    const measure = () => {
      viewportH = region.clientHeight;
      padTop = Number.parseFloat(getComputedStyle(region).paddingTop) || 0;
      const height = region.querySelector(".fp-row")?.getBoundingClientRect().height ?? 0;
      if (height > 0) rowH = height;
    };
    measure();
    const observer = new ResizeObserver(() => {
      measure();
      if (region.scrollHeight > region.clientHeight) return;
      void fillEdges();
    });
    observer.observe(region);
    return () => observer.disconnect();
  });

  // The mounted slice, and the spacer heights standing in for the rest. Before
  // the region has been laid out — and under happy-dom, which never lays out —
  // this is every row, so the panel is whole rather than empty while it waits.
  const win = $derived(
    rowWindow({
      total: preview.kind === "ready" ? preview.rows.length : 0,
      rowHeight: rowH,
      // Owed back because the padding sits above the first row: rowWindow reads
      // the offset from that row's top, not from the scroller's own origin.
      scrollTop: scrollTop - padTop,
      viewportHeight: viewportH,
    }),
  );
  const rendered = $derived(
    preview.kind === "ready" ? preview.rows.slice(win.first, win.first + win.count) : [],
  );
  // Columns a line occupies under `white-space: pre` and the default eight-column
  // tab stop, which is the width its row will actually take in a monospace face.
  // ponytail: a wide glyph (CJK, emoji) counts as one column, so a line of them
  // under-measures and that row's own box sets the range while it is mounted.
  const TAB_COLUMNS = 8;
  const columns = (line: string): number => {
    let width = 0;
    for (const ch of line) {
      width = ch === "\t" ? (Math.floor(width / TAB_COLUMNS) + 1) * TAB_COLUMNS : width + 1;
    }
    return width;
  };
  // The widest loaded line. The spacers carry it as a min-width, so the
  // horizontal range covers every loaded line rather than only the mounted ones
  // — otherwise scrolling down a file of long lines would shrink the range and
  // drag the reader back toward column one.
  const cols = $derived(
    preview.kind === "ready" ? preview.lines.reduce((w, l) => Math.max(w, columns(l)), 0) : 0,
  );

  let framed = false;
  // Bring the cited span into view on first open. The opening region is taller
  // than the code region, so the marked rows would otherwise sit below the fold.
  // Computed from the first row's index rather than read off `.fp-target`, which
  // the window need not have mounted; scrollTop directly rather than
  // scrollIntoView, which would also scroll the plan view beside the drawer.
  $effect(() => {
    if (preview.kind !== "ready" || framed || line === undefined) return;
    const region = codeEl;
    // Wait for a measured region: framing against one that has yet to be laid
    // out puts the rows wherever the later height lands.
    if (region === null || viewportH === 0 || rowH === 0) return;
    framed = true;
    // A reference citing a line past EOF gets a region clamped to the last line,
    // so no row carries it and there is nothing to frame — stop looking.
    const index = line - preview.startLine;
    if (index < 0 || index >= preview.rows.length) return;
    // Centre the whole span, clamping its end to the region: the daemon already
    // clamps the fetched range to the file, so there is no row past the last one
    // to frame. A single-line reference has spanH === rowH and reduces to
    // centring that one row; a span taller than the region drives the term to 0,
    // which parks its first line at the top — the overflow behaviour, no branch.
    const last = Math.min(endLine ?? line, lastLine(preview));
    const spanH = (last - line + 1) * rowH;
    const top = padTop + index * rowH - Math.max(0, (viewportH - spanH) / 2);
    // One flush before scrolling. The spacers standing in for the unmounted rows
    // are derived from the geometry measured just now, and the region can only be
    // scrolled as far as they reach — so moving in this same flush is clamped to
    // a scroll range that has yet to grow, landing short of the cited rows. It
    // shows up on a span, which is framed further down the window than a single
    // line ever is, and is silent on one line only because that lands under the
    // clamp.
    void tick().then(() => {
      // A reference switched in the meantime replaced the region ({#key}), and
      // that new one has its own framing to do.
      if (codeEl !== region) return;
      region.scrollTop = top;
      syncScroll();
    });
  });

  const lineWord = (n: number) => (n === 1 ? "line" : "lines");

  // Framing for the loaded region: how much file sits above/below it (which is
  // what tells `pendingEdge` a side still has somewhere to go), the header
  // label, and the digit width the line-number gutter needs. A region covering
  // the whole file reads as the full file, not a slice.
  const meta = $derived.by(() => {
    if (preview.kind !== "ready") return undefined;
    const { startLine, totalLines } = preview;
    // The loaded REGION's last line, which is not the `endLine` prop (a cited
    // range's last line) — the region routinely reaches well past a citation.
    const regionEnd = lastLine(preview);
    const above = startLine - 1;
    const below = totalLines - regionEnd;
    const whole = above === 0 && below === 0;
    const label = whole
      ? `${totalLines} ${lineWord(totalLines)}`
      : `lines ${startLine}–${regionEnd} of ${totalLines}`;
    return { above, below, label, gutter: `${String(regionEnd).length}ch` };
  });
</script>

<div class="file-preview" data-file-preview>
  <div class="fp-header">
    <span class="fp-badge">Preview</span>
    <span class="fp-path">{preview.kind === "ready" ? preview.path : path}</span>
    <span class="fp-header-end">
      <!-- The range doubles as the growth announcement: a chunk landing rewrites
           it, and role="status" hands a screen reader that one short sentence
           ("lines 1–180 of 300") instead of the hundreds of rows that arrived.
           The span itself outlives every load — only its text changes — so the
           live region is in place long before the first chunk. -->
      {#if meta}<span class="fp-range" role="status">{meta.label}</span>{/if}
      {#if showShortcutHints}
        <span class="fp-hint"><Kbd class="kbd-sm">esc</Kbd> to close</span>
      {/if}
    </span>
  </div>
  {#if preview.kind === "ready" && meta}
    <!-- onwheel alongside onscroll because a region pinned at its scroll limit
         stops emitting scroll events, and the reader still turning the wheel is
         exactly the retry after a chunk that failed to arrive — the only retry
         left, now that the boundary carries no control. onkeydown is the same
         retry for a reader who has no wheel.

         The tab stop is what makes reading on a keyboard gesture at all
         (EXC-972): Chrome and Safari leave a plain overflow:auto div out of the
         tab order, so removing the boundary strips took the panel's only
         focusable control with them. With it back, the browser's own key
         scrolling walks the file and nothing here has to reimplement it. svelte
         reads `region` as non-interactive whether or not it is focusable, so
         both warnings below are about the pattern itself. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <!-- Keyed on the LOADED path, not the prop: the region an arriving file gets
         has to be a new element, both so it starts unscrolled and so its enter
         animation runs. Keying on the prop instead would destroy the outgoing
         region the moment the reader clicked, leaving nothing to animate away.
         A chunk landing does not change the key, so growth stays motionless. -->
    {#key preview.path}
      <div
        bind:this={codeEl}
        class="fp-code"
        class:fp-leaving={departing}
        role="region"
        tabindex="0"
        aria-label="Contents of {preview.path}"
        style:--fp-gutter={meta.gutter}
        style:--fp-cols={cols}
        onscroll={() => {
          syncScroll();
          void fillEdges();
        }}
        onwheel={() => void fillEdges()}
        onkeydown={onKeyDown}
      >
        <div class="fp-spacer" style:height="{win.above}px" aria-hidden="true"></div>
        {#each rendered as row (row.num)}
          <div
            class="fp-row"
            class:fp-target={line !== undefined && row.num >= line && row.num <= (endLine ?? line)}
          >
            <span class="fp-lnum">{row.num}</span
            >{#if row.html !== undefined}<code class="fp-lcode">{@html row.html}</code
              >{:else}<code class="fp-lcode">{row.text}</code>{/if}
          </div>
        {/each}
        <div class="fp-spacer" style:height="{win.below}px" aria-hidden="true"></div>
      </div>
    {/key}
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
     app's own paper. A column so the header stays pinned while only .fp-code
     scrolls beneath it, and it takes the lane whole so a growing region pages
     inside the panel rather than stretching it. */
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
  /* The loaded region: one flex row per source line — a sticky line-number gutter
     that stays put as long lines scroll horizontally, plus the line's highlighted
     code. This is the panel's only scrolling region, in both axes: once the
     region outgrows the lane's height it pages here, beneath a pinned header.
     Scrolling it is also what fetches the next chunk, so it runs flush to the
     panel's bottom edge with nothing under it — a band there would read as a
     control, which is the affordance EXC-969 removed. The code reads at the plan
     source view's own grid — the same font stack, --text-base size,
     --leading-normal rhythm, and tabular figures the .diffview bridge sets
     (app.css) — so an excerpt looks like a window onto the plan, not a smaller
     sibling. The header stays at the --text-2xs label size. */
  .fp-code {
    flex: 1;
    min-height: 0;
    padding: 0.4rem 0;
    overflow: auto;
    /* This region anchors itself: an upward load shifts scrollTop by the height
       the prepended chunk added (see expand()). The browser's own scroll
       anchoring compensates for that same growth, so leaving it on double-counts
       — but only when a mounted row survives the prepend to anchor to, which is
       why it shows up on a chunk truncated at the file's head and not on a
       full-sized one, where every keyed row is replaced. Off, so the arithmetic
       stands on its own rather than on which regime the reader happens to be in. */
    overflow-anchor: none;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    line-height: var(--leading-normal);
    font-feature-settings: "tnum";
    color: var(--ink);
    /* A whole screen of code arriving in one frame reads as a cut. It settles up
       into place instead, on the chrome's enter curve. Only opacity and
       transform move: neither is a layout property, so the region's clientHeight
       and scrollHeight — which size the window (EXC-970), place the cited line
       (EXC-971) and bracket a prepend (EXC-969) — are the same mid-animation as
       after it. The travel is half AlertHost's 8px because this surface is the
       whole lane rather than a card, and the same distance on it reads as a
       lurch. */
    animation: fp-in var(--dur-base) var(--ease-out);
  }
  /* The outgoing file, still on screen while the next one loads. It leaves the
     way the next arrives from, so a switch reads as one movement rather than two
     unrelated ones, and `forwards` holds it cleared until the {#key} replaces it
     — a fetch slower than the animation must not flash the old rows back. It
     also stops taking gestures on the way out: a scroll landing here would ask
     for a chunk of the file the reader has just left. */
  .fp-code.fp-leaving {
    animation: fp-out var(--dur-fast) var(--ease-in) forwards;
    pointer-events: none;
  }
  /* Inset the app-wide focus ring (base.css) rather than restyling it: the drawer
     lane clips the panel, and the region runs flush to its edges, so an outset
     ring would be cut off on three sides. Same treatment .fp-edge carried before
     EXC-969 retired it. */
  .fp-code:focus-visible {
    outline-offset: -2px;
  }
  .fp-row {
    display: flex;
  }
  /* Stand-ins for the rows the window left unmounted. Height: the block they
     replace, so the scrollbar measures the whole loaded region and an unmounted
     row is indistinguishable from a scrolled-past one. Width: the widest loaded
     line, so the horizontal range covers every line rather than only the mounted
     ones — the gutter's own width plus the 1.4rem + 1.6rem of padding and the
     hairline between them. Both spacers are always present, at zero height when
     there is nothing to stand in for, so the width is too. Nothing paints. */
  .fp-spacer {
    min-width: calc(var(--fp-gutter, 2ch) + var(--fp-cols, 0) * 1ch + 3rem + 1px);
  }
  /* The referenced lines — washed so the reader's eye lands on them. Uses caret's
     content-mark amber (--mark, the same attention wash source annotations use)
     with a metadata-accent line number, NOT the brand-solid accent fill. Only a
     reference that carried a :line has target rows; head previews mark nothing.

     A cited range washes every one of its lines, contiguous rows reading as one
     band, and each keeps the accent gutter rather than reserving it for the
     span's first line: a range taller than the region opens parked at its head,
     so a reader who scrolls into the middle of one would otherwise see a wash
     with no accent anywhere and lose the only signal that they are still inside
     the citation. */
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
    /* One line of text rather than a screenful, so it takes the shorter
       duration — long enough not to pop, short enough that a reader waiting to
       be told the file is too large is not watching it arrive. */
    animation: fp-in var(--dur-fast) var(--ease-out);
  }
  /* Both halves travel the same 4px in the same direction: contents rise into
     place, and the file being replaced keeps rising as it goes. Reduced motion is
     not handled here — the global kill-switch in styles/base.css collapses every
     animation under #app, and per doc/agents/svelte-rules.md no component honors
     the preference on its own. */
  @keyframes fp-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes fp-out {
    from {
      opacity: 1;
      transform: translateY(0);
    }
    to {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
</style>
