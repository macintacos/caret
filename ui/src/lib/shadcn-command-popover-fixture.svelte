<script lang="ts">
  // Test-only fixture: an open shadcn Popover whose content hosts a Command list,
  // the composition the ToC popup and the breadcrumbs retrofit both build on. Two
  // things need a real mount to be provable — that the vendored copies resolve
  // against the installed bits-ui, and that the icon swap in command-input /
  // command-item renders a glyph rather than nothing. Not shipped; lives beside
  // its test, like shadcn-dialog-fixture.svelte.
  import * as Command from "$lib/components/ui/command/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";

  let { open = false }: { open?: boolean } = $props();
</script>

<Popover.Root bind:open>
  <Popover.Trigger>Open</Popover.Trigger>
  <Popover.Content>
    <Command.Root>
      <Command.Input placeholder="Jump to section" />
      <Command.List>
        <Command.Empty>No sections</Command.Empty>
        <!-- `headingClass` is caret's own addition to the vendored command-group,
             carried here with a sentinel value so the suite can prove it reaches
             the heading element. -->
        <Command.Group heading="Sections" headingClass="fixture-eyebrow">
          <Command.Item value="overview">Overview</Command.Item>
          <Command.Item value="details">Details</Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
