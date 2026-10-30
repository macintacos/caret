<script lang="ts">
  // The plan preview: mounts renderPlanMarkdown's HTML as-is in one container, so its
  // div[data-source-start][data-source-end] blocks stay direct children for the
  // source-mapped features to find. DiffPlanView decides which text and when; this mounts
  // it, sets what HTML cannot carry, highlights its code blocks once each has mounted
  // plain, marks the soft-wrapped ones, tags the resolved file references and opens them
  // on click, reports the rows a plain click or a comment drag covers, and styles it.
  import { FILE_ICON_MASK, FOLDER_ICON_MASK } from "$lib/diffview/coreStyles.ts";
  import type { FileRefSpan } from "$lib/diffview/fileRefs.ts";
  import { highlightTokens } from "$lib/diffview/highlight.ts";
  import { hideTooltip, showTooltip } from "$lib/diffview/linkInteractions.ts";
  import { applyPreviewReflow, highlightPreviewCode } from "$lib/previewCode.ts";
  import type { TextPoint } from "$lib/previewLines.ts";
  import { type PreviewFileRef, tagPreviewFileRefs } from "$lib/previewRefs.ts";
  import { type ThemeId, themeFor } from "$lib/theme.ts";

  interface Props {
    /** renderPlanMarkdown's already-sanitized HTML. Inserted unescaped. */
    html: string;
    /** renderPlanMarkdown's grammar per code block, keyed by its first code line. */
    codeLanguages?: ReadonlyMap<number, string>;
    /** The theme to highlight in; omitted leaves code blocks plain. */
    themeId?: ThemeId;
    /** Opening fence lines of the soft-wrapped blocks, shared with the source view. */
    reflowedBlocks?: ReadonlySet<number>;
    /** The element whose content is the rendered HTML, plus the comment slots' empty gaps:
     * DiffPlanView's chrome geometry and its place-keeping across a flip read it.
     * Bindable, and cleared on unmount, unlike an onReady handle. */
    root?: HTMLDivElement;
    /** The daemon-resolved references to tag, keyed by their display text. */
    fileRefs?: readonly PreviewFileRef[];
    /** A tagged reference was clicked. */
    onFileRefClick?: (ref: FileRefSpan, el: HTMLElement) => void;
    /** The visual line at a viewport height, as the point it starts at: rows span the
     * column, so the height alone picks one. */
    rowAt?: (y: number) => TextPoint | null;
    /** A plain click, or a comment drag's release: the rows from the press's through the
     * release's, in either order. DiffPlanView maps them to source lines. */
    onTextComment?: (from: TextPoint, to: TextPoint) => void;
    /** A comment drag's press row once the pointer leaves it; null when the drag ends. */
    onCommentDrag?: (anchor: TextPoint | null) => void;
    /** Shift is held: the pointer selects text, so it shows the text cursor. */
    selectText?: boolean;
  }
  let {
    html,
    codeLanguages = new Map(),
    themeId,
    reflowedBlocks = new Set(),
    root = $bindable(),
    fileRefs = [],
    onFileRefClick,
    rowAt,
    onTextComment,
    onCommentDrag,
    selectText = false,
  }: Props = $props();

  $effect(() => {
    void html;
    if (!root) return;
    // `indeterminate` has no attribute form, so the sanitized HTML can't carry it.
    for (const input of root.querySelectorAll<HTMLInputElement>('input[data-task="slashed"]')) {
      input.indeterminate = true;
    }
  });

  // `error` does not bubble, hence the capture listener. Matches the source view's
  // failed image (inlineImages.ts).
  function hideFailedImage(event: Event) {
    if (event.target instanceof HTMLImageElement) event.target.hidden = true;
  }

  // Read every input here rather than inside the async pass, so Svelte tracks them: a
  // theme switch, or a replace of the showing theme, re-runs it.
  $effect(() => {
    void html;
    const el = root;
    const theme = themeId;
    const languages = codeLanguages;
    if (!el || theme === undefined) return;
    void themeFor(theme);
    const controller = new AbortController();
    void highlightPreviewCode(el, languages, {
      tokenize: (code, language) => highlightTokens(code, language, theme),
      nextTask: () => new Promise((resolve) => setTimeout(resolve, 0)),
      signal: controller.signal,
    });
    return () => controller.abort();
  });

  $effect(() => {
    void html;
    if (root) applyPreviewReflow(root, reflowedBlocks);
  });

  // How far a table's pinned header row may slide before it sits on the last row.
  $effect(() => {
    void html;
    const el = root;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        const row = target.querySelector(":scope > thead > tr");
        if (target instanceof HTMLElement && row instanceof HTMLElement)
          target.style.setProperty("--pin-travel", `${target.clientHeight - row.offsetHeight}px`);
      }
    });
    for (const table of el.querySelectorAll("table")) observer.observe(table);
    return () => observer.disconnect();
  });

  let tagged = new Map<HTMLElement, FileRefSpan>();
  $effect(() => {
    void html;
    const refs = fileRefs;
    const el = root;
    if (!el) return;
    tagged = tagPreviewFileRefs(el, refs);
    // A replaced or unmounted wrapper fires no pointerout, so its body-mounted bubble
    // would otherwise outlive it.
    return () => hideTooltip(el);
  });

  function refAt(target: EventTarget | null): [HTMLElement, FileRefSpan] | undefined {
    const el = target instanceof Element ? target.closest<HTMLElement>("[data-file-ref]") : null;
    const ref = el ? tagged.get(el) : undefined;
    return el && ref ? [el, ref] : undefined;
  }

  // A drag that started on a reference comments on its rows; the click its release fires
  // must not open the file too.
  let dragged = false;

  function onRootClick(event: MouseEvent) {
    const hit = refAt(event.target);
    if (!hit) return;
    // preventDefault so a reference inside a link opens the file, not the URL — as in the
    // source view, where a reference click also wins over its link.
    event.preventDefault();
    if (!dragged && document.getSelection()?.isCollapsed !== false)
      onFileRefClick?.(hit[1], hit[0]);
  }

  let gesture: AbortController | undefined;
  $effect(() => () => gesture?.abort());

  const CONTROLS = "a, button, input, label, select, summary, textarea";
  const USER_SELECT = ["user-select", "-webkit-user-select"];
  const sameRow = (a: TextPoint | null | undefined, b: TextPoint) =>
    a?.line === b.line && a.column === b.column;
  /** Whether a press landed on its target's own scrollbar, a wide table's or code block's,
   * past the client box of an element that scrolls. */
  const onScrollbar = ({ target, offsetX, offsetY }: PointerEvent) =>
    target instanceof HTMLElement &&
    (target.scrollWidth > target.clientWidth || target.scrollHeight > target.clientHeight) &&
    (offsetX >= target.clientWidth || offsetY >= target.clientHeight);

  // A plain press selects rows, as the source view's body drag selects lines (lineDrag.ts):
  // released on its own row it is a click on that row, on another a drag across the rows
  // between. Native selection is held off while it runs, so it paints no text. Shift bows
  // out so the browser selects text — the copy escape hatch — dropping a selection left
  // outside the root (a closed composer's) first, or the native drag would extend from it.
  // Controls keep their own clicks, a scrollbar its scroll, and a reference its click. The
  // release listens on window, since a drag can end over a slot, and every terminator ends
  // the gesture.
  function armRows(event: PointerEvent) {
    gesture?.abort();
    dragged = false;
    const selection = document.getSelection();
    if (event.shiftKey) {
      if (selection?.rangeCount && !root?.contains(selection.anchorNode))
        selection.removeAllRanges();
      return;
    }
    const el = root;
    const control = event.target instanceof Element && event.target.closest(CONTROLS) !== null;
    if (!onTextComment || !el || event.button !== 0 || control || onScrollbar(event)) return;
    const anchor = rowAt?.(event.clientY);
    if (!anchor) return;
    const comment = onTextComment;
    const onRef = refAt(event.target) !== undefined;
    if (selection?.rangeCount && el.contains(selection.anchorNode)) selection.removeAllRanges();
    for (const prop of USER_SELECT) el.style.setProperty(prop, "none");
    const current = new AbortController();
    gesture = current;
    const { signal } = current;
    const endGesture = () => current.abort();
    let dragging = false;
    signal.addEventListener("abort", () => {
      for (const prop of USER_SELECT) el.style.removeProperty(prop);
      if (dragging) onCommentDrag?.(null);
    });
    window.addEventListener(
      "pointermove",
      (move) => {
        if (dragging || sameRow(rowAt?.(move.clientY), anchor)) return;
        dragging = true;
        onCommentDrag?.(anchor);
      },
      { signal },
    );
    window.addEventListener(
      "pointerup",
      (up) => {
        const row = rowAt?.(up.clientY) ?? anchor;
        dragged = dragging || !sameRow(row, anchor);
        endGesture();
        if (dragged) comment(anchor, row);
        else if (!onRef) comment(anchor, anchor);
      },
      { signal },
    );
    window.addEventListener("pointercancel", endGesture, { signal });
    window.addEventListener("blur", endGesture, { signal });
  }

  function showRefTarget(event: PointerEvent) {
    const hit = refAt(event.target);
    if (hit?.[1].target !== undefined) showTooltip(hit[0], hit[1].target);
  }

  function hideRefTarget(event: PointerEvent) {
    const hit = refAt(event.target);
    if (hit) hideTooltip(hit[0]);
  }
