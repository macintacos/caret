<script lang="ts">
  // A persistent, low-profile plan-review status readout: a flat row of segments
  // in the bottom status bar (EXC-787), reporting the live metadata of
  // the plan under review in the mono/tabular technical voice. It reads the same
  // pending-comment state RequestChangesDialog and the approve guard consume, so
  // it is the always-on answer to "how many comments am I about to send".
  //
  // It self-gates on `active`: absent when no review is up (EmptyState owns that
  // state), present otherwise. Connection state appears here once — distinct from
  // the daemon-replaced banner (daemon identity flipped) and VersionBadge (build
  // identity).
  //
  // EXC-763: rebuilt on shadcn primitives — the metric dividers are vertical
  // Separators (the TopBar cluster's divider), the ^vN revision is a Badge
  // reusing VersionLabel's amber-^ idiom, and the revision + connection carry
  // their hover hints on shadcn Tooltips (replacing native title=), matching the
  // TopBar cwd tooltip. The readout stays quiet flat segments in the status bar,
  // receding until looked at, rather than the topbar's louder .float-chip fill.
  //
  // EXC-787: moved into the full-width status bar, so EXC-812's corner
  // de-collision (the strip yielding to the navigator) is gone — the navigator
  // now docks above the bar rather than sharing the bottom-right corner.
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";
  import KbdCap from "@/components/KbdCap.svelte";

  let {
    active,
    pendingCount,
    coveredLines,
    version,
    connected,
    commentsOpen = false,
    onToggleComments,
    showShortcutHints = false,
  }: {
    active: boolean;
    pendingCount: number;
    coveredLines: number;
    version: number;
    connected: boolean;
    /** Whether the comment navigator is open — drives the tally button's aria-expanded. */
    commentsOpen?: boolean;
    /** Toggle the comment navigator. The comment tally is its trigger. */
    onToggleComments?: () => void;
    /** Whether the Shift+C shortcut-hint cap is shown on the tally (EXC-826/EXC-792). */
    showShortcutHints?: boolean;
  } = $props();

  // Only worth showing the lines tally once a line-anchored comment covers source
  // lines; a count of plain comments alone keeps the readout honest.
  let showCovered = $derived(pendingCount > 0 && coveredLines > 0);
</script>

