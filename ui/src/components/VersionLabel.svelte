<script lang="ts">
  // Shows e.g. "v2" once a plan has been revised. No diff UI (out of scope).
  // EXC-760: composed from the shadcn Badge (neutral `outline` variant). The ^
  // brand glyph keeps caret amber — one of the sanctioned amber spots alongside
  // the wordmark and the primary action (doc/agents/shadcn-rules.md).
  import { Badge } from "$lib/components/ui/badge/index.js";

  let { version }: { version: number } = $props();
</script>

{#if version > 1}
  <Badge variant="outline" class="version metric" title="Revision {version} of this plan">
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
