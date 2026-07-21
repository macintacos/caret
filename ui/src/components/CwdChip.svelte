<script lang="ts">
  // The active review's working directory, shown in the top-bar lead as a
  // click-to-copy chip (EXC-850). It displays the abbreviated path (shortCwd)
  // but copies the FULL absolute path; App.svelte owns the clipboard write and
  // fires the success alert. There is deliberately NO hover popup/tooltip — the
  // float-chip fill is the affordance, and the success alert is the
  // confirmation. Composed from the shadcn Button in the topbar's neutral
  // .float-chip language, matching the ReviewSwitcher trigger it sits beside.
  import { shortCwd } from "$lib/cwd.ts";
  import { Button } from "$lib/components/ui/button/index.js";

  let { cwd, onCopy }: { cwd: string; onCopy: (cwd: string) => void } = $props();
</script>

<Button
  variant="secondary"
  size="sm"
  class="cwd-chip float-chip mono"
  aria-label={`Copy path ${cwd} to the clipboard`}
  onclick={() => onCopy(cwd)}
>
  {shortCwd(cwd)}
</Button>

<style>
  /* Cap the abbreviated path at a comfortable width and ellipsize an unusually
     long leaf, so it never pushes the right-hand topbar controls. Color + hover
     ride the .float-chip atom (app.css); .mono owns the family. :global because
     the class rides the shadcn Button root, which carries no scope hash. */
  :global(.cwd-chip) {
    max-width: 16rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
