<script lang="ts">
  // EXC-561: an always-visible build badge pinned to the bottom-left corner so
  // the running build is unambiguous (handy when verifying an install or filing a
  // bug against a revision). `version` and `commit` both come from the single
  // /api/health probe App.svelte already runs; the commit is shown as its last 6
  // chars. The hash is "always there" in practice — baked into a release binary
  // via --define, git HEAD in dev — but we degrade to "v{version}" rather than
  // render a garbled "v0.0.4-nknown" when it's absent or the "unknown" sentinel.
  // Distinct from the TopBar VersionLabel (the per-plan revision pill ^v2); this
  // is the app build. Mirrors DevBadge.svelte's self-gating, health-fed shape.
  let { version, commit }: { version: string | undefined; commit: string | undefined } =
    $props();

  let sha = $derived(commit && commit !== "unknown" ? commit.slice(-6) : null);
  let label = $derived(sha ? `v${version}-${sha}` : `v${version}`);
</script>

{#if version}
  <span
    class="version-badge metric"
    title={sha ? `Running caret build · v${version} · commit ${sha}` : `Running caret build · v${version}`}
  >
    {label}
  </span>
{/if}

<style>
  /* Quiet, viewport-pinned build tag. The mono family and tabular figures come
     from the .metric atom (technical-metadata type policy, EXC-376); pill
     language matches DevBadge / VersionLabel. Muted at rest, brightening on
     hover so it stays out of the way until looked at. position: fixed makes DOM
     placement irrelevant — App renders it as a root sibling. z-index sits above
     the Toc rail (30) and below the modal scrim (100) and safe-mode toast
     (200). */
  .version-badge {
    position: fixed;
    left: 0.7rem;
    bottom: 0.6rem;
    z-index: 40;
    display: inline-flex;
    align-items: center;
    font-size: var(--text-2xs);
    letter-spacing: 0.02em;
    line-height: var(--leading-none);
    color: var(--ink-soft);
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: 99px;
    padding: 0.22rem 0.55rem;
    /* The build string is meant to be copied — select the whole thing on click. */
    user-select: all;
    opacity: 0.62;
    transition:
      opacity 140ms ease,
      border-color 140ms ease;
  }
  .version-badge:hover {
    opacity: 1;
    border-color: var(--rule-strong);
  }
  @media (prefers-reduced-motion: reduce) {
    .version-badge {
      transition: none;
    }
  }
</style>
