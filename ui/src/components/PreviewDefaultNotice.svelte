<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";

  interface Props {
    anchor: HTMLElement | null;
    open: boolean;
    onDismiss: () => void;
  }

  let { anchor, open, onDismiss }: Props = $props();
</script>

<!-- A passive notice: it neither traps nor takes focus, or the plan shortcuts die, and
     only "Got it" or the first use of Source ends it — an outside click or Escape does
     not, so a reload before either shows it again. -->
{#if anchor}
  <Popover.Root {open}>
    <Popover.Content
      class="preview-default-notice"
      customAnchor={anchor}
      side="bottom"
      align="end"
      trapFocus={false}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      onInteractOutside={(e) => e.preventDefault()}
      onEscapeKeydown={(e) => e.preventDefault()}
    >
      <p>
        Preview is now the default. Press S or click Source to see the plan's markdown. (P no
        longer toggles.)
      </p>
      <div class="actions">
        <Button variant="secondary" size="sm" class="float-chip" onclick={onDismiss}>Got it</Button>
      </div>
    </Popover.Content>
  </Popover.Root>
{/if}

<style>
  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
