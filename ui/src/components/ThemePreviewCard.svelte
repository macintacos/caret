<script lang="ts">
  // An abstract, redacted preview of Caret's own chrome, tinted by a candidate theme
  // (EXC-753). Shown beside the Theme dropdown as the reviewer hovers an option, so a
  // palette can be seen ON Caret's layout before it is selected. The mock is a generic
  // (unfocused) macOS window around a miniature Caret shell — a topbar strip, a left
  // rail with one selected row, and a plan pane of skeleton bars — never real
  // plan/diff content, so there is no PII to leak. It is styled ENTIRELY from the
  // passed token map, applied as inline custom properties on this card's root only
  // (use:applyTokens), so descendants reading var(--paper)/var(--ink)/… paint in the
  // hovered palette while :root is untouched: hovering never retints the real app.
  // The single --accent appears exactly once — the selected rail row (caret's "amber
  // marks the selection" language) — keeping the primary scarce.
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";

  interface Props {
    /** The hovered theme's token map (THEMES[id].tokens): CSS custom property → value.
     * Applied inline on the root so the whole mock paints in this palette. */
    tokens: Record<string, string>;
    /** The theme's display name — the window title and the card's accessible name. */
    label: string;
  }
  let { tokens, label }: Props = $props();

  // Apply the palette as inline custom properties on the card root. An action (not a
  // style string) so arbitrary token keys land via setProperty — robust in happy-dom
  // and the browser alike — and re-apply if the hovered option's tokens change.
  function applyTokens(node: HTMLElement, t: Record<string, string>) {
    const set = (next: Record<string, string>) => {
      for (const [name, value] of Object.entries(next)) node.style.setProperty(name, value);
    };
    set(t);
    return { update: set };
  }
</script>

<div
  class="theme-preview"
  data-slot="theme-preview"
  use:applyTokens={tokens}
  role="img"
  aria-label={`${label} theme preview`}
>
  <div class="tp-window">
    <div class="tp-titlebar">
      <span class="tp-dots" aria-hidden="true">
        <span class="tp-dot"></span>
        <span class="tp-dot"></span>
        <span class="tp-dot"></span>
      </span>
      <span class="tp-title">{label}</span>
    </div>

    <!-- Caret's topbar strip: neutral chips + a small notification dot (--attention). -->
    <div class="tp-appbar" aria-hidden="true">
      <Skeleton class="tp-chip" />
      <Skeleton class="tp-chip tp-chip-wide" />
      <span class="tp-appbar-spacer"></span>
      <span class="tp-notif"></span>
      <Skeleton class="tp-chip tp-chip-dot" />
    </div>

    <div class="tp-main" aria-hidden="true">
      <!-- Left rail: one row is the current selection — the sole --accent on the card. -->
      <div class="tp-sidebar">
        <div class="tp-row"></div>
        <div class="tp-row tp-row-selected" data-tp-accent></div>
        <div class="tp-row"></div>
        <div class="tp-row"></div>
      </div>

      <!-- Plan pane as a redacted diff: prose bars plus added (--ok) and removed
           (--danger) lines, so the mock samples more of the palette than the accent. -->
      <div class="tp-plan">
        <Skeleton class="tp-bar tp-bar-title" />
        <Skeleton class="tp-bar" />
        <div class="tp-line tp-add" data-tp-diff="add"><Skeleton class="tp-bar tp-bar-mid" /></div>
        <div class="tp-line tp-add" data-tp-diff="add"><Skeleton class="tp-bar" /></div>
        <div class="tp-line tp-del" data-tp-diff="del"><Skeleton class="tp-bar tp-bar-short" /></div>
        <Skeleton class="tp-bar" />
      </div>
    </div>
  </div>
</div>

