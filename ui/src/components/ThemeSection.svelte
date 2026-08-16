<script lang="ts">
  // The Appearance pane's theme block (EXC-773): the Mode segmented control, then
  // BOTH theme slots — always visible, never hidden behind the current mode —
  // then one line saying which palette is showing and why.
  //
  // Both slots stay on screen because they are persistent settings, not a function
  // of the current mode; showing both is what teaches that the pairing exists. The
  // live one wears an IN USE pill, the block's single amber mark, which moves as
  // the mode changes or the OS flips. Which one that is comes from the live
  // appearance module, so the pill and the summary line track an OS flip while the
  // modal is open without a second subscription of this section's own.
  //
  // The shell renders this in place of the generic field rows for the Theme
  // section, and hands it that section's fields — which the /-search may have
  // filtered — so each row is rendered only when its field is present.
  import { appearance } from "@/state/appearance.svelte.ts";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldSeparator,
  } from "$lib/components/ui/field/index.js";
  import { type StagedField, THEME_FIELD } from "$lib/settingsRegistry.ts";
  import SettingSegmented from "@/components/SettingSegmented.svelte";
  import SettingSelect from "@/components/SettingSelect.svelte";

  interface Props {
    /** The Theme section's fields, in registry order and possibly search-filtered. */
    fields: readonly StagedField[];
    /** The shell's reactive mirror of every field's persisted value. */
    values: Record<string, unknown>;
    /** Apply a field's new value now (the shell persists + confirms with a toast). */
    onApply: (field: StagedField, value: unknown) => void;
  }
  let { fields, values, onApply }: Props = $props();

  // Which slot wears the pill: the live resolved scheme, so an OS flip moves it.
  const liveKey = $derived(appearance.scheme === "light" ? THEME_FIELD.light : THEME_FIELD.dark);

  // Render in registry order, skipping any field the search filtered out — so a
  // query matching one row shows that row alone rather than a broken block.
  const rows = $derived(
    [THEME_FIELD.mode, THEME_FIELD.light, THEME_FIELD.dark]
      .map((key) => fields.find((field) => field.key === key))
      .filter((field): field is StagedField => field !== undefined),
  );
</script>

<div class="theme-section" data-theme-section>
  <FieldGroup class="fields">
    {#each rows as field, i (field.key)}
      {#if i > 0}<FieldSeparator />{/if}
      <Field orientation="horizontal" data-field={field.key} class="setting-item">
        <FieldContent>
          <!-- A real <label> (EXC-1112). The mode row omits `for`: its control is a
               toggle group, a <div role="group">, which is not a labelable element —
               that row's group points back here with aria-labelledby instead. -->
          <FieldLabel
            id="setting-{field.key}-label"
            for={field.control.kind === "segmented" ? undefined : `setting-${field.key}`}
            class="field-label"
          >
            <span>{field.label}</span>
            {#if field.key === liveKey}
              <!-- The block's one amber mark: which palette is actually showing. It
                   unmounts from one row and mounts in the other as the live scheme
                   changes, which replays its reveal on arrival. -->
              <Badge class="in-use">In use</Badge>
            {/if}
          </FieldLabel>
          <FieldDescription>{field.description}</FieldDescription>
        </FieldContent>
        {#if field.control.kind === "segmented"}
          <SettingSegmented
            labelledBy="setting-{field.key}-label"
            value={String(values[field.key] ?? "")}
            options={field.control.options}
            onSelect={(v) => onApply(field, v)}
          />
        {:else if field.control.kind === "select"}
          <SettingSelect
            id="setting-{field.key}"
            value={String(values[field.key] ?? "")}
            options={field.control.options}
            onSelect={(v) => onApply(field, v)}
          />
        {/if}
      </Field>
    {/each}
  </FieldGroup>

  <!-- The resolved state in one sentence, so "why is it dark right now" never
       needs working out from the three controls above. -->
  <p class="resolved" data-theme-summary>{appearance.summary}</p>
</div>

<style>
  .theme-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  /* The row rhythm itself (group gap, row padding, the hairline separator) is NOT
     re-declared here: this section only ever renders inside the settings pane, and
     SettingsDialog's `.settings :global(…)` rules already reach these rows through the
     component boundary. One source for it means the two halves of the Appearance pane
     cannot drift into two treatments. What stays below is what is genuinely this
     section's own. */
  /* The label line carries the moving IN USE pill beside its text. */
  .theme-section :global(.setting-item .field-label) {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  /* IN USE: an amber-wash pill in the eyebrow's uppercase treatment. The label is
     written in sentence case and uppercased here, so it is announced as words
     rather than spelled out. The reveal replays each time it moves rows; the
     global reduced-motion guard reaches it through the [data-slot] anchor. */
  .theme-section :global(.in-use) {
    border: 0;
    padding: 0.1rem 0.4rem;
    background: var(--accent-wash);
    color: var(--accent);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    animation: in-use-in var(--dur-micro) var(--ease-out);
  }
  .resolved {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--ink-faint);
  }

  @keyframes in-use-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }
</style>
