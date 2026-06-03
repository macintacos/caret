<script lang="ts">
  import type { Snippet } from "svelte";

  // Shared hover/focus-expand rail, extracted from the TOC (EXC-355). A slim strip
  // pinned to a viewport edge; hovering it — or focusing into it, or forcing it
  // open — slides a panel out. Reveal is pure CSS with a leave-delay so a quick
  // re-entry over the invisible hover bridge doesn't flicker. Consumers supply the
  // collapsed `strip` and the expand-on-hover `panel`; the TOC (left / center /
  // hover-only) and the annotation rail (right / full-height / pin + tap) differ
  // only in side, placement, touch handling, and whether they force the panel open.
  interface Props {
    side?: "left" | "right";
    placement?: "center" | "fill";
    label: string;
    /** No-hover devices: "hide" removes the rail (it can't be opened without
        hover); "tap" keeps it — the consumer supplies a tap target in `strip`
        and drives `forceOpen`. */
    touch?: "hide" | "tap";
    /** Keep the panel open regardless of hover (pin / tap-open). */
    forceOpen?: boolean;
    strip: Snippet;
    panel: Snippet;
  }
  let {
    side = "left",
    placement = "center",
    label,
    touch = "hide",
    forceOpen = false,
    strip,
    panel,
  }: Props = $props();
</script>

<nav
  class="rail side-{side} place-{placement}"
  class:touch-hide={touch === "hide"}
  class:is-open={forceOpen}
  aria-label={label}
>
  <div class="strip">{@render strip()}</div>
  <div class="panel">{@render panel()}</div>
</nav>

<style>
  /* Fixed and viewport-pinned, decoupled from the .columns grid so it escapes
     that grid's overflow:hidden. Positioned to the viewport because no ancestor
     (.shell / #app / body) establishes a containing block — see the transform
     warning in app.css. */
  .rail {
    position: fixed;
    z-index: 30;
  }

  /* ----- Edge + invisible hover bridge -----
     The bridge padding lets the pointer travel strip → panel without crossing
     dead space, so :hover never drops mid-traverse. */
  .side-left {
    left: clamp(0.5rem, 1.5vw, 1.25rem);
    padding: 0.5rem 1rem 0.5rem 0;
  }
  .side-right {
    right: clamp(0.5rem, 1.5vw, 1.25rem);
    padding: 0.5rem 0 0.5rem 1rem;
  }

  /* ----- Vertical placement ----- */
  .place-center {
    top: 50%;
    transform: translateY(-50%);
  }
  .place-fill {
    top: var(--rail-top, 0);
    bottom: 0;
    display: flex;
    flex-direction: column;
  }
  .place-fill.side-right {
    align-items: flex-end;
  }
  .place-fill .strip {
    flex: 1 1 auto;
    min-height: 0;
  }

  /* ----- Panel: collapsed by default, revealed on hover / focus / force ----- */
  .panel {
    position: absolute;
    width: var(--rail-panel-w, 14rem);
    padding: 0.85rem 1rem 0.95rem;
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    /* Collapsed: transparent and mouse-inert, but kept in the tab order — NOT
       visibility:hidden, which would make focusable children unreachable so a
       keyboard Tab could never trip :focus-within. The instant a child receives
       focus the reveal rule below shows the panel; nothing is stranded behind
       opacity:0. */
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 0.22s ease,
      transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    /* Leave-delay: the collapse (this base state) waits 0.12s before starting, so
       a quick re-entry over the hover bridge doesn't flicker. The reveal rule
       zeroes the delay, so opening is instant. */
    transition-delay: 0.12s;
  }
  .place-center .panel {
    top: 50%;
    max-height: 74vh;
    overflow-y: auto;
  }
  .place-fill .panel {
    top: 0;
    bottom: 0;
    overflow-y: auto;
  }
  .side-left .panel {
    left: 100%;
  }
  .side-right .panel {
    right: 100%;
  }

  /* Collapsed transforms — a slight slide toward the edge, per placement/side. */
  .place-center.side-left .panel {
    transform: translateY(-50%) translateX(-0.5rem);
  }
  .place-center.side-right .panel {
    transform: translateY(-50%) translateX(0.5rem);
  }
  .place-fill.side-left .panel {
    transform: translateX(-0.5rem);
  }
  .place-fill.side-right .panel {
    transform: translateX(0.5rem);
  }

  /* Revealed: opacity + slide settle, instantly (no leave-delay). */
  .rail:hover .panel,
  .rail:focus-within .panel,
  .rail.is-open .panel {
    opacity: 1;
    pointer-events: auto;
    transition-delay: 0s;
  }
  .place-center:hover .panel,
  .place-center:focus-within .panel,
  .place-center.is-open .panel {
    transform: translateY(-50%) translateX(0);
  }
  .place-fill:hover .panel,
  .place-fill:focus-within .panel,
  .place-fill.is-open .panel {
    transform: translateX(0);
  }

  /* ----- Reduced motion: reveal without animation or slide. ----- */
  @media (prefers-reduced-motion: reduce) {
    .panel,
    .rail:hover .panel,
    .rail:focus-within .panel,
    .rail.is-open .panel {
      transition: none;
    }
    .place-center .panel,
    .place-center:hover .panel,
    .place-center:focus-within .panel,
    .place-center.is-open .panel {
      transform: translateY(-50%);
    }
    .place-fill .panel,
    .place-fill:hover .panel,
    .place-fill:focus-within .panel,
    .place-fill.is-open .panel {
      transform: none;
    }
  }

  /* ----- Pure touch / no-hover devices: hide a rail that can't be opened without
     hover (the TOC). Rails that supply their own tap target use touch="tap" and
     stay put. ----- */
  @media (hover: none), (pointer: coarse) {
    .rail.touch-hide {
      display: none;
    }
  }
</style>
