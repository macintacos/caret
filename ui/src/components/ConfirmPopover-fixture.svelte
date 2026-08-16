<script lang="ts">
  // Test-only fixture: ConfirmPopover takes its trigger as a snippet, and the mount
  // harness passes props rather than children — so the composed case needs a
  // component to declare the snippet in. Same shape and same reason as
  // $lib/shadcn-command-popover-fixture.svelte. Not shipped; lives beside its test.
  import ConfirmPopover from "@/components/ConfirmPopover.svelte";

  let {
    question = "Discard this comment?",
    confirmLabel = "Discard",
    cancelLabel,
    onConfirm = () => {},
  }: {
    question?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
  } = $props();
</script>

<ConfirmPopover {question} {confirmLabel} {cancelLabel} {onConfirm}>
  {#snippet trigger(props)}
    <button {...props} type="button" class="fixture-trigger">Discard</button>
  {/snippet}
</ConfirmPopover>
