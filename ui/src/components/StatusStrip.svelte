<script lang="ts">
  // A low-profile plan-review status readout: a flat row of segments in the bottom
  // status bar (EXC-787). In the single-version view its tally reads the same
  // pending-comment state RequestChangesDialog and the approve guard consume — the
  // always-on answer to "how many comments am I about to send". While comparing
  // versions the host points it at the compared range's comments instead (EXC-872),
  // because the tally is the comment panel's toggle and the two must agree; the
  // approve guard's own count is unaffected either way.
  //
  // It self-gates on `active`: absent when no review is up (EmptyState owns that
  // state). Connection state appears here once — distinct from the daemon-replaced
  // banner (daemon identity flipped) and VersionBadge (build identity).
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

  // A count of plain comments covers no source lines, so the lines tally would
  // read zero beside a non-zero comment count.
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
          <!-- Both caps typed, so the shift glyph is the shared icon, never a ⇧ char. -->
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
              <!-- The same chip the TopBar VersionLabel shows. Only the ^ carries
                   amber, holding amber-scarcity. -->
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
  /* The mono family and tabular figures come from the .metric atom. */
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
  /* A real button, stripped back to the strip's inline text. align-items overrides
     .stat's baseline: this tally alone carries the taller Shift+C cap, which on a
     baseline row drags the shared baseline down and sinks "N comments" ~1px below
     the strip's other segments. */
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
  /* Lifts the C off .kbd-sm's 0.68em so it meets the shift icon at closer to one
     scale. :global because it rides the Kbd root, which carries no scope hash. */
  .status-strip :global(.comments-key) {
    font-size: 0.9em;
  }
  .num {
    font-weight: 600;
    color: var(--ink-faint);
  }
  /* --attention, the hue the TopBar's pending badge and the compare picker's version
     count already wear, so all three counts read as one family; --ok stays reserved
     for the semantic pair below (connection state). Mixed locally rather than
     tokenised because only the pair together carries the two-step "pending reads
     louder than covered" ramp. */
  .num.has {
    color: color-mix(in srgb, var(--attention) 80%, var(--ink));
  }
  .num.covered {
    color: color-mix(in srgb, var(--attention) 60%, var(--ink));
  }
  .label {
    color: var(--ink-soft);
  }
  /* :global because the Badge is a child component and its class carries no scope
     hash. Tightens the shadcn default down to the dense strip's scale. */
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
