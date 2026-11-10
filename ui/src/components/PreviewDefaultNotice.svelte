<script lang="ts">
  // A passive notice: it neither traps nor takes focus, or the plan shortcuts die, and
  // only "Got it" or the first use of Source ends it — an outside click or Escape does
  // not, so a reload before either shows it again. Escape still reaches the plan below.
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";

  interface Props {
    /** The Source button the notice hangs from; nothing renders until it exists. */
    anchor: HTMLElement | null;
    /** Whether the notice shows. */
    open: boolean;
    /** Called by "Got it": ends the notice for good. */
    onDismiss: () => void;
  }

  let { anchor, open, onDismiss }: Props = $props();
</script>

{#if anchor}
  <Popover.Root {open}>
    <Popover.Content
      role="dialog"
      aria-label="Preview is now the default"
      customAnchor={anchor}
      side="bottom"
      align="end"
      trapFocus={false}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      onInteractOutside={(e) => e.preventDefault()}
      onEscapeKeydown={(e) => {
        e.preventDefault();
        // bits-ui has already prevented the real Escape, which the plan's shortcuts skip.
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      }}
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
