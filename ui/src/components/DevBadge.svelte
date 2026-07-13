<script lang="ts">
  // EXC-556: a "local build" pill shown when the daemon runs from source
  // (mise run dev / the e2e harness / a manual `bun src/cli.ts`) rather than a
  // compiled release, so a dev build is never mistaken for a real review. Driven
  // by /api/health's isDev flag; self-gates so callers pass it unconditionally.
  // EXC-760: composed from the shadcn Badge. Neutral `outline` variant, not the
  // brand amber — amber stays reserved for the wordmark and the primary action
  // (doc/agents/shadcn-rules.md § amber-scarcity). `.metric` keeps it in the
  // tabular numeric-chrome family with its sibling badges.
  import { Badge } from "$lib/components/ui/badge/index.js";

  let { isDev }: { isDev: boolean } = $props();
</script>

{#if isDev}
  <Badge
    variant="outline"
    class="dev-badge metric"
    title="Running from a local source build (mise run dev) — not an installed release"
  >
    local build
  </Badge>
{/if}
