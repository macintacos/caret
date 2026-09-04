<script lang="ts">
  // Shows e.g. "v2" once a plan has been revised. The ^ brand glyph keeps caret
  // amber — one of the sanctioned amber spots alongside the wordmark and the primary
  // action (doc/agents/shadcn-rules.md § amber-scarcity).
  import { Badge } from "$lib/components/ui/badge/index.js";

  let { version }: { version: number } = $props();
</script>

{#if version > 1}
  <Badge
    variant="secondary"
    class="version metric float-chip"
    style="color: var(--ink-soft)"
    title="Revision {version} of this plan"
  >
    <span class="caret" aria-hidden="true">^</span>v{version}
  </Badge>
{/if}

<style>
  /* The ^ is the caret brand glyph, so it carries the amber accent; the badge
     chrome around it stays neutral. */
  .caret {
    color: var(--accent);
    font-weight: 700;
    transform: translateY(1px);
  }
</style>
