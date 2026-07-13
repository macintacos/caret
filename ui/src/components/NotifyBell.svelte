<script lang="ts">
  // Top-bar status badge reflecting and controlling Web Notification permission
  // (EXC-427). It mirrors Notification.permission and, in the undecided state,
  // requests it on click. Presentation is the pure bellPresentation() mapping
  // from notify.ts; this file is only the Svelte shell + styling.
  // EXC-760: composed from the shadcn Button (ghost icon) with the state help
  // text moved off a native `title=` onto a shadcn Tooltip. The bell's live
  // state stays announced via aria-label; the tooltip carries the hover hint.
  import { uiLog } from "../lib/log.ts";
  import { bellPresentation, fireTestNotification } from "../lib/notify.ts";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
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
    // stays reliable (a disabled button suppresses hover in some browsers).
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
  <!-- delayDuration=0: the hint is short state help; an instant reveal reads as
       a native title replacement rather than a lingering popover. -->
  <Tooltip.Provider delayDuration={0}>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            class="bell"
            aria-label="Notifications: {permission}"
            aria-disabled={presentation.canRequest || presentation.canTest ? undefined : "true"}
            onclick={handleClick}
          >
            <span class="stack tone-{presentation.tone}">
              <!-- Decorative: the button's aria-label already announces the state. -->
              <Icon name={presentation.icon} size={16} />
              {#if presentation.overlay}
                <span class="overlay">
                  <Icon name={presentation.overlay} size={9} />
                </span>
              {/if}
            </span>
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>{presentation.title}</Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}

<style>
  /* Tone owns the icon color; icons inherit it via stroke="currentColor". It
     lives on the icon stack (this component's own element) rather than the
     Button, because Svelte scoped styles don't pierce the child component. */
  .stack {
    position: relative;
    display: inline-flex;
  }
  .tone-ok {
    color: var(--ok);
  }
  .tone-danger {
    color: var(--danger);
  }
  .tone-muted {
    color: var(--ink-faint);
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
