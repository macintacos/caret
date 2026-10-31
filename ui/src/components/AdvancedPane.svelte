<script lang="ts">
  // The settings Advanced pane (EXC-848): read-only, copyable diagnostics for this
  // install — the running build (from /api/health), plus daemon liveness, the host
  // system, and the parsed config (from /api/diagnostics). Self-contained like
  // NotificationsPane (EXC-847): it owns its two fetches and its per-block degrade,
  // and the shell renders it on the Advanced category branch. The fetchers are
  // injected (defaulting to the api client) so the render + degrade unit-test
  // without a daemon; the pure formatters live in lib/diagnostics.ts. Each block is a
  // plan-view code block whose tray copies and wraps it in place.
  import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldTitle,
  } from "$lib/components/ui/field/index.js";
  import { getDiagnostics, getHealth } from "$lib/api.ts";
  import { configToToml, formatUptime, readDaemonPort } from "$lib/diagnostics.ts";
  import type { DaemonDiagnostics, HealthIdentity } from "@core/lib/types";
  import CodeChromeTray from "@/components/CodeChromeTray.svelte";

  interface Props {
    /** The build-identity probe; defaults to the real client, injected in tests. */
    loadHealth?: () => Promise<HealthIdentity>;
    /** The daemon self-diagnostics probe; defaults to the real client. */
    loadDiagnostics?: () => Promise<DaemonDiagnostics>;
    /** Clipboard writer, handed to each block's tray; injectable for tests. */
    copy?: (text: string) => Promise<void>;
  }
  let { loadHealth = getHealth, loadDiagnostics = getDiagnostics, copy }: Props = $props();

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

  // One descriptor per block. `available` gates the placeholder and the tray; `text` is
  // both what's shown and what's copied.
  const blocks = $derived<Block[]>([
    { key: "version", label: "Version", text: versionText ?? "", available: versionText !== null },
    { key: "daemon", label: "Daemon", text: daemonText ?? "", available: daemonText !== null },
    { key: "system", label: "System", text: systemText ?? "", available: systemText !== null },
    { key: "config", label: "Config", text: configText ?? "", available: configText !== null },
  ]);

  // Per block: wrapped by the reviewer, and too wide for its box unwrapped. A wrapped
  // block no longer overflows, so its wrap cap stays while it is wrapped.
  const reflowed = $state<Partial<Record<Block["key"], boolean>>>({});
  const overflowing = $state<Partial<Record<Block["key"], boolean>>>({});

  // Re-attached whenever the block's text changes, and re-measured whenever its box
  // resizes: a value arriving or a narrower modal can each push it past the edge.
  function watchOverflow(key: Block["key"], _text: string) {
    return (pre: HTMLElement) => {
      const observer = new ResizeObserver(() => {
        overflowing[key] = pre.scrollWidth > pre.clientWidth;
      });
      observer.observe(pre);
      return () => observer.disconnect();
    };
  }
</script>

<!-- The pane composes the shadcn field parts (EXC-1112). A block DISPLAYS a value and
     labels no control, so it takes FieldTitle (a <div>), not FieldLabel. Each Field
     renders role="group"; naming it after its own title keeps those groups structural
     rather than four nameless boundaries. The plain wrapper below is deliberate — it
     is the scoped element the styles anchor on, without which a class handed to a
     component could only be reached by a top-level :global rule, i.e. app-wide. -->
<div class="advanced" data-advanced-pane>
  <FieldGroup class="diag-list">
    {#each blocks as block (block.key)}
      <Field class="diag-section" data-diag={block.key} aria-labelledby="diag-{block.key}-label">
        <FieldTitle id="diag-{block.key}-label" class="diag-label settings-block-label">{block.label}</FieldTitle>

        {#if block.key === "config" && block.available}
          <FieldDescription class="diag-path">{configPath}</FieldDescription>
        {/if}

        <div class="diag-block">
          <pre
            class="diag-code settings-copy-box settings-copy-text"
            class:is-config={block.key === "config"}
            class:is-unavailable={!block.available}
            data-reflow={reflowed[block.key] ? "" : undefined}
            {@attach watchOverflow(block.key, block.text)}>{#if block.key === "daemon"}<span
                class="diag-dot"
                data-live={block.available}></span>{/if}<code class="diag-text"
              >{block.available ? block.text : "Unavailable"}</code></pre>
          {#if block.available}
            <div class="diag-chrome">
              <CodeChromeTray
                text={block.text}
                copyName={block.label}
                wrapName="in {block.label}"
                wrappable={reflowed[block.key] === true || overflowing[block.key] === true}
                reflowed={reflowed[block.key] === true}
                onToggleReflow={() => (reflowed[block.key] = !reflowed[block.key])}
                {copy}
              />
            </div>
          {/if}
        </div>
      </Field>
    {/each}
  </FieldGroup>
</div>

<style>
  .advanced {
    display: flex;
    flex-direction: column;
  }
  /* The field parts carry shadcn's roomier default gaps, so the pane's own rhythm is
     re-asserted here rather than in the vendored tree (shadcn-rules.md § Adding a
     component that collides with the vendored tree — a re-sync reverts wholesale).
     Svelte does not scope-hash a class handed to a COMPONENT, so every selector that
     now sits on one is written :global — anchored on `.advanced`, which is a plain
     element and so still carries the scope hash. */
  .advanced :global(.diag-list) {
    gap: 1.15rem;
  }

  /* The section label mirrors the SettingsDialog section-head vocabulary, so an Advanced
     label reads the same as the Appearance pane's "Diff view" header. */
  .advanced :global(.diag-section) {
    gap: 0.4rem;
  }

  .advanced :global(.diag-path) {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    overflow-wrap: anywhere;
  }

  .diag-block {
    position: relative;
    min-width: 0;
  }
  /* The inline-end padding keeps the tray clear of the first line's text. */
  .diag-code {
    padding: 0.6rem 4.5rem 0.6rem 2ch;
    font-variant-ligatures: none;
    tab-size: 2;
  }
  .diag-code[data-reflow] {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .diag-code.is-config {
    max-height: 12rem;
    overflow-y: auto;
  }
  /* A placeholder, not data: --ink-soft would fall under AA on the palest palettes'
     code panel, so it keeps full ink and reads as a placeholder by its slant. */
  .diag-code.is-unavailable .diag-text {
    font-family: var(--font-sans);
    font-style: italic;
  }

  /* The tray rests dimmed in the block's corner, as over a plan code block, and comes
     up as the reviewer reaches the block or tabs into it. */
  .diag-chrome {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    z-index: 1;
    opacity: 0.4;
    transition: opacity var(--dur-state) var(--ease-out);
  }
  .diag-block:hover .diag-chrome,
  .diag-chrome:focus-within {
    opacity: 1;
  }

  /* The daemon's live light sits in a socket cut into the block, the status strip's
     connection light; unlit when the diagnostics probe failed. */
  .diag-dot {
    display: inline-block;
    width: 0.45rem;
    height: 0.45rem;
    margin-right: 0.6rem;
    border-radius: 99px;
    vertical-align: 0.05em;
    background: var(--ink-faint);
    box-shadow:
      inset 0 -1px 1px var(--socket-shade),
      0 0 0 1.5px var(--code-panel),
      0 0 0 2px var(--socket-ring);
  }
  .diag-dot[data-live="true"] {
    background: var(--ok);
  }
</style>
