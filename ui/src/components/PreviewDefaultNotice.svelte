<script lang="ts">
  // A passive notice: it neither traps nor takes focus, or the plan shortcuts die, and
  // only "Got it" or the first use of Source ends it — an outside click or Escape does
  // not, so a reload before either shows it again. Escape still reaches the plan below.
  import { Popover as PopoverPrimitive } from "bits-ui";

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
      <PopoverPrimitive.Arrow data-slot="popover-arrow" style="display: block; width: 24px; height: 12px">
        <span class="nub"></span>
      </PopoverPrimitive.Arrow>
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
  /* bits-ui aims the arrow box at the anchor with its base on the panel edge, drawn
     pointing down and rotated to face the anchor. The nub is a square turned 45deg, centred
     on that edge: its top half overlaps the panel and hides the panel's ring there, and only
     its two outer edges carry the ring, so the hairline runs round the nub unbroken. */
  .nub {
    position: absolute;
    top: -8.5px;
    left: 3.5px;
    width: 17px;
    height: 17px;
    rotate: 45deg;
    background: var(--popover);
    border-right: 1px solid color-mix(in oklab, var(--foreground) 10%, transparent);
    border-bottom: 1px solid color-mix(in oklab, var(--foreground) 10%, transparent);
    border-bottom-right-radius: 4px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