<style>
  /* The card fits its window; SettingSelect positions it (fixed) beside the open menu.
     One subtle reveal on mount, timed off the shared motion tokens — the global
     reduced-motion rule reaches it via the [data-slot] anchor even when portalled. */
  .theme-preview {
    width: max-content;
    animation: tp-in var(--dur-base) var(--ease-out);
  }

  .tp-window {
    width: 258px;
    overflow: hidden;
    border-radius: var(--radius-lg);
    border: 1px solid var(--rule);
    background: var(--paper-raised);
    box-shadow: var(--shadow-card);
  }

  /* Generic (unfocused) macOS titlebar: neutral grey dots, a faint centered title. */
  .tp-titlebar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
    background: color-mix(in srgb, var(--paper-raised), var(--ink) 5%);
    border-bottom: 1px solid var(--rule);
  }
  .tp-dots {
    display: flex;
    gap: 5px;
    flex: none;
  }
  .tp-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--ink-faint), transparent 45%);
  }
  .tp-title {
    flex: 1 1 auto;
    min-width: 0;
    text-align: center;
    /* Nudge left so the dots don't shove the title off-center. */
    margin-right: 1.9rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--text-2xs);
    color: var(--ink-faint);
  }

  /* Topbar strip. */
  .tp-appbar {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0.35rem 0.5rem;
    background: var(--paper);
    border-bottom: 1px solid var(--rule);
  }
  .tp-appbar-spacer {
    flex: 1 1 auto;
  }
  /* A small notification indicator — the violet --attention hue. */
  .tp-notif {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--attention);
  }
  /* Neutral redacted chips — override the vendored Skeleton's --muted fill with an
     ink-derived tone so the placeholders read as content, not empty slots. */
  :global(.theme-preview .tp-chip) {
    height: 8px;
    width: 26px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink), transparent 88%);
  }
  :global(.theme-preview .tp-chip-wide) {
    width: 40px;
  }
  :global(.theme-preview .tp-chip-dot) {
    width: 8px;
  }

  .tp-main {
    display: grid;
    grid-template-columns: 62px 1fr;
    min-height: 108px;
  }

  .tp-sidebar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0.5rem 0.4rem;
    background: var(--paper);
    border-right: 1px solid var(--rule);
  }
  .tp-row {
    height: 9px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--ink), transparent 90%);
  }
  /* The one selection: an amber wash + rail, caret's "amber marks the selection"
     language. This is the single --accent on the whole card. */
  .tp-row-selected {
    background: var(--accent-wash);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .tp-plan {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 0.6rem;
    background: var(--paper-raised);
  }
  :global(.theme-preview .tp-bar) {
    height: 7px;
    width: 100%;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--ink), transparent 86%);
  }
  /* A stronger, shorter first bar reads as a heading. */
  :global(.theme-preview .tp-bar-title) {
    height: 9px;
    width: 55%;
    background: color-mix(in srgb, var(--ink), transparent 74%);
  }
  :global(.theme-preview .tp-bar-short) {
    width: 40%;
  }
  :global(.theme-preview .tp-bar-mid) {
    width: 70%;
  }

  /* Diff lines: an added line rides a green --ok wash + gutter, a removed line a red
     --danger one — Caret's own +/- semantics, sampling two more palette hues. The
     tint bleeds a touch wider than the bar via the negative margin. */
  .tp-line {
    position: relative;
    padding: 1px 4px 1px 9px;
    margin: 0 -4px;
    border-radius: 3px;
  }
  .tp-line::before {
    content: "";
    position: absolute;
    left: 3px;
    top: 50%;
    transform: translateY(-50%);
    width: 2px;
    height: 9px;
    border-radius: 1px;
  }
  .tp-add {
    background: color-mix(in srgb, var(--ok), transparent 85%);
  }
  .tp-add::before {
    background: var(--ok);
  }
  .tp-del {
    background: color-mix(in srgb, var(--danger), transparent 85%);
  }
  .tp-del::before {
    background: var(--danger);
  }

  @keyframes tp-in {
    from {
      opacity: 0;
      transform: scale(0.97) translateY(2px);
    }
  }
</style>
