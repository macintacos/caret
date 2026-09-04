<script lang="ts">
  // EXC-556: a "local build" pill shown when the daemon runs from source
  // (mise run dev / the e2e harness / a manual `bun src/cli.ts`) rather than a
  // compiled release, so a dev build is never mistaken for a real review. Driven
  // by /api/health's isDev flag; self-gates so callers pass it unconditionally.
  // Deliberately not the brand amber — that stays reserved for the wordmark and the
  // primary action (doc/agents/shadcn-rules.md § amber-scarcity).
  import { Badge } from "$lib/components/ui/badge/index.js";

  let { isDev }: { isDev: boolean } = $props();
</script>

{#if isDev}
  <Badge
    variant="secondary"
    class="dev-badge metric float-chip"
    style="color: var(--ink-soft)"
    title="Running from a local source build (mise run dev) — not an installed release"
  >
    local build
  </Badge>
{/if}
