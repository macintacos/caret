<script lang="ts">
  // The in-UI alert/toast surface (EXC-850): a fixed stack pinned bottom-right, above
  // the status bar, rendering the alert queue App.svelte owns (state/alerts.ts) as
  // shadcn Alert cards. The queue owns the per-alert dwell + removal timing; this
  // component is the presentation, molding Alert.Root into a floating card the same
  // way the daemon banner does. The motion is CSS-only, so the global reduced-motion
  // rule governs it.
  import type { AlertItem } from "@/state/alerts.ts";
  import type { IconName } from "$lib/icons.ts";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import Icon from "@/components/Icon.svelte";

  let { alerts, onDismiss }: { alerts: AlertItem[]; onDismiss: (id: number) => void } = $props();

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
      <!-- A destructive alert is a failure the user must act on, so role="alert"
           interrupts the screen reader. Success/default confirmations are polite
           (role="status"): they shouldn't interrupt, and it avoids nesting an
           assertive region. The urgent daemon banner keeps the assertive default. -->
      <Alert.Root
        variant={a.variant}
        data-variant={a.variant}
        role={a.variant === "destructive" ? "alert" : "status"}
        class={a.leaving ? "alert-item leaving" : "alert-item"}
      >
        {#if icon}<Icon name={icon} size={16} />{/if}
        <div class="alert-body">
          {#if a.title}<span class="alert-title">{a.title}</span>{/if}
          <span class="alert-message" id="alert-message-{a.id}">{a.message}</span>
          <!-- The activate affordance (EXC-1207), after the message so it reads as
               "here's the news, here's what to do about it". Out of context — a
               screen reader's button list — a bare verb like "View" says nothing about
               which alert it acts on, so the message describes it. -->
          {#if a.action}
            <button
              type="button"
              class="alert-action"
              aria-describedby="alert-message-{a.id}"
              onclick={a.action.run}>{a.action.label}</button>
          {/if}
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
  /* Mold Alert.Root (a card by default) into a floating toast lifted on
     --shadow-card. :global because the class rides the shadcn Alert root, which
     carries no scope hash. A leaving card reverses the enter, then the queue removes
     it. */
  :global(.alert-item) {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    pointer-events: auto;
    box-shadow: var(--shadow-card);
    animation: alert-in var(--dur-enter) var(--ease-out);
  }
  :global(.alert-item.leaving) {
    animation: alert-out var(--dur-exit) var(--ease-in) forwards;
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
  /* A text button, not a clickable card: the card already holds the dismiss control,
     and nesting interactive controls is an accessibility defect. It rides the card's
     variant colour rather than the accent, so the underline carries the whole
     affordance — declared explicitly, since a <button> inherits none. It self-starts
     so its hit area is the label, not the card's full width. */
  .alert-action {
    align-self: flex-start;
    margin-top: 0.2rem;
    appearance: none;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: var(--leading-snug);
    text-decoration-line: underline;
    text-decoration-color: currentColor;
    text-underline-offset: 0.2em;
    opacity: 0.75;
    transition: opacity var(--dur-micro) var(--ease-out);
  }
  .alert-action:hover {
    opacity: 1;
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
    transition: opacity var(--dur-micro) var(--ease-out);
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
