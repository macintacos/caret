<script lang="ts">
  // Test-only fixture: a single-select whose content holds one group of two
  // options, the shape EXC-1111 rebuilds SettingSelect on. The harness takes
  // props rather than children, so a composed primitive needs a fixture; this one
  // lives beside its test like shadcn-command-popover-fixture.svelte. Not shipped.
  import * as Select from "$lib/components/ui/select/index.js";

  let { open = false, value = "dark" }: { open?: boolean; value?: string } = $props();
</script>

<Select.Root type="single" bind:open bind:value>
  <Select.Trigger aria-label="Theme">{value}</Select.Trigger>
  <Select.Content>
    <Select.Group>
      <Select.GroupHeading>Themes</Select.GroupHeading>
      <Select.Item value="light" label="Light" />
      <Select.Item value="dark" label="Dark" />
    </Select.Group>
  </Select.Content>
</Select.Root>
