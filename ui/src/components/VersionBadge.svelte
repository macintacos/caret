<script lang="ts">
  // EXC-561: an always-visible build badge in the bottom status bar, so the running
  // build is unambiguous. `version`, `commit` and `isDev` all come from the single
  // /api/health probe App.svelte already runs. The hash is "always there" in practice
  // — baked into a release binary via --define, git HEAD in dev — but it degrades to
  // "v{version}" rather than render a garbled "v0.0.4-nknown" when it is absent or the
  // "unknown" sentinel. Distinct from the TopBar VersionLabel (the per-plan revision
  // pill ^v2); this is the app build. Mirrors DevBadge.svelte's self-gating shape.
  //
  // It stays a real <button> — click-to-copy needs button semantics, which the shadcn
  // Badge (span/anchor only) can't give (EXC-763).
  import { onDestroy } from "svelte";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";

  let {
    version,
    commit,
    isDev = false,
  }: { version: string | undefined; commit: string | undefined; isDev?: boolean } = $props();

  let sha = $derived(commit && commit !== "unknown" ? commit.slice(-6) : null);
  let label = $derived(sha ? `v${version}-${sha}` : `v${version}`);

  // The full commit (not the display tail) and the build provenance are what a
  // bug report actually needs, so the copied block carries them verbatim.
  function debugInfo(): string {
    const lines = [`caret v${version}`];
    if (commit && commit !== "unknown") lines.push(`commit ${commit}`);
    lines.push(`build ${isDev ? "local source (mise run dev)" : "release"}`);
    if (typeof location !== "undefined") lines.push(`url ${location.href}`);
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      lines.push(`ua ${navigator.userAgent}`);
    }
    return lines.join("\n");
  }

  // The confirmation reflects click intent immediately; the async write rides
  // alongside and fails silently (the Clipboard API rejects in insecure contexts,
  // where the visible build string is still there to copy by hand).
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const COPIED_MS = 1500;

  function copy(): void {
    void navigator.clipboard?.writeText(debugInfo()).catch(() => {});
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      copied = false;
    }, COPIED_MS);
  }

  onDestroy(() => clearTimeout(timer));
</script>

{#if version}
  <Tooltip.Provider delayDuration={0}>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            class="version-badge metric"
            class:copied
            aria-label={`Copy build info (v${version}) to the clipboard`}
            onclick={copy}
          >
            {copied ? "Copied" : label}
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>
        {sha
          ? `Running caret build · v${version} · commit ${sha} — click to copy debug info`
          : `Running caret build · v${version} — click to copy debug info`}
      </Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}

<style>
  /* Quiet build tag: a flat status-bar segment (EXC-787), muted at rest and
     brightening on hover so it stays out of the way until looked at. The button is
     reset to the bar's flat metric type; StatusBar owns layout, so the badge does not
     position itself. */
  .version-badge {
    display: inline-flex;
    align-items: center;
    appearance: none;
    cursor: pointer;
    font-size: var(--text-2xs);
    letter-spacing: 0.02em;
    line-height: var(--leading-none);
    color: var(--ink-soft);
    background: none;
    border: none;
    border-radius: var(--radius);
    padding: 0.15rem 0.35rem;
    transition:
      color var(--dur-micro) var(--ease-out),
      background-color var(--dur-micro) var(--ease-out);
  }
  .version-badge:hover {
    color: var(--ink);
  }
  /* Click feedback: the segment briefly takes the accent wash + hue — an
     unmistakable "copied" flash that reverts after COPIED_MS. */
  .version-badge.copied {
    color: var(--accent);
    background: var(--accent-wash);
  }
</style>
