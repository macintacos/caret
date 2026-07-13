<script lang="ts">
  // Shows e.g. "v2" once a plan has been revised. No diff UI (out of scope).
  // EXC-760: composed from the shadcn Badge. A soft, borderless solid fill — a
  // subtle tonal lift above the topbar surface (paper-raised nudged toward ink)
  // so it reads as a chip floating just over the background rather than a
  // hard-bordered pill; ink-soft text keeps it quiet. The ^ brand glyph keeps
  // caret amber — one of the sanctioned amber spots alongside the wordmark and
  // the primary action (doc/agents/shadcn-rules.md).
  import { Badge } from "$lib/components/ui/badge/index.js";

  let { version }: { version: number } = $props();
</script>

{#if version > 1}
  <Badge
    variant="secondary"
    class="version metric"
    style="background: color-mix(in lab, var(--paper-raised), var(--ink) 9%); color: var(--ink-soft)"
    title="Revision {version} of this plan"
  >
    <span class="caret" aria-hidden="true">^</span>v{version}
  </Badge>
{/if}

<style>
  /* The ^ is the caret brand glyph, so it carries the amber accent; the badge
     chrome around it stays neutral (the outline variant). */
  .caret {
    color: var(--accent);
    font-weight: 700;
    transform: translateY(1px);
  }
</style>
