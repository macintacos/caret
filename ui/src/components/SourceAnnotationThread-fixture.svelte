<script lang="ts">
  // Test-only fixture: the mount harness renders once and has no way to set a prop
  // afterwards, but the contract under test is what a CHANGED annotations prop does
  // — the review switch that hands one source line a different comment. Owning the
  // list in $state and swapping it from a button reproduces that update inside the
  // component tree, which is the only place a keyed block can be observed. Not
  // shipped; lives beside its test, same shape and reason as
  // ConfirmPopover-fixture.svelte.
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
