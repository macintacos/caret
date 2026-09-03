<script lang="ts">
  // The control a staged settings field renders as, chosen by its registry
  // `control.kind`. Both surfaces that draw settings rows — the generic pane rows
  // and the Appearance pane's ThemeSection — render through this, so a new control
  // kind reaches both at once.
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { settingControlId, settingLabelId, type StagedField } from "$lib/settingsRegistry.ts";
  import SettingSegmented from "@/components/SettingSegmented.svelte";
  import SettingSelect from "@/components/SettingSelect.svelte";
  import SettingSlider from "@/components/SettingSlider.svelte";

  interface Props {
    field: StagedField;
    /** The field's persisted value, from the shell's reactive mirror. */
    value: unknown;
    /** Apply a new value now (the shell persists, re-reads, and confirms). */
    onApply: (field: StagedField, value: unknown) => void | Promise<void>;
  }
  let { field, value, onApply }: Props = $props();
</script>

{#if field.control.kind === "select"}
  <SettingSelect
    id={settingControlId(field.key)}
    value={String(value ?? "")}
    options={field.control.options}
    onSelect={(v) => onApply(field, v)}
  />
{:else if field.control.kind === "segmented"}
  <SettingSegmented
    labelledBy={settingLabelId(field.key)}
    value={String(value ?? "")}
    options={field.control.options}
    onSelect={(v) => onApply(field, v)}
  />
{:else if field.control.kind === "slider"}
  <!-- Named through the row's label like the segmented control, and for the same
       reason: the slider's root is a <span>, which `<label for>` cannot bind to.
       `??` rather than `||` on the fallback — 0 is a real volume, and `||` would
       swap silence for the default. -->
  <SettingSlider
    labelledBy={settingLabelId(field.key)}
    value={Number(value ?? 0)}
    onSelect={(v) => onApply(field, v)}
  />
{:else}
  <!-- Bound through a getter/setter pair, not a one-way `checked` + onCheckedChange:
       bits-ui's Switch keeps its own copy, so a plain prop lets a click flip the
       control while the shell still holds the old value — and re-seeding the mirror to
       the same value pushes nothing back, so a write that never landed would leave the
       switch showing a state that was never persisted. Same shape as
       SettingSegmented's toggle group, for the same reason. -->
  <Switch
    id={settingControlId(field.key)}
    bind:checked={() => value === true, (v) => onApply(field, v)}
  />
{/if}
