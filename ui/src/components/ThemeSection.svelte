<script lang="ts">
  // The Appearance pane's theme block (EXC-773): the Mode segmented control, then
  // BOTH theme slots — always visible, never hidden behind the current mode —
  // then one line saying which palette is showing and why.
  //
  // Both slots stay on screen because they are persistent settings, not a function
  // of the current mode; showing both is what teaches that the pairing exists. The
  // live one wears an IN USE pill, the block's single amber mark. Which one that is
  // comes from the live appearance module, so the pill and the summary line track an
  // OS flip while the modal is open without a subscription of this section's own. The
  // slot rows read the live appearance too, so a slot settled by a late-loading custom
  // theme shows its real selection.
  //
  // The shell renders this in place of the generic field rows for the Theme
  // section, and hands it that section's fields — which the /-search may have
  // filtered — so each row is rendered only when its field is present.
  //
  // It renders ONLY inside the settings pane, and leans on that: the row rhythm
  // (group gap, row padding, the hairline separator) is declared once in
  // SettingsDialog's `.settings :global(…)` rules, which reach these rows through the
  // component boundary — so this component is not self-sufficient elsewhere. A second
  // consumer moves that rhythm into a caret-owned stylesheet keyed on
  // `[data-slot="field"].setting-item` rather than copying it back here; key on the
  // data-slot as well as the class, because SettingSelect puts `.setting-item` on its
  // portalled menu rows too.
  import type { ThemeFileError } from "@core/lib/types";
  import { appearance } from "@/state/appearance.svelte.ts";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldSeparator,
  } from "$lib/components/ui/field/index.js";
  import {
    settingLabelId,
    settingLabelTarget,
    type StagedField,
    THEME_FIELD,
  } from "$lib/settingsRegistry.ts";
  import SettingControl from "@/components/SettingControl.svelte";

  interface Props {
    /** The Theme section's fields, in registry order and possibly search-filtered. */
    fields: readonly StagedField[];
    /** The custom theme files that failed to load, listed under the summary line. */
    errors: readonly ThemeFileError[];
    /** Apply a field's new value now (the shell persists + confirms with a toast).
     * The shell's own `apply` owns the await; these call sites just hand it off. */
    onApply: (field: StagedField, value: unknown) => void | Promise<void>;
  }
  let { fields, errors, onApply }: Props = $props();

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
      <Field
        orientation="horizontal"
        data-field={field.key}
        class="setting-item"
        aria-labelledby={settingLabelId(field.key)}
      >
        <FieldContent>
          <!-- A real <label> (EXC-1112). The mode row omits `for`: its control is a
               toggle group, a <div role="group">, which is not a labelable element —
               that row's group points back here with aria-labelledby instead. -->
          <FieldLabel
            id={settingLabelId(field.key)}
            for={settingLabelTarget(field)}
            class="field-label"
          >
            <span>{field.label}</span>
            {#if field.key === liveKey}
              <!-- The block's one amber mark: which palette is actually showing.
                   aria-hidden is load-bearing: this pill sits INSIDE the row's <label>,
                   and a <button> takes its name from its label — so without it the slot
                   trigger would be named "Dark theme In use", a name that silently moves
                   between the two rows on an OS flip. The resolved-state line below is
                   how that reaches a screen reader instead. -->
              <Badge class="in-use" aria-hidden="true">In use</Badge>
            {/if}
          </FieldLabel>
          <FieldDescription>{field.description}</FieldDescription>
        </FieldContent>
        <SettingControl {field} value={field.read()} {onApply} />
      </Field>
    {/each}
  </FieldGroup>

  <!-- The resolved state in one sentence, so "why is it dark right now" never
       needs working out from the three controls above. -->
  <p class="resolved" data-theme-summary>{appearance.summary}</p>

  {#if errors.length > 0}
    <Alert.Root variant="destructive" class="theme-errors" data-theme-errors>
      <Alert.Title>These theme files didn't load</Alert.Title>
      <Alert.Description>
        <ul class="error-list">
          {#each errors as error (error.file)}
            <li>
              <code class="error-file">{error.file}</code>
              {#each error.messages as message, i (i)}<p>{message}</p>{/each}
            </li>
          {/each}
        </ul>
      </Alert.Description>
    </Alert.Root>
  {/if}
</div>

<style>
  .theme-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  /* The label line carries the moving IN USE pill beside its text — the row's type is
     SettingsDialog's, so only the pill's layout is declared here. */
  .theme-section :global(.setting-item .field-label) {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  /* IN USE: an amber-wash pill in the eyebrow's uppercase treatment. The label is
     written in sentence case and uppercased here, so it is announced as words rather
     than spelled out. The pill unmounts from one row and mounts in the other as the
     live scheme changes, which replays the reveal on arrival. */
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

  .theme-section :global(.theme-errors) {
    margin-top: 0.25rem;
    font-size: var(--text-xs);
  }
  .error-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .error-list p {
    margin: 0;
  }
  .error-file {
    font-family: var(--font-mono);
    color: var(--ink);
  }

  @keyframes in-use-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }
</style>
