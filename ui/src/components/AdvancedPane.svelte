<script lang="ts">
  // The settings Advanced pane (EXC-848): read-only, copyable diagnostics for this
  // install — the running build (from /api/health), plus daemon liveness, the host
  // system, and the parsed config (from /api/diagnostics). Self-contained like
  // NotificationsPane (EXC-847): it owns its two fetches and its per-block degrade,
  // and the shell renders it on the Advanced category branch. The fetchers are
  // injected (defaulting to the api client) so the render + degrade unit-test
  // without a daemon; the pure formatters live in lib/diagnostics.ts. Copy is
  // delegated up via onCopyDiagnostic — App writes the clipboard and fires the one
  // shared success alert (EXC-850), so this pane never stands up a second toast.
  import { getDiagnostics, getHealth } from "$lib/api.ts";
  import { configToToml, formatUptime, readDaemonPort } from "$lib/diagnostics.ts";
  import type { DaemonDiagnostics, HealthIdentity } from "@core/lib/types";

  interface Props {
    /** Copy a block's full text — App writes the clipboard and fires the EXC-850
     * success alert (the shared createAlerts/AlertHost path). */
    onCopyDiagnostic: (text: string) => void;
    /** The build-identity probe; defaults to the real client, injected in tests. */
    loadHealth?: () => Promise<HealthIdentity>;
    /** The daemon self-diagnostics probe; defaults to the real client. */
    loadDiagnostics?: () => Promise<DaemonDiagnostics>;
  }
  let {
    onCopyDiagnostic,
    loadHealth = getHealth,
    loadDiagnostics = getDiagnostics,
  }: Props = $props();

  // Two independent fetches, so each block degrades on its own: health feeds
  // VERSION, diagnostics feeds the other three. A failed probe leaves its state
  // null (the api client already logged it) and the block shows a placeholder.
  let health = $state<HealthIdentity | null>(null);
  let diagnostics = $state<DaemonDiagnostics | null>(null);
  $effect(() => {
    loadHealth()
      .then((h) => (health = h))
      .catch(() => {});
    loadDiagnostics()
      .then((d) => (diagnostics = d))
      .catch(() => {});
  });

  interface Block {
    key: "version" | "daemon" | "system" | "config";
    label: string;
    /** The block's full mono text — also exactly what a copy writes. */
    text: string;
    available: boolean;
  }

  const versionText = $derived.by(() => {
    const h = health;
    if (!h?.version) return null;
    const parts = [`caret ${h.version}`];
    if (h.build) parts.push(`build ${h.build}`);
    if (h.commit && h.commit !== "unknown") parts.push(`commit ${h.commit.slice(0, 7)}`);
    return parts.join(" · ");
  });

  const daemonText = $derived.by(() => {
    const d = diagnostics;
    if (!d) return null;
    const port = readDaemonPort(d.settings);
    const parts = ["live"];
    if (port !== undefined) parts.push(`port ${port}`);
    parts.push(`up ${formatUptime(d.uptimeMs)}`);
    return parts.join(" · ");
  });

  const systemText = $derived.by(() => {
    const s = diagnostics?.system;
    return s ? `${s.platform} (${s.arch}) · ${s.runtime}` : null;
  });

  const configText = $derived(diagnostics ? configToToml(diagnostics.settings) : null);
  const configPath = $derived(diagnostics?.config.path ?? "");

  // One descriptor per block, in mockup order. `available` gates the placeholder
  // and the copy affordance; `text` is both what's shown and what's copied.
  const blocks = $derived<Block[]>([
    { key: "version", label: "Version", text: versionText ?? "", available: versionText !== null },
    { key: "daemon", label: "Daemon", text: daemonText ?? "", available: daemonText !== null },
    { key: "system", label: "System", text: systemText ?? "", available: systemText !== null },
    { key: "config", label: "Config", text: configText ?? "", available: configText !== null },
  ]);
</script>

