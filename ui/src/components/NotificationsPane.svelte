<script lang="ts">
  // The settings Notifications pane (EXC-847): a live, read-only view of the
  // browser's notification permission plus the enable / test affordance. Permission
  // is browser-owned and applies immediately, so this reflects it rather than
  // editing it. Shares its state logic with the topbar NotifyBell through notify.ts
  // — bellPresentation (which icon, and which affordance each state gets) and
  // observePermission (stay truthful when the permission changes elsewhere). The
  // bell stays; this is the roomier, explain-yourself surface for the same state.
  import { uiLog } from "$lib/log.ts";
  import { bellPresentation, fireTestNotification, observePermission } from "$lib/notify.ts";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "@/components/Icon.svelte";

  // The Notification API may be absent (older browsers, insecure contexts); the
  // pane then explains the shortfall rather than a status it can't read.
  const supported = typeof Notification !== "undefined";

  let permission = $state<NotificationPermission>(
    supported ? Notification.permission : "default",
  );

  // Stay truthful when the permission changes outside this pane — the topbar bell,
  // the browser's own site settings — via the shared subscription (returns teardown).
  $effect(() => observePermission((p) => (permission = p)));

  // The shared mapping owns the icon and which affordance the state gets; the pane
  // owns its own status word, tone, and prose (the badge tooltip copy is tuned for
  // a hover hint, not a roomy status block). Both key off the same permission, so
  // they can never disagree about the state.
  const presentation = $derived(bellPresentation(permission));
  const status = $derived(
    permission === "granted"
      ? {
          word: "On",
          tone: "ok",
          desc: "caret alerts you the moment a new plan is ready — even when this tab is in the background.",
        }
      : permission === "denied"
        ? {
            word: "Blocked",
            tone: "danger",
            desc: "Notifications are blocked. Re-enable them in your browser's site settings, then reload.",
          }
        : {
            word: "Off",
            tone: "attention",
            desc: "Turn on desktop notifications to get pinged for every new plan, even in the background.",
          },
  );

  async function enable() {
    try {
      await Notification.requestPermission();
      // Trust the live static over the resolved value (the notifier gates on it at
      // fire time, and the two can diverge on automation-granted prompts).
      permission = Notification.permission;
      uiLog.info("ui", "settings notify permission: " + permission);
    } catch {
      // A rejecting requestPermission (legacy callback-only engines) must not
      // surface as an unhandled rejection; re-read whatever the browser settled.
      permission = Notification.permission;
    }
  }
</script>

<div
  class="notif"
  data-notifications-pane
  data-permission={supported ? permission : "unsupported"}
>
  {#if !supported}
    <p class="notif-note">This browser doesn't support desktop notifications.</p>
  {:else}
    <div class="notif-status tone-{status.tone}">
      <span class="notif-icon">
        <!-- Decorative: the status word beside it announces the state. -->
        <Icon name={presentation.icon} size={20} />
      </span>
      <span class="notif-word">{status.word}</span>
    </div>

    <p class="notif-desc">{status.desc}</p>

    {#if presentation.canRequest}
      <!-- The pane's single primary action — amber, per the one-primary rule. -->
      <div class="notif-action">
        <Button data-action="enable" onclick={enable}>Enable notifications</Button>
      </div>
    {:else if presentation.canTest}
      <!-- Diagnosis affordance: a granted toast the OS suppresses fails silently, so
           an active probe is the only tell. Neutral chip — not the primary. -->
      <div class="notif-action">
        <Button
          variant="secondary"
          class="float-chip"
          data-action="test"
          onclick={fireTestNotification}
        >
          Send a test notification
        </Button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .notif {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    align-items: flex-start;
  }

  /* Status line: a tone-tinted bell in a soft disc, beside the state word. Tone
     lives on this row so both the icon (stroke="currentColor") and the word inherit
     it; the disc tint is a low-alpha mix of that same tone over the surface. */
  .notif-status {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .tone-ok {
    color: var(--ok);
  }
  .tone-danger {
    color: var(--danger);
  }
  .tone-attention {
    color: var(--attention);
  }
  /* The halo tints whatever tone class the row wears (.tone-danger, .tone-attention,
     …), so it mixes off currentColor rather than a palette token — nothing in the
     derived tier could stand in for it. */
  .notif-icon {
    display: inline-flex;
    padding: 0.5rem;
    border-radius: 50%;
    background: color-mix(in lab, currentColor 12%, transparent);
  }
  .notif-word {
    font-size: var(--text-lg);
    font-weight: 600;
    color: currentColor;
  }

  .notif-desc {
    margin: 0;
    max-width: 42ch;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--ink-soft);
  }

  .notif-action {
    margin-top: 0.15rem;
  }

  /* The unsupported note stands in for the whole status block. */
  .notif-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--ink-soft);
  }
</style>
