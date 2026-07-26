<script lang="ts">
  // First-run onboarding (EXC-781): a one-time modal that explains desktop
  // notifications and offers to turn them on. App gates it via
  // shouldShowOnboarding() — shown only to a brand-new user whose permission is
  // still undecided. Composes the shared Modal shell (the SettingsDialog analog);
  // this file is only the copy + the two actions.
  import { Button } from "$lib/components/ui/button/index.js";
  import { uiLog } from "$lib/log.ts";
  import { markOnboarded } from "$lib/prefs.ts";
  import Modal from "@/components/Modal.svelte";

  interface Props {
    /** Controlled open — false while the modal plays its exit. */
    open: boolean;
    /** The surface finished its exit and may be unmounted. */
    onClosed?: () => void;
    /** Dismiss the modal — App flips its open flag. */
    onClose: () => void;
  }
  let { open, onClosed, onClose }: Props = $props();

  // Both paths record onboarding as seen so it never reappears, then close. Where
  // the Permissions API fires a change event, the bell re-reads
  // Notification.permission and reflects a grant made here without a reload.
  function dismiss() {
    markOnboarded();
    onClose();
  }

  async function enable() {
    try {
      const result = await Notification.requestPermission();
      uiLog.info("ui", "onboarding notify permission: " + result);
    } catch {
      // Legacy callback-only engines can reject requestPermission; the badge
      // re-reads whatever the browser settled either way.
    }
    dismiss();
  }
</script>

<Modal
  kind="dialog"
  {open}
  {onClosed}
  eyebrow="Welcome to caret"
  title="Desktop notifications"
  onDismiss={dismiss}
>
  {#snippet description()}
    caret can alert you the moment a plan is ready for review — even when this tab is in the
    background.
  {/snippet}

  <p class="body">
    Turn on desktop notifications to get pinged for every new plan. You can change this any time from
    the bell in the top-right.
  </p>

  {#snippet footer()}
    <Button variant="ghost" onclick={dismiss}>Maybe later</Button>
    <Button onclick={enable}>Enable notifications</Button>
  {/snippet}
</Modal>

<style>
  .body {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-normal);
    color: var(--ink-soft);
  }
</style>
