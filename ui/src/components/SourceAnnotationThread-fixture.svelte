<script lang="ts">
  // Test-only fixture (not shipped): the mount harness renders once and cannot set
  // a prop afterwards, but the contract under test is what a CHANGED annotations
  // prop does. Swapping a $state list from a button reproduces that update inside
  // the component tree, the only place a keyed block can be observed. Same shape
  // and reason as ConfirmPopover-fixture.svelte.
  import type { LineAnnotation } from "@core/lib/types";
  import SourceAnnotationThread from "@/components/SourceAnnotationThread.svelte";

  interface Props {
    /** The comment the line carries first. */
    first: LineAnnotation;
    /** The comment that replaces it, as another review's would arrive. */
    second: LineAnnotation;
  }
  let { first, second }: Props = $props();

  let annotations = $state<LineAnnotation[]>([first]);
</script>

<button type="button" class="swap" onclick={() => (annotations = [second])}>swap</button>
<SourceAnnotationThread
  {annotations}
  focusedAnnotation={null}
  onFocus={() => {}}
  onEdit={() => {}}
  onDelete={() => {}}
/>
