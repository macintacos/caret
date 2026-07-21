<script lang="ts">
  // The in-UI alert/toast surface (EXC-850): a fixed stack pinned bottom-right,
  // above the status bar. Renders the alert queue App.svelte owns (see
  // state/alerts.ts) as shadcn Alert cards, oldest on top and newer stacking
  // underneath, each sliding in on mount and settling out when it leaves. The
  // queue owns the per-alert dwell + removal timing; this component is the
  // presentation — it molds Alert.Root into a floating card the same way the
  // daemon banner does, and the motion draws from the shared --dur-*/--ease-*
  // tokens (CSS-only, so the global reduced-motion rule governs it).
  import type { AlertItem } from "@/state/alerts.ts";
  import type { IconName } from "$lib/icons.ts";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import Icon from "@/components/Icon.svelte";

  let { alerts, onDismiss }: { alerts: AlertItem[]; onDismiss: (id: number) => void } = $props();

  // Leading glyph per variant: success carries the check (the "it worked"
  // affordance), destructive an x; a plain default alert leads with no icon.
  const ICONS: Record<AlertItem["variant"], IconName | null> = {
    default: null,
    success: "check",
    destructive: "x",
  };
</script>

{#if alerts.length > 0}
  <div class="alert-host">
    {#each alerts as a (a.id)}
      {@const icon = ICONS[a.variant]}
      <!-- role="status" (polite) overrides Alert.Root's default role="alert"
           (assertive): a copy/save confirmation shouldn't interrupt a screen
           reader, and it avoids nesting an assertive region — matching the
           safe-mode toast. The urgent daemon banner keeps the assertive default. -->
      <Alert.Root
        variant={a.variant}
        data-variant={a.variant}
        role="status"
        class={a.leaving ? "alert-item leaving" : "alert-item"}
      >
        {#if icon}<Icon name={icon} size={16} />{/if}
        <div class="alert-body">
          {#if a.title}<span class="alert-title">{a.title}</span>{/if}
          <span class="alert-message">{a.message}</span>
        </div>
        <button type="button" class="alert-dismiss" aria-label="Dismiss" onclick={() => onDismiss(a.id)}>
          <Icon name="x" size={14} />
        </button>
      </Alert.Root>
    {/each}
  </div>
{/if}

<style>
  /* Pinned bottom-right, clearing the status bar; the column grows upward as
     alerts arrive so the newest sits closest to the status line. The container
     itself is click-through (its gaps don't intercept the plan below); each card
     re-enables pointer events. */
  .alert-host {
    position: fixed;
    right: 1.25rem;
    bottom: calc(var(--status-bar-h) + 1rem);
    /* Above the modal scrim (z-100), matching .safe-mode-toast — so an alert
       raised from inside a dialog (the planned settings-save confirmation) is
       visible over it rather than trapped behind the scrim. */
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: min(22rem, calc(100vw - 2.5rem));
    pointer-events: none;
  }
  /* Mold Alert.Root (a card by default) into a floating toast: a flex row of
     [icon] [body] [dismiss] with the raised-paper card lifted on --shadow-card.
     :global because the class rides the shadcn Alert root, which carries no
     scope hash (the same reach the daemon banner uses). Enter slides up + fades
     in; a leaving card reverses it, then the queue removes it. */
  :global(.alert-item) {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    pointer-events: auto;
    box-shadow: var(--shadow-card);
    animation: alert-in var(--dur-base) var(--ease-out);
  }
  :global(.alert-item.leaving) {
    animation: alert-out var(--dur-base) var(--ease-in) forwards;
  }
  .alert-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .alert-title {
    font-weight: 600;
    font-size: var(--text-sm);
    line-height: var(--leading-tight);
  }
  .alert-message {
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
  }
  /* Quiet dismiss affordance: the glyph rides the card's variant color at
     reduced opacity, brightening on hover. */
  .alert-dismiss {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    appearance: none;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.1rem;
    margin: -0.1rem -0.15rem -0.1rem 0;
    border-radius: var(--radius);
    color: inherit;
    opacity: 0.6;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .alert-dismiss:hover {
    opacity: 1;
  }
  @keyframes alert-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes alert-out {
    from {
      opacity: 1;
      transform: translateY(0);
    }
    to {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
