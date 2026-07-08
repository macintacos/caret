<script lang="ts">
  // A fenced code block in the rendered plan view (EXC-693). Renders escaped
  // plain code immediately, then swaps in caret-themed shiki HTML once the
  // grammar resolves — the same colors the source view uses (codeHighlight.ts).
  // The fences themselves are dropped: this reads as an actual code block, not
  // decorated source.
  import { highlightCode, plainCodeHtml } from "../lib/codeHighlight.ts";

  interface Props {
    lang: string | null;
    text: string;
    /** Source line of the first code line (the line after the opening fence), so
     * each rendered line carries its true `data-line` for per-line commenting. */
    firstLine: number;
  }
  let { lang, text, firstLine }: Props = $props();

  // Escaped plain code paints first (no flash of unstyled/blank); the async shiki
  // result replaces it when ready. `html` derives from the highlight when present
  // and falls back to plain code otherwise, so a code/language change (which resets
  // the highlight to null) immediately re-shows the new plain code while the grammar
  // reloads. The cancelled guard drops a late resolve after an unmount or swap.
  let highlighted = $state<string | null>(null);
  const html = $derived(highlighted ?? plainCodeHtml(text, firstLine));
  $effect(() => {
    const code = text;
    const language = lang;
    const first = firstLine;
    highlighted = null;
    let cancelled = false;
    void highlightCode(code, language, first).then((result) => {
      if (!cancelled) highlighted = result;
    });
    return () => {
      cancelled = true;
    };
  });
</script>

<!-- The one {@html} sink not routed through filterXSS, and safe by construction:
     both plainCodeHtml and shiki's codeToHtml HTML-escape the code text, so no
     plan-controlled markup reaches the DOM. filterXSS is deliberately NOT applied
     — it would strip shiki's inline --shiki-* style vars and break theming. -->
<div class="md-code-panel">{@html html}</div>

<style>
  .md-code-panel {
    background: var(--paper-sunk);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    overflow-x: auto;
    margin: 0.35rem 0;
  }
  /* shiki (and the plain fallback) emit a <pre class="shiki">; strip its own
     surface — the panel provides it — and give it caret's mono type. */
  .md-code-panel :global(pre) {
    margin: 0;
    padding: 0.6rem 0.85rem;
    background: transparent;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.55;
  }
  /* Dual-theme shiki: each token carries --shiki-light / --shiki-dark; select
     per system scheme, matching how caret flips its own tokens. */
  .md-code-panel :global(pre.shiki),
  .md-code-panel :global(pre.shiki span) {
    color: var(--shiki-light);
  }
  @media (prefers-color-scheme: dark) {
    .md-code-panel :global(pre.shiki),
    .md-code-panel :global(pre.shiki span) {
      color: var(--shiki-dark);
    }
  }
  /* The plain fallback (unknown/failed grammar): neutral monospace, no tokens. */
  .md-code-panel :global(pre.md-code-plain),
  .md-code-panel :global(pre.md-code-plain code) {
    color: var(--ink);
  }
</style>
