<script lang="ts">
  // First-run onboarding (EXC-781): a one-time modal that explains desktop
  // notifications and offers to turn them on. App gates it via
  // shouldShowOnboarding() — shown only to a brand-new user whose permission is
  // still undecided. Composes the shared Modal shell (the SettingsDialog analog);
  // this file is only the copy + the two actions.
  import { Button } from "$lib/components/ui/button/index.js";
  import { uiLog } from "../lib/log.ts";
  import { markOnboarded } from "../lib/prefs.ts";
  import Modal from "./Modal.svelte";

  interface Props {
    /** Dismiss the modal — App flips its {#if} gate. */
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  // Both paths record onboarding as seen so it never reappears, then close. The
  // bell re-reads Notification.permission on the permission-change event, so a
  // grant here turns it green without a reload.
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

<Modal kind="dialog" open eyebrow="Welcome to caret" title="Desktop notifications" onDismiss={dismiss}>
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
