<script lang="ts">
  import { approveLabel } from "../lib/approve.ts";
  import { shortCwd } from "../lib/cwd.ts";
  import { isCancelKey } from "../lib/keys.ts";
  import type { ApproveVariant, ApproveVariantId, ClientReview } from "@core/types";
  import DevBadge from "./DevBadge.svelte";
  import Icon from "./Icon.svelte";
  import NotifyBell from "./NotifyBell.svelte";
  import ReviewSwitcher from "./ReviewSwitcher.svelte";
  import VersionLabel from "./VersionLabel.svelte";

  interface Props {
    reviews: ClientReview[];
    active: ClientReview | null;
    busy: boolean;
    /** Remembered approve variant id; sets the primary button's id + label. */
    approveMode: ApproveVariantId;
    /** The adapter-declared approve variants to render (labels/order/default). */
    variants: ApproveVariant[];
    /** True when the daemon runs from source; shows the "local build" badge. */
    isDev?: boolean;
    onSelect: (id: string) => void;
    onApprove: (mode: ApproveVariantId) => void;
    onRequestChanges: () => void;
  }
  let {
    reviews,
    active,
    busy,
    approveMode,
    variants,
    isDev = false,
    onSelect,
    onApprove,
    onRequestChanges,
  }: Props = $props();

  let menuOpen = $state(false);

  function approve(mode: ApproveVariantId) {
    menuOpen = false;
    onApprove(mode);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (menuOpen && isCancelKey(e)) menuOpen = false;
  }}
/>

<header class="topbar">
  <div class="lead">
    <span class="brand" title="caret">
      <span class="brand-caret" aria-hidden="true">^</span>caret
    </span>
    <DevBadge {isDev} />
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
        <Icon name="corner-up-left" size={14} />
        Request changes
      </button>

      <div class="split">
        <button class="approve" onclick={() => approve(approveMode)} disabled={busy}>
          <Icon name="check" size={14} />
          {approveLabel(approveMode, variants)}
        </button>
        <button
          class="split-toggle"
          aria-label="Approve options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}
          disabled={busy}
        >
          <Icon name="chevron-down" size={14} />
        </button>

        {#if menuOpen}
          <ul class="menu" role="menu">
            {#each variants as v (v.id)}
              <li>
                <button role="menuitem" onclick={() => approve(v.id)}>
                  <span class="v-label">{v.label}</span>
                  {#if v.description}<span class="v-note">{v.description}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Always-visible permission badge, pinned right in both layouts: when a
       review is active `.context` (flex: 1) eats the slack and the bell sits
       after `.actions`; with no review its own margin-left pushes it right. -->
  <div class="bell-slot">
    <NotifyBell />
  </div>
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
  /* The header row sits on the raised paper surface with a hairline rule, so it
     stacks seamlessly with the compare bar (VersionComparePicker) directly below
     it — the two read as one layered header system over the source view. */
  .topbar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.7rem clamp(1rem, 3vw, 2rem);
    border-bottom: 1px solid var(--rule);
    background: var(--paper-raised);
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
  /* Pins the bell to the right edge when no review is active (`.context`'s
     flex:1 handles the active layout; here auto resolves to 0). */
  .bell-slot {
    display: inline-flex;
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
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    transition:
      border-color 0.12s ease,
      color 0.12s ease;
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
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }
  .split-toggle {
    background: var(--accent);
    color: var(--accent-ink);
    border: 1px solid var(--accent);
    border-radius: 0 var(--radius) var(--radius) 0;
    padding: 0.5rem 0.55rem;
    border-left: 1px solid color-mix(in srgb, var(--accent-ink) 30%, var(--accent));
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
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
    /* The accent bar (inset, so it doesn't shift layout) is the source-view
       surface's signature for an active row; it appears on hover here. */
    box-shadow: inset 2px 0 0 transparent;
    transition:
      background 0.12s ease,
      box-shadow 0.12s ease;
  }
  .menu button:hover {
    background: var(--accent-wash);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .v-label {
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
