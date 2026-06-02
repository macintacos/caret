<script lang="ts">
  import type { AcceptMode, ClientReview } from "../lib/types.ts";
  import ReviewSwitcher from "./ReviewSwitcher.svelte";
  import VersionLabel from "./VersionLabel.svelte";

  interface Props {
    reviews: ClientReview[];
    active: ClientReview | null;
    busy: boolean;
    onSelect: (id: string) => void;
    onApprove: (mode: AcceptMode) => void;
    onRequestChanges: () => void;
  }
  let { reviews, active, busy, onSelect, onApprove, onRequestChanges }: Props =
    $props();

  const APPROVE_VARIANTS: { mode: AcceptMode; label: string; note: string }[] = [
    { mode: "default", label: "Approve", note: "Approve edits manually" },
    {
      mode: "acceptEdits",
      label: "Approve & accept edits",
      note: "Auto-accept file edits this session",
    },
    {
      mode: "auto",
      label: "Approve & auto mode",
      note: "Full auto mode this session",
    },
  ];

  let menuOpen = $state(false);

  function approve(mode: AcceptMode) {
    menuOpen = false;
    onApprove(mode);
  }
  function shortCwd(cwd: string): string {
    const parts = cwd.split("/").filter(Boolean);
    return parts.length <= 2 ? cwd : `…/${parts.slice(-2).join("/")}`;
  }
</script>

<header class="topbar">
  <div class="lead">
    <span class="brand" title="caret">
      <span class="brand-caret" aria-hidden="true">^</span>caret
    </span>
    <span class="divider" aria-hidden="true"></span>
    {#if active}
      <ReviewSwitcher {reviews} activeId={active.id} {onSelect} />
      <VersionLabel version={active.version} />
    {/if}
  </div>

  {#if active}
    <div class="context mono" title={active.cwd}>{shortCwd(active.cwd)}</div>

    <div class="actions" class:busy>
      <button class="request" onclick={onRequestChanges} disabled={busy}>
        Request changes
      </button>

      <div class="split">
        <button class="approve" onclick={() => approve("default")} disabled={busy}>
          Approve
        </button>
        <button
          class="split-toggle"
          aria-label="Approve options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}
          disabled={busy}
        >
          ▾
        </button>

        {#if menuOpen}
          <ul class="menu" role="menu">
            {#each APPROVE_VARIANTS as v (v.mode)}
              <li>
                <button role="menuitem" onclick={() => approve(v.mode)}>
                  <span class="v-label">{v.label}</span>
                  <span class="v-note mono">{v.note}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
</header>

<!-- Click-away closes the approve menu. -->
{#if menuOpen}
  <button
    class="scrim-invisible"
    aria-hidden="true"
    tabindex="-1"
    onclick={() => (menuOpen = false)}
  ></button>
{/if}

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.7rem clamp(1rem, 3vw, 2rem);
    border-bottom: 1px solid var(--rule-strong);
    background: var(--paper);
    position: relative;
    z-index: 30;
  }
  .lead {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }
  .brand {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1.15rem;
    letter-spacing: -0.01em;
    color: var(--ink);
    white-space: nowrap;
  }
  .brand-caret {
    font-family: var(--font-mono);
    color: var(--accent);
    margin-right: 0.05em;
  }
  .divider {
    width: 1px;
    height: 1.4rem;
    background: var(--rule-strong);
  }
  .context {
    flex: 1;
    text-align: center;
    color: var(--ink-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
  }
  .actions.busy {
    opacity: 0.6;
    pointer-events: none;
  }
  .request {
    background: transparent;
    color: var(--ink);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    padding: 0.5rem 0.9rem;
    font-size: 0.82rem;
    font-weight: 600;
  }
  .request:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .split {
    position: relative;
    display: flex;
  }
  .approve {
    background: var(--accent);
    color: var(--accent-ink);
    border: 1px solid var(--accent);
    border-right: none;
    border-radius: var(--radius) 0 0 var(--radius);
    padding: 0.5rem 1rem;
    font-size: 0.82rem;
    font-weight: 700;
  }
  .split-toggle {
    background: var(--accent);
    color: var(--accent-ink);
    border: 1px solid var(--accent);
    border-radius: 0 var(--radius) var(--radius) 0;
    padding: 0.5rem 0.55rem;
    font-size: 0.7rem;
    border-left: 1px solid color-mix(in srgb, var(--accent-ink) 30%, var(--accent));
  }
  .approve:hover:not(:disabled),
  .split-toggle:hover:not(:disabled) {
    background: var(--accent-bright);
    border-color: var(--accent-bright);
  }
  .menu {
    position: absolute;
    z-index: 41;
    top: calc(100% + 0.4rem);
    right: 0;
    min-width: 260px;
    list-style: none;
    margin: 0;
    padding: 0.3rem;
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
  }
  .menu button {
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-radius: var(--radius);
    padding: 0.5rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .menu button:hover {
    background: var(--accent-wash);
  }
  .v-label {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--ink);
  }
  .v-note {
    color: var(--ink-faint);
    font-size: 0.68rem;
  }
  .scrim-invisible {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: transparent;
    border: none;
    cursor: default;
  }
</style>
