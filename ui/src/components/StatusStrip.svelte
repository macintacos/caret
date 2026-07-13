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
  //
  // EXC-763: rebuilt on shadcn primitives — the metric dividers are vertical
  // Separators (the TopBar cluster's divider), the ^vN revision is a Badge
  // reusing VersionLabel's amber-^ idiom, and the revision + connection carry
  // their hover hints on shadcn Tooltips (replacing native title=), matching the
  // TopBar cwd tooltip. The strip stays a quiet pinned pill: content-floating
  // chrome recedes until looked at, so it keeps its own hairline surface rather
  // than the topbar's louder .float-chip fill.
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";

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
    <Tooltip.Provider delayDuration={0}>
      <span class="stat">
        <span class="num" class:has={pendingCount > 0}>{pendingCount}</span>
        <span class="label">{pendingCount === 1 ? "comment" : "comments"}</span>
      </span>
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
