<script lang="ts">
  // Top-bar status badge reflecting and controlling Web Notification permission
  // (EXC-427). It mirrors Notification.permission and, in the undecided state,
  // requests it on click. Presentation is the pure bellPresentation() mapping
  // from notify.ts; this file is only the Svelte shell + styling.
  import { uiLog } from "../lib/log.ts";
  import { bellPresentation, fireTestNotification } from "../lib/notify.ts";
  import Icon from "./Icon.svelte";

  // The Notification API may be absent (older browsers, insecure contexts) — the
  // whole component renders nothing then.
  const supported = typeof Notification !== "undefined";

  let permission = $state<NotificationPermission>(
    supported ? Notification.permission : "default",
  );
  let presentation = $derived(bellPresentation(permission));

  async function handleClick() {
    // Granted: fire a test notification — the one-click answer to "is it
    // caret's logic or the OS suppressing the toast?" (a granted notification
    // the OS blocks fails silently, so an active probe is the only tell).
    if (presentation.canTest) {
      fireTestNotification();
      return;
    }
    // Inert outside the undecided state — keep the button enabled so its tooltip
    // stays reliable (a disabled button suppresses `title` in some browsers).
    if (!presentation.canRequest) return;
    try {
      await Notification.requestPermission();
      // Trust the live static over the resolved value: the notifier gates on
      // Notification.permission at fire time, and the two can diverge
      // (observed: an automation-granted prompt resolves "granted" while the
      // static stays "default"). The badge must show what will actually fire.
      permission = Notification.permission;
      uiLog.info("ui", "notify permission: " + permission);
    } catch {
      // A rejecting requestPermission (legacy callback-only engines) must not
      // surface as an unhandled rejection; re-read whatever the browser settled.
      permission = Notification.permission;
    }
  }
</script>

{#if supported}
  <button
    class="bell tone-{presentation.tone}"
    title={presentation.title}
    aria-label="Notifications: {permission}"
    aria-disabled={presentation.canRequest || presentation.canTest ? undefined : "true"}
    onclick={handleClick}
  >
    <span class="stack">
      <!-- Decorative: the button's aria-label already announces the state. -->
      <Icon name={presentation.icon} size={16} />
      {#if presentation.overlay}
        <span class="overlay">
          <Icon name={presentation.overlay} size={9} />
        </span>
      {/if}
    </span>
  </button>
{/if}

<style>
  /* Quiet status control: transparent, borderless, no chrome until hover — it
     must read calmer than the Approve button (see TopBar's primary buttons). */
  .bell {
    background: transparent;
    border: none;
    border-radius: var(--radius);
    padding: 0.35rem;
    display: inline-flex;
    align-items: center;
  }
  .bell:hover {
    background: var(--paper-sunk);
  }
  /* Tone owns the resting color; icons inherit it via stroke="currentColor". */
  .tone-ok {
    color: var(--ok);
  }
  .tone-danger {
    color: var(--danger);
  }
  .tone-muted {
    color: var(--ink-faint);
  }
  /* denied is the one read-only state (request and test clicks are real). */
  .bell[aria-disabled="true"] {
    cursor: default;
  }

  .stack {
    position: relative;
    display: inline-flex;
  }
  /* Small glyph pinned to the bell's top-right. A paper-toned ring lifts it off
     the bell strokes so the two icons stay legible; the overlay is decorative
     (Icon.svelte renders it aria-hidden when no label is given). */
  .overlay {
    position: absolute;
    top: -3px;
    right: -4px;
    display: inline-flex;
    border-radius: 50%;
    background: var(--paper);
    box-shadow: 0 0 0 1.5px var(--paper);
  }
</style>