{#if active}
  <aside class="status-strip metric" aria-label="Plan review status">
    <Tooltip.Provider delayDuration={0}>
      <!-- The comment tally is the trigger for the comment navigator, so it is a
           real toggle button (aria-expanded) rather than an inert readout. -->
      <button
        type="button"
        class="stat comments-toggle"
        aria-expanded={commentsOpen}
        aria-controls="comment-navigator"
        aria-keyshortcuts={ariaKeyshortcutsFor("actions.toggleComments")}
        onclick={onToggleComments}
      >
        <span class="num" class:has={pendingCount > 0}>{pendingCount}</span>
        <span class="label">{pendingCount === 1 ? "comment" : "comments"}</span>
        {#if showShortcutHints}
          <!-- One combined key: the global shift icon then C, both typed KbdCaps
               (see caps.ts) so the shift glyph is the shared icon, never a ⇧ char. -->
          <Kbd class="comments-key kbd-sm" aria-hidden="true"
            ><KbdCap key="shift" size={8} /><KbdCap key="C" /></Kbd
          >
        {/if}
      </button>
      {#if showCovered}
        <Separator orientation="vertical" decorative style="height: 0.9em; min-height: 0" />
        <span class="stat">
          <span class="num covered">{coveredLines}</span>
          <span class="label">{coveredLines === 1 ? "line" : "lines"}</span>
        </span>
      {/if}
      {#if version > 1}
        <Separator orientation="vertical" decorative style="height: 0.9em; min-height: 0" />
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <!-- The ^vN revision marker: a Badge, so it reads as the same chip
                   the TopBar VersionLabel shows. Only the ^ carries amber
                   (brand); the rest stays ink-soft, holding amber-scarcity. -->
              <Badge {...props} variant="secondary" class="rev metric">
                <span class="caret" aria-hidden="true">^</span>v{version}
              </Badge>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Revision {version} of this plan</Tooltip.Content>
        </Tooltip.Root>
      {/if}
      <Separator orientation="vertical" style="height: 0.9em; min-height: 0" />
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <span {...props} class="conn" class:offline={!connected}>
              <span class="dot" aria-hidden="true"></span>
              {connected ? "live" : "offline"}
            </span>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>
          {connected ? "Connected to the caret daemon" : "Not connected to the caret daemon"}
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  </aside>
{/if}

<style>
  /* A flat, low-profile row of status-bar segments (EXC-787). StatusBar lays it
     out; it no longer self-pins. The mono family + tabular figures come from the
     .metric atom. */
  .status-strip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--text-2xs);
    letter-spacing: 0.02em;
    line-height: var(--leading-none);
    color: var(--ink-soft);
  }
  .stat {
    display: inline-flex;
    align-items: baseline;
    gap: 0.28rem;
  }
  /* The comment tally doubles as the navigator's trigger, so it is a real button;
     strip the native chrome back to the strip's inline text and add a quiet
     underline-on-hover + focus ring so it reads as activatable without shouting.
     align-items overrides .stat's baseline: this tally alone carries the taller
     Shift+C key cap, and on a baseline row that cap drags the shared baseline
     down, sinking "N comments" ~1px below the strip's other segments. Centering
     the row keeps the count level with them — and, at these sizes, lands the C on
     the count's baseline too (verified in-browser), so it reads as one line. */
  .comments-toggle {
    align-items: center;
    margin: 0;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    letter-spacing: inherit;
    color: inherit;
    cursor: pointer;
    border-radius: var(--radius);
  }
  .comments-toggle:hover .label,
  .comments-toggle[aria-expanded="true"] .label {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .comments-toggle:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  /* The Shift+C summon-key cap on the tally (EXC-792): the font-size lifts the C
     off .kbd-sm's tiny 0.68em so it meets the shift icon (KbdCap size) closer to
     one scale. Vertical placement is the toggle's align-items: center (above), so
     the cap needs no align-self of its own. Rides the Kbd root (no scope hash →
     :global, bounded under the scoped strip). */
  .status-strip :global(.comments-key) {
    font-size: 0.9em;
  }
  .num {
    font-weight: 600;
    color: var(--ink-faint);
  }
  /* A non-zero pending tally is the metric the reviewer is tracking — lift it to
     the semantic add color so a populated strip reads at a glance. */
  .num.has {
    color: color-mix(in srgb, var(--ok) 80%, var(--ink));
  }
  .num.covered {
    color: color-mix(in srgb, var(--ok) 60%, var(--ink));
  }
  .label {
    color: var(--ink-soft);
  }
  /* The revision Badge is a child component, so its own class carries no scope
     hash — reach it with :global, bounded under the scoped .status-strip. Tightens
     the shadcn Badge's default padding/size down to the dense strip's scale and
     tones the pill neutral (the ^ caret keeps the amber below). */
  .status-strip :global(.rev) {
    gap: 0.05rem;
    padding: 0.04rem 0.32rem;
    font-size: var(--text-2xs);
    letter-spacing: 0.04em;
    color: var(--ink-soft);
  }
  /* Revision pill vocabulary mirrors VersionLabel's ^vN: the ^ is the caret brand
     glyph, so it carries the amber accent; the rest of the chip stays neutral. */
  .caret {
    color: var(--accent);
    font-weight: 700;
  }
  .conn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--ink-soft);
  }
  .dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 99px;
    background: var(--ok);
  }
  .conn.offline {
    color: var(--danger);
  }
  .conn.offline .dot {
    background: var(--danger);
  }
</style>
