<script lang="ts">
  // EXC-561: an always-visible build badge pinned to the bottom-left corner so
  // the running build is unambiguous (handy when verifying an install or filing a
  // bug against a revision). `version`, `commit`, and `isDev` all come from the
  // single /api/health probe App.svelte already runs; the commit is shown as its
  // last 6 chars. The hash is "always there" in practice — baked into a release
  // binary via --define, git HEAD in dev — but we degrade to "v{version}" rather
  // than render a garbled "v0.0.4-nknown" when it's absent or the "unknown"
  // sentinel. Distinct from the TopBar VersionLabel (the per-plan revision pill
  // ^v2); this is the app build. Mirrors DevBadge.svelte's self-gating shape.
  //
  // EXC-664: clicking the pill copies a debug block to the clipboard — version,
  // the FULL commit (not the truncated display tail), build type, page URL, and
  // user agent — and flashes a "Copied" confirmation, so a bug report can carry
  // the exact running build in one click.
  import { onDestroy } from "svelte";

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
  <button
    type="button"
    class="version-badge metric"
    class:copied
    aria-label={`Copy build info (v${version}) to the clipboard`}
    title={sha
      ? `Running caret build · v${version} · commit ${sha} — click to copy debug info`
      : `Running caret build · v${version} — click to copy debug info`}
    onclick={copy}
  >
    {copied ? "Copied" : label}
  </button>
{/if}

<style>
  /* Quiet, viewport-pinned build tag. The mono family and tabular figures come
     from the .metric atom (technical-metadata type policy, EXC-376); pill
     language matches DevBadge / VersionLabel. Muted at rest, brightening on
     hover so it stays out of the way until looked at. position: fixed makes DOM
     placement irrelevant — App renders it as a root sibling. z-index sits above
     the Toc rail (30) and below the modal scrim (100) and safe-mode toast
     (200). It's a button (EXC-664: click-to-copy), so the button chrome is reset
     back to the pill. */
  .version-badge {
    position: fixed;
    left: 0.7rem;
    bottom: 0.6rem;
    z-index: 40;
    display: inline-flex;
    align-items: center;
    appearance: none;
    cursor: pointer;
    font-size: var(--text-2xs);
    letter-spacing: 0.02em;
    line-height: var(--leading-none);
    color: var(--ink-soft);
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: 99px;
    padding: 0.22rem 0.55rem;
    opacity: 0.62;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .version-badge:hover {
    opacity: 1;
    border-color: var(--rule-strong);
  }
  /* Click feedback: the pill briefly fills with the accent wash and takes the
     accent hue — an unmistakable "copied" flash that reverts after COPIED_MS. */
  .version-badge.copied {
    opacity: 1;
    color: var(--accent);
    background: var(--accent-wash);
    border-color: var(--accent);
  }
</style>