</script>

<!-- References are pointer-only here, as on the source view, where only the hint badge is a
  keyboard opener; the click is delegated from the root. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="plan-preview"
  bind:this={root}
  onerrorcapture={hideFailedImage}
  onclick={onRootClick}
  onpointerdown={armRows}
  onpointerover={showRefTarget}
  onpointerout={hideRefTarget}
  data-rows={onTextComment ? "" : undefined}
  data-select-text={selectText ? "" : undefined}
  style:--file-ref-icon={FILE_ICON_MASK}
  style:--folder-ref-icon={FOLDER_ICON_MASK}>{@html html}</div>

<style>
  /* Light-DOM: the source view's shadow-adopted highlight rules can't reach the preview,
     so it carries its own. --mark is caret's content-highlight wash. */
  :global(::highlight(caret-comment-span)) {
    background-color: var(--mark);
  }
  :global(::highlight(caret-preview-search)) {
    background-color: var(--mark);
  }
  :global(::highlight(caret-preview-search-current)) {
    background-color: var(--mark-active);
  }

  /* In the preview's own em, so every line wraps at the same word at any zoom, text size,
     base font size or window width (a narrow window scrolls sideways): what a row cites
     must not move. The text is 15px at the default base font size, so this is an 800px
     column with 2ch + 25px and 12px of padding there. The end padding takes up any wider
     plan, so a row reaches the plan's right edge, as a source row does. */
  .plan-preview {
    --column: calc(800em / 15);
    min-width: var(--column);
    padding-block: 0.5rem;
    padding-inline: calc(2ch + 25em / 15) max(0.8em, 100% - var(--column) + 0.8em);
    font-size: calc(var(--text-base) * var(--preview-scale));
    overflow-wrap: break-word;
  }
  /* A comment slot's room in the text (previewComments.ts's gaps): a row of its own, in a
     table a table row. */
  .plan-preview :global([data-preview-gap]) {
    display: block;
  }
  .plan-preview :global(:is(table, thead, tbody, tfoot) > [data-preview-gap]) {
    display: table-row;
  }
  /* A press selects rows, as a source row's does; Shift selects text. */
  .plan-preview[data-rows] {
    cursor: pointer;
  }
  .plan-preview[data-rows][data-select-text] {
    cursor: text;
  }
  /* The child rules are :global because {@html} content gets no Svelte scoping. */
  .plan-preview :global(:is(p, blockquote, ul, ol, table, pre, hr)) {
    margin-block: 0 1em;
  }
  .plan-preview :global(:is(h1, h2, h3, h4, h5, h6)) {
    margin-block: 1.5em 0.75em;
    line-height: var(--leading-tight);
  }
  .plan-preview > :global(:first-child > :is(h1, h2, h3, h4, h5, h6)) {
    margin-block-start: 0;
  }
  .plan-preview :global(:is(h1, h2)) {
    padding-block-end: 0.3em;
    border-block-end: 1px solid var(--rule-strong);
  }
  .plan-preview :global(h1) {
    font-size: calc(var(--text-xl) * var(--preview-scale));
    color: var(--markdown-heading1-color, var(--accent));
    font-weight: var(--markdown-heading1-font-weight, 600);
    font-style: var(--markdown-heading1-font-style);
    text-decoration: var(--markdown-heading1-text-decoration);
  }
  .plan-preview :global(h2) {
    font-size: calc(var(--text-lg) * var(--preview-scale));
    color: var(--markdown-heading2-color, var(--accent));
    font-weight: var(--markdown-heading2-font-weight, 600);
    font-style: var(--markdown-heading2-font-style);
    text-decoration: var(--markdown-heading2-text-decoration);
  }
  .plan-preview :global(h3) {
    font-size: calc(var(--text-md) * var(--preview-scale));
    color: var(--markdown-heading3-color, var(--accent));
    font-weight: var(--markdown-heading3-font-weight, 600);
    font-style: var(--markdown-heading3-font-style);
    text-decoration: var(--markdown-heading3-text-decoration);
  }
  .plan-preview :global(h4) {
    font-size: calc(var(--text-base) * var(--preview-scale));
    color: var(--markdown-heading4-color, var(--accent));
    font-weight: var(--markdown-heading4-font-weight, 600);
    font-style: var(--markdown-heading4-font-style);
    text-decoration: var(--markdown-heading4-text-decoration);
  }
  .plan-preview :global(h5) {
    font-size: calc(var(--text-sm) * var(--preview-scale));
    color: var(--markdown-heading5-color, var(--accent));
    font-weight: var(--markdown-heading5-font-weight, 600);
    font-style: var(--markdown-heading5-font-style);
    text-decoration: var(--markdown-heading5-text-decoration);
  }
  .plan-preview :global(h6) {
    font-size: calc(var(--text-xs) * var(--preview-scale));
    color: var(--markdown-heading6-color, var(--accent));
    font-weight: var(--markdown-heading6-font-weight, 600);
    font-style: var(--markdown-heading6-font-style);
    text-decoration: var(--markdown-heading6-text-decoration);
  }
  .plan-preview :global(strong) {
    font-weight: 700;
    color: var(--markdown-bold-color);
    font-style: var(--markdown-bold-font-style);
    text-decoration: var(--markdown-bold-text-decoration);
  }
  .plan-preview :global(em) {
    font-style: italic;
    color: var(--markdown-italic-color);
    font-weight: var(--markdown-italic-font-weight);
    text-decoration: var(--markdown-italic-text-decoration);
  }
  /* Padding, radius and tint pinned to coreStyles.ts's code chip by coreStyles.test.ts. */
  .plan-preview :global(:not(pre) > code) {
    font-family: var(--font-mono);
    font-size: 0.9em;
    padding: var(--chip-pad-block) var(--chip-pad-inline);
    border-radius: var(--radius);
    background-color: var(--chip-code);
    box-shadow: var(--chip-stamped);
    color: var(--markdown-code-color, var(--accent-bright));
    font-weight: var(--markdown-code-font-weight);
    font-style: var(--markdown-code-font-style);
    text-decoration: var(--markdown-code-text-decoration);
  }
  .plan-preview :global(a) {
    /* coreStyles.test.ts pins this to coreStyles.ts's link rule. */
    color: var(--markdown-link-color, color-mix(in lab, var(--ink), var(--accent) 45%));
    font-weight: var(--markdown-link-font-weight);
    font-style: var(--markdown-link-font-style);
    text-decoration: underline dotted;
    text-decoration-line: var(--markdown-link-text-decoration, underline);
    text-underline-offset: 0.22em;
  }
  /* A link whose label holds code, a reference or an image gives way to it: one range, one
     chip, pinned by coreStyles.test.ts. A label mixing code and prose drops the pill the
     source view nests the code in. */
  .plan-preview :global(a:not(:has(code, [data-file-ref], img))) {
    padding: var(--chip-pad-block) var(--chip-pad-inline);
    border-radius: var(--radius);
    background-color: var(--chip-link);
    box-shadow: var(--chip-raised);
  }
  .plan-preview :global(:is(ul, ol)) {
    padding-inline-start: 2em;
  }
  .plan-preview :global(:is(ul, ol) :is(ul, ol)) {
    margin-block: 0;
  }
  .plan-preview :global(ul) {
    list-style-type: disc;
  }
  .plan-preview :global(:is(ul, ol) ul) {
    list-style-type: circle;
  }
  .plan-preview :global(:is(ul, ol) :is(ul, ol) ul) {
    list-style-type: square;
  }
  .plan-preview :global(ol) {
    list-style-type: decimal;
  }
  .plan-preview :global(:is(ul, ol) ol) {
    list-style-type: lower-roman;
  }
  .plan-preview :global(:is(ul, ol) :is(ul, ol) ol) {
    list-style-type: lower-alpha;
  }
  .plan-preview :global(li + li) {
    margin-block-start: 0.25em;
  }
  .plan-preview :global(li::marker) {
    font-weight: var(--markdown-list-marker-font-weight);
    font-style: var(--markdown-list-marker-font-style);
  }
  .plan-preview :global(ul > li::marker) {
    color: var(--markdown-list-marker-color, var(--ink-soft));
  }
  .plan-preview :global(ol > li::marker) {
    color: var(--markdown-list-marker-color, var(--ink-faint));
  }
  .plan-preview :global(li:has(> input[data-task], > p > input[data-task])) {
    list-style-type: none;
  }
  /* A loose list wraps the item in <p>; the box hangs in the marker gutter the hidden
     bullet vacated. Drawn by hand so the only carrier of task state is on --ink-soft,
     not the UA's faint disabled greys; the three states differ by shape. */
  .plan-preview :global(input[data-task]) {
    appearance: none;
    display: inline-grid;
    place-content: center;
    inline-size: 0.9em;
    block-size: 0.9em;
    margin: 0 0.2em 0.25em -1.4em;
    border: 1.5px solid var(--ink-soft);
    border-radius: 3px;
    opacity: 1;
    vertical-align: middle;
  }
  .plan-preview :global(input[data-task]:is(:checked, :indeterminate)) {
    background: var(--ink-soft);
  }
  .plan-preview :global(input[data-task]:checked::after) {
    content: "";
    inline-size: 0.22em;
    block-size: 0.45em;
    margin-block-start: -0.1em;
    border: solid var(--paper);
    border-width: 0 2px 2px 0;
    rotate: 45deg;
  }
  .plan-preview :global(input[data-task]:indeterminate::after) {
    content: "";
    inline-size: 0.5em;
    block-size: 2px;
    background: var(--paper);
  }
  .plan-preview :global(blockquote) {
    padding-inline-start: 1em;
    border-inline-start: 0.25ch solid var(--ink-soft);
    color: var(--markdown-quote-color, var(--ink-soft));
    font-weight: var(--markdown-quote-font-weight);
    font-style: var(--markdown-quote-font-style);
    text-decoration: var(--markdown-quote-text-decoration);
  }
  .plan-preview :global(hr) {
    height: 1px;
    margin-block: 1.5em;
    border: 0;
    background: var(--ink-soft);
  }
  /* display: block lets a wide table scroll without a wrapper element. The source view's
     inlay: a bezel of --body carries the header on its top rail and the body cells sit in
     a pane sunk into it, inset by the bezel's padding. Separate borders, since a collapsed
     one stays behind a pinned header row as a see-through slit; no block-axis scroll,
     since that row can overhang the bottom by a rounding pixel. */
  .plan-preview :global(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    border-collapse: separate;
    border-spacing: 0;
    padding: 0 0.25rem 0.25rem;
    border-radius: var(--radius-lg);
    background-color: var(--body);
    box-shadow: var(--float-surface-low);
    font-variant-numeric: tabular-nums;
    view-timeline: --table block;
  }
  /* The header row stays at the top of the plan's view while its table's rows pass under
     it, above their bands. Not position: sticky, which would pin it inside the table, its
     nearest scroll container: the table crossing the view's top edge slides it down as far
     as the view scrolls, until --pin-travel (the script's measure) sets it on the last row. */
  .plan-preview :global(thead > tr) {
    position: relative;
    z-index: 1;
    animation-name: pin-header;
    animation-timing-function: linear;
    animation-fill-mode: both;
    animation-timeline: --table;
    animation-range: exit-crossing 0px exit-crossing var(--pin-travel, 0px);
  }
  /* Filled with the bezel from its first pixel pinned; clear at rest, so a band over the
     header's own row shows through. The fill reaches a pixel above the row, over the sliver
     a fractional view top leaves when the row's layer snaps to the pixel grid. */
  .plan-preview :global(th) {
    animation-name: pin-fill;
    animation-fill-mode: both;
    animation-timeline: --table;
    animation-range: exit-crossing 0px exit-crossing 1px;
  }
  @keyframes pin-header {
    to {
      translate: 0 var(--pin-travel, 0px);
    }
  }
  @keyframes pin-fill {
    to {
      background-color: var(--body);
      box-shadow: 0 -1px var(--body);
    }
  }
  /* A row reads along its cells' first lines, as a source row does. */
  .plan-preview :global(:is(th, td)) {
    padding: 0.375em 0.8em;
    vertical-align: baseline;
  }
  /* The pane's edges, composed per cell so each lands only on the sides facing out. The
     first row's sink is a gradient rather than the source view's blurred shadow: a blur
     fades at every cell's sides and notches the shade at each column boundary. */
  .plan-preview :global(td) {
    background-color: var(--table-floor);
    box-shadow:
      var(--pane-top-edge, 0 0 transparent),
      var(--pane-bottom-edge, 0 0 transparent),
      var(--pane-start-edge, 0 0 transparent),
      var(--pane-end-edge, 0 0 transparent);
  }
  .plan-preview :global(tbody > tr:first-child > td) {
    --pane-top-edge: inset 0 1px var(--table-pane-edge);
    background-image: linear-gradient(var(--table-pane-sink-shade), transparent 4px);
  }
  .plan-preview :global(tbody > tr:last-child > td) {
    --pane-bottom-edge: inset 0 -1px var(--table-pane-edge);
  }
  .plan-preview :global(td:first-child) {
    --pane-start-edge: inset 1px 0 var(--table-pane-edge);
  }
  .plan-preview :global(td:last-child) {
    --pane-end-edge: inset -1px 0 var(--table-pane-edge);
  }
  .plan-preview :global(tbody > tr:first-child > td:first-child) {
    border-start-start-radius: var(--radius);
  }
  .plan-preview :global(tbody > tr:first-child > td:last-child) {
    border-start-end-radius: var(--radius);
  }
  .plan-preview :global(tbody > tr:last-child > td:first-child) {
    border-end-start-radius: var(--radius);
  }
  .plan-preview :global(tbody > tr:last-child > td:last-child) {
    border-end-end-radius: var(--radius);
  }
  .plan-preview :global(tbody > tr + tr > td) {
    border-block-start: 1px solid var(--table-floor-rule);
  }
  /* The source view's header cap, pressed into the rail. A label never wraps, so a column
     is at least as wide as its header. */
  .plan-preview :global(th) {
    padding-block: 0.6em 0.5em;
    font-size: calc(var(--text-xs) * var(--preview-scale));
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--table-head-ink);
    text-shadow: var(--label-pressed);
  }
  /* Chromium's UA sheet centres a header cell; start it like a body cell. */
  .plan-preview :global(th:not([align])) {
    text-align: start;
  }
  .plan-preview :global(pre) {
    overflow-x: auto;
    overflow-wrap: normal;
  }
  /* Matches the source view's code panel fill. The inline-end padding keeps the
     top-right copy and wrap chrome off the code. */
  .plan-preview :global([data-source-code] + pre) {
    padding-block: 0.6rem;
    padding-inline: 2ch 4.5rem;
    border-radius: var(--radius);
    background-color: var(--code-panel);
    box-shadow: var(--panel-recess);
    font-family: var(--font-mono);
    font-size: 0.9em;
    line-height: var(--leading-relaxed);
  }
  .plan-preview :global([data-source-code] + pre > code) {
    font-family: inherit;
  }
  .plan-preview :global([data-source-code] + pre[data-code-reflow]) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .plan-preview :global(img) {
    max-width: 100%;
  }
  /* A resolved reference: coreStyles.ts's reference chip and glyph, pinned by
     coreStyles.test.ts. */
  .plan-preview :global([data-file-ref]) {
    cursor: pointer;
    padding: var(--chip-pad-block) var(--chip-pad-inline);
    border-radius: var(--radius);
    background-color: var(--chip-ref);
    box-shadow: var(--chip-raised);
  }
  .plan-preview :global([data-file-ref]::before) {
    content: "";
    display: inline-block;
    width: 0.85em;
    height: 0.85em;
    margin-right: 0.25em;
    vertical-align: -0.1em;
    background-color: var(--ink-faint);
    -webkit-mask: var(--file-ref-icon) no-repeat center / contain;
    mask: var(--file-ref-icon) no-repeat center / contain;
  }
  .plan-preview :global([data-file-ref="directory"]::before) {
    -webkit-mask: var(--folder-ref-icon) no-repeat center / contain;
    mask: var(--folder-ref-icon) no-repeat center / contain;
  }
  .plan-preview :global([data-file-ref]:hover) {
    background-color: var(--accent-wash);
  }
  .plan-preview :global([data-file-ref]:hover::before) {
    background-color: var(--ink);
  }
  /* A raised chip sinks into the line when pressed. */
  .plan-preview :global(:is([data-file-ref], code:has(> [data-file-ref])):active) {
    box-shadow: var(--chip-pressed);
  }
  .plan-preview :global(a:not(:has(code, [data-file-ref], img)):active) {
    box-shadow: var(--chip-pressed);
  }
  /* A backticked reference reads as one pill: the code chip takes the reference tint, the
     raise and the hover, and the reference inside it gives up its own box. */
  .plan-preview :global(code:has(> [data-file-ref])) {
    background-color: var(--chip-ref);
    box-shadow: var(--chip-raised);
  }
  .plan-preview :global(code:has(> [data-file-ref]:hover)) {
    background-color: var(--accent-wash);
  }
  .plan-preview :global(code > [data-file-ref]),
  .plan-preview :global(code > [data-file-ref]:hover) {
    padding: 0;
    background-color: transparent;
    box-shadow: none;
  }
</style>
