<script lang="ts">
  // A persistent, low-profile plan-review status strip: a viewport-pinned root
  // sibling of .shell (the VersionBadge pattern), reporting the live metadata of
  // the plan under review in the mono/tabular technical voice. It reads the same
  // pending-comment state RequestChangesDialog and the approve guard consume, so
  // it is the always-on answer to "how many comments am I about to send".
  //
  // It self-gates on `active`: absent when no review is up (EmptyState owns that
  // state), present otherwise. Connection state appears here once — distinct from
  // the daemon-replaced banner (daemon identity flipped) and VersionBadge (build
  // identity).
  let {
    active,
    pendingCount,
    coveredLines,
    version,
    connected,
  }: {
    active: boolean;
    pendingCount: number;
    coveredLines: number;
    version: number;
    connected: boolean;
  } = $props();

  // Only worth showing the lines tally once a line-anchored comment covers source
  // lines; a count of plain comments alone keeps the readout honest.
  let showCovered = $derived(pendingCount > 0 && coveredLines > 0);
</script>

{#if active}
  <aside class="status-strip metric" aria-label="Plan review status">
    <span class="stat">
      <span class="num" class:has={pendingCount > 0}>{pendingCount}</span>
      <span class="label">{pendingCount === 1 ? "comment" : "comments"}</span>
    </span>
    {#if showCovered}
      <span class="sep" aria-hidden="true">·</span>
      <span class="stat">
        <span class="num covered">{coveredLines}</span>
        <span class="label">{coveredLines === 1 ? "line" : "lines"}</span>
      </span>
    {/if}
    {#if version > 1}
      <span class="sep" aria-hidden="true">·</span>
      <span class="stat rev" title="Revision {version} of this plan">
        <span class="caret" aria-hidden="true">^</span>v{version}
      </span>
    {/if}
    <span class="sep" aria-hidden="true">·</span>
    <span
      class="conn"
      class:offline={!connected}
      title={connected ? "Connected to the caret daemon" : "Not connected to the caret daemon"}
    >
      <span class="dot" aria-hidden="true"></span>
      {connected ? "live" : "offline"}
    </span>
  </aside>
{/if}

<style>
  /* Viewport-pinned status strip. position: fixed makes DOM placement
     irrelevant — App renders it as a root sibling of .shell, never a grid child,
     so it never disturbs the shell's grid-template-rows or the fixed Toc rail's
     containing block. Sits bottom-right (the build VersionBadge owns bottom-left)
     so the two status affordances don't collide. z-index matches VersionBadge:
     above the Toc rail (30), below the modal scrim (100) and safe-mode toast
     (200). The mono family + tabular figures come from the .metric atom. */
  .status-strip {
    position: fixed;
    right: 0.7rem;
    bottom: 0.6rem;
    z-index: 40;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--text-2xs);
    letter-spacing: 0.02em;
    line-height: var(--leading-none);
    color: var(--ink-soft);
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: 99px;
    padding: 0.28rem 0.7rem;
    opacity: 0.78;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .status-strip:hover {
    opacity: 1;
    border-color: var(--rule-strong);
  }
  .stat {
    display: inline-flex;
    align-items: baseline;
    gap: 0.28rem;
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
  .sep {
    color: var(--rule-strong);
  }
  /* Revision pill vocabulary mirrors VersionLabel's ^vN: amber, the brand caret. */
  .rev {
    color: var(--accent);
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .rev .caret {
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
