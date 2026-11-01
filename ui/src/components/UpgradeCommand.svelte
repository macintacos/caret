<script lang="ts">
  // The upgrade command with its copy cap, shared by the settings Updates pane and the
  // What's new footer. A read-only field rather than a <pre>: the release command
  // overflows its box, and a field is focusable, scrolls under the arrow keys, and
  // selects only the command on select-all, all natively.
  import * as InputGroup from "$lib/components/ui/input-group/index.js";
  import CodeChromeTray from "@/components/CodeChromeTray.svelte";

  interface Props {
    command: string;
    /** Lands on the wrapper, for the caller's spacing. */
    class?: string;
    /** Clipboard writer; injectable so a test can observe it without a real clipboard. */
    copy?: (text: string) => Promise<void>;
  }
  let {
    command,
    class: className,
    copy = (t) => navigator.clipboard.writeText(t),
  }: Props = $props();
</script>

<!-- The plain wrapper is the scoped element the styles anchor on, so the :global
     reaches into the group parts below are bounded to this component. -->
<div class="upgrade-command {className ?? ''}">
  <InputGroup.Root class="settings-copy-box">
    <InputGroup.Input
      class="settings-copy-text"
      readonly
      value={command}
      aria-label="Upgrade command" />
    <InputGroup.Addon align="inline-end">
      <CodeChromeTray
        text={command}
        copyName="upgrade command"
        copyTooltip="Copy command"
        wrapName="in the upgrade command"
        wrappable={false}
        reflowed={false}
        onToggleReflow={() => {}}
        {copy} />
    </InputGroup.Addon>
  </InputGroup.Root>
</div>

<style>
  /* The group wears the sunk copy box, so the copy tray sits inside it. These unlayered
     rules beat the group's layered Tailwind sizing; the field carries the box's
     vertical padding so the whole box stays a click-to-focus target. */
  .upgrade-command :global([data-slot="input-group"]) {
    display: flex;
    height: auto;
    padding-block: 0;
    padding-right: 0.35rem;
  }
  .upgrade-command :global([data-slot="input-group-control"]) {
    height: auto;
    padding: 0.6rem 0.5rem 0.6rem 0;
  }
</style>