<div class="advanced" data-advanced-pane>
  {#each blocks as block (block.key)}
    <div class="diag-section" data-diag={block.key}>
      <div class="diag-head">
        <span class="diag-label">{block.label}</span>
        {#if block.available}
          <button
            class="diag-copy"
            aria-label={`Copy ${block.label} to clipboard`}
            onclick={() => onCopyDiagnostic(block.text)}
          >
            Copy
          </button>
        {/if}
      </div>

      {#if block.key === "config" && block.available}
        <!-- The config file's path on disk, above its block (mockup). -->
        <p class="diag-path">{configPath}</p>
      {/if}

      <!-- The sunk-paper block DISPLAYS the value — a presentational element that
           stays in the accessibility tree, so a screen reader reads the value like
           any text. The labelled Copy button above is the keyboard / AT control;
           the block's own click is a mouse-only convenience for the "click a block
           to copy" affordance (EXC-850), so its absent key handler is deliberate. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="diag-block"
        class:is-config={block.key === "config"}
        class:is-unavailable={!block.available}
        onclick={() => block.available && onCopyDiagnostic(block.text)}
      >
        {#if block.key === "daemon"}
          <span class="diag-dot" data-live={block.available}></span>
        {/if}
        <code class="diag-text">{block.available ? block.text : "Unavailable"}</code>
      </div>
    </div>
  {/each}
</div>

<style>
  .advanced {
    display: flex;
    flex-direction: column;
    gap: 1.15rem;
  }

  /* One diagnostics section: an uppercase label row (label + Copy) above its sunk
     block. The label mirrors the SettingsDialog section-head vocabulary so an
     Advanced label reads the same as the Appearance pane's "Diff view" header. */
  .diag-section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .diag-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 1.25rem;
  }
  .diag-label {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-faint);
  }

  /* The Copy affordance: a quiet chip in the label row, brightening on hover. It
     is the keyboard / screen-reader control; the success toast (EXC-850) confirms
     the copy, so the chip needs no flash of its own. */
  .diag-copy {
    appearance: none;
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 0.1rem 0.4rem;
    border-radius: var(--radius);
    font-size: var(--text-2xs);
    letter-spacing: 0.02em;
    color: var(--ink-soft);
    transition:
      color var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  .diag-copy:hover {
    color: var(--ink);
    background: var(--ink-wash);
  }

  /* The config file path, above its block. */
  .diag-path {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    overflow-wrap: anywhere;
  }

  /* The sunk-paper block: recessed off the pane on --paper-sunk, mono, and the
     whole surface is the click-to-copy target. A subtle hover deepens the border
     and fill so it reads as interactive. That hover mixes off --paper-sunk rather
     than taking a derived token: it is an opaque 4% step into the recessed surface,
     where the tier's opaque fills ride --paper-raised and --ink-wash is a
     translucent tint at twice this strength. */
  .diag-block {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0.6rem 0.75rem;
    text-align: left;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper-sunk);
    cursor: pointer;
    overflow-x: auto;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  .diag-block:not(.is-unavailable):hover {
    border-color: var(--rule-strong);
    background: color-mix(in lab, var(--paper-sunk), var(--ink) 4%);
  }
  .diag-block.is-unavailable {
    cursor: default;
  }
  /* The config block preserves the TOML's line breaks and caps its height,
     scrolling when the parsed config runs long. */
  .diag-block.is-config {
    max-height: 12rem;
    overflow-y: auto;
  }

  .diag-text {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--ink);
    white-space: pre;
  }
  /* A degraded block reads muted — it's a placeholder, not data. */
  .diag-block.is-unavailable .diag-text {
    color: var(--ink-faint);
  }

  /* The daemon live dot: --ok when the diagnostics probe answered, muted when it
     didn't — a plain colored disc, not an icon. */
  .diag-dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    margin-right: 0.5rem;
    border-radius: 50%;
    vertical-align: middle;
    background: var(--ink-faint);
  }
  .diag-dot[data-live="true"] {
    background: var(--ok);
  }
</style>
