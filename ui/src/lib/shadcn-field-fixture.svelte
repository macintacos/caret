<script lang="ts">
  // Test-only fixture: one Field wrapping a labelled control and its description,
  // the shape EXC-1112 gives the settings rows. The control is a bare <input>
  // rather than the vendored one — what is under test is the label→control
  // association Field brings, not the input tree. Not shipped; lives beside its
  // test like shadcn-command-popover-fixture.svelte.
  import * as Field from "$lib/components/ui/field/index.js";
</script>

<Field.Field>
  <Field.Label for="fixture-display-name">Display name</Field.Label>
  <input id="fixture-display-name" type="text" />
  <Field.Description>Shown beside your comments.</Field.Description>
</Field.Field>
