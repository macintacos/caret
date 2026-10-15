<script lang="ts">
  // The plan preview: mounts renderPlanMarkdown's HTML as-is in one container, so its
  // div[data-source-start][data-source-end] blocks stay direct children for the
  // source-mapped features to find. DiffPlanView decides which text and when; this only
  // mounts it, sets what HTML cannot carry, and styles it; it highlights its code blocks
  // after the plain block mounts, and marks the soft-wrapped ones.
  import { highlightTokens } from "$lib/diffview/highlight.ts";
  import { applyPreviewReflow, highlightPreviewCode } from "$lib/previewCode.ts";
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
    /** The element whose content is exactly the rendered HTML — what createPlanSourceMap
     * and the chrome geometry walk. Bindable, and cleared on unmount, unlike an onReady
     * handle. */
    root?: HTMLDivElement;
  }
  let {
    html,
    codeLanguages = new Map(),
    themeId,
    reflowedBlocks = new Set(),
    root = $bindable(),
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
      tokenize: (c, l) => highlightTokens(c, l, theme),
      nextTask: () => new Promise((resolve) => setTimeout(resolve, 0)),
      signal: controller.signal,
    });
    return () => controller.abort();
  });

  $effect(() => {
    void html;
    if (root) applyPreviewReflow(root, reflowedBlocks);
  });
</script>

<div class="plan-preview" bind:this={root} onerrorcapture={hideFailedImage}>{@html html}</div>

<style>
  .plan-preview {
    padding-block: 0.5rem;
    padding-inline: 2ch 0.75rem;
    font-size: var(--text-base);
    overflow-wrap: break-word;
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
    font-size: var(--text-xl);
    color: var(--markdown-heading1-color, var(--accent));
    font-weight: var(--markdown-heading1-font-weight, 600);
    font-style: var(--markdown-heading1-font-style);
    text-decoration: var(--markdown-heading1-text-decoration);
  }
  .plan-preview :global(h2) {
    font-size: var(--text-lg);
    color: var(--markdown-heading2-color, var(--accent));
    font-weight: var(--markdown-heading2-font-weight, 600);
    font-style: var(--markdown-heading2-font-style);
    text-decoration: var(--markdown-heading2-text-decoration);
  }
  .plan-preview :global(h3) {
    font-size: var(--text-md);
    color: var(--markdown-heading3-color, var(--accent));
    font-weight: var(--markdown-heading3-font-weight, 600);
    font-style: var(--markdown-heading3-font-style);
    text-decoration: var(--markdown-heading3-text-decoration);
  }
  .plan-preview :global(h4) {
    font-size: var(--text-base);
    color: var(--markdown-heading4-color, var(--accent));
    font-weight: var(--markdown-heading4-font-weight, 600);
    font-style: var(--markdown-heading4-font-style);
    text-decoration: var(--markdown-heading4-text-decoration);
  }
  .plan-preview :global(h5) {
    font-size: var(--text-sm);
    color: var(--markdown-heading5-color, var(--accent));
    font-weight: var(--markdown-heading5-font-weight, 600);
    font-style: var(--markdown-heading5-font-style);
    text-decoration: var(--markdown-heading5-text-decoration);
  }
  .plan-preview :global(h6) {
    font-size: var(--text-xs);
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
  .plan-preview :global(:not(pre) > code) {
    font-family: var(--font-mono);
    padding: 0.2em 0.4em;
    border-radius: var(--radius);
    background: var(--chip-code);
    color: var(--markdown-code-color, var(--accent-bright));
    font-weight: var(--markdown-code-font-weight);
    font-style: var(--markdown-code-font-style);
    text-decoration: var(--markdown-code-text-decoration);
  }
  .plan-preview :global(a) {
    /* Mirrors coreStyles.ts's link rule; keep in sync. */
    color: var(--markdown-link-color, color-mix(in lab, var(--ink), var(--accent) 45%));
    font-weight: var(--markdown-link-font-weight);
    font-style: var(--markdown-link-font-style);
    text-decoration: underline dotted;
    text-decoration-line: var(--markdown-link-text-decoration, underline);
    text-underline-offset: 0.22em;
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
  /* display: block lets a wide table scroll without a wrapper element. */
  .plan-preview :global(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow: auto;
    border-collapse: collapse;
  }
  .plan-preview :global(:is(th, td)) {
    padding: 0.375em 0.8em;
    border: 1px solid var(--rule-strong);
  }
  .plan-preview :global(th) {
    font-weight: 600;
  }
  /* Chromium's UA sheet centres a header cell; start it like a body cell. */
  .plan-preview :global(th:not([align])) {
    text-align: start;
  }
  .plan-preview :global(pre) {
    overflow-x: auto;
    overflow-wrap: normal;
  }
  .plan-preview :global(img) {
    max-width: 100%;
  }
  /* The source view's code panel fill. The inline-end padding keeps the top-right copy
     and wrap chrome off the code. */
  .plan-preview :global([data-source-code] + pre) {
    padding-block: 0.6rem;
    padding-inline: 2ch 4.5rem;
    border-radius: var(--radius);
    background-color: var(--code-panel);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
  }
  .plan-preview :global([data-source-code] + pre > code) {
    font-family: inherit;
  }
  .plan-preview :global(pre[data-code-reflow]) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
