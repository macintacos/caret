<script lang="ts">
  // Test-only fixture (not shipped): the mount harness renders once and cannot set
  // a prop afterwards, but the contract under test is what a CHANGED annotations
  // prop does. Flipping `swapped` from a button changes the list the thread receives
  // inside the component tree, the only place a keyed block can be observed.
  import type { LineAnnotation } from "@core/lib/types";
  import SourceAnnotationThread from "@/components/SourceAnnotationThread.svelte";

  interface Props {
    /** The comment the line carries first. */
    first: LineAnnotation;
    /** The comment that replaces it, as another review's would arrive. */
    second: LineAnnotation;
  }
  let { first, second }: Props = $props();

  let swapped = $state(false);
  const annotations = $derived(swapped ? [second] : [first]);
</script>

<button type="button" class="swap" onclick={() => (swapped = true)}>swap</button>
<SourceAnnotationThread
  {annotations}
  focusedAnnotation={null}
  onFocus={() => {}}
  onEdit={() => {}}
  onDelete={() => {}}
/>
