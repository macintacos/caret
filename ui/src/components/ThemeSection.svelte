<script lang="ts">
  // The Appearance pane's theme block (EXC-773): the Mode segmented control, then
  // BOTH theme slots — always visible, never hidden behind the current mode —
  // then one line saying which palette is showing and why.
  //
  // Both slots stay on screen because they are persistent settings, not a function
  // of the current mode; showing both is what teaches that the pairing exists. The
  // live one wears an IN USE pill, the block's single amber mark, which moves as
  // the mode changes or the OS flips. The section owns its own OS-preference
  // subscription so the pill and the summary line track a flip while the modal is
  // open, without the shell having to thread the preference down.
  //
  // The shell renders this in place of the generic field rows for the Theme
  // section, and hands it that section's fields — which the /-search may have
  // filtered — so each row is rendered only when its field is present.
  import {
    DEFAULT_MODE,
    DEFAULT_SLOT_THEME,
    appearanceSummary,
    resolveScheme,
    systemPrefersDark,
    type ThemeMode,
    watchSystemScheme,
  } from "$lib/appearance.ts";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemGroup,
    ItemSeparator,
    ItemTitle,
  } from "$lib/components/ui/item/index.js";
  import { type StagedField, THEME_FIELD } from "$lib/settingsRegistry.ts";
  import { THEMES, type ThemeId } from "$lib/theme.ts";
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

  // The OS preference, kept live: under `system` a flip changes which slot is in
  // use, and the reviewer may be looking right at these two rows when it happens.
  let prefersDark = $state(systemPrefersDark());
  $effect(() => watchSystemScheme((next) => (prefersDark = next)));

  const mode = $derived((values[THEME_FIELD.mode] as ThemeMode | undefined) ?? DEFAULT_MODE);
  const slots = $derived({
    light: (values[THEME_FIELD.light] as ThemeId | undefined) ?? DEFAULT_SLOT_THEME.light,
    dark: (values[THEME_FIELD.dark] as ThemeId | undefined) ?? DEFAULT_SLOT_THEME.dark,
  });

  const scheme = $derived(resolveScheme(mode, prefersDark));
  const liveKey = $derived(scheme === "light" ? THEME_FIELD.light : THEME_FIELD.dark);
  const summary = $derived(appearanceSummary(mode, scheme, THEMES[slots[scheme]].label));

  // Render in registry order, skipping any field the search filtered out — so a
  // query matching one row shows that row alone rather than a broken block.
  const rows = $derived(
    [THEME_FIELD.mode, THEME_FIELD.light, THEME_FIELD.dark]
      .map((key) => fields.find((field) => field.key === key))
      .filter((field): field is StagedField => field !== undefined),
  );
</script>

<div class="theme-section" data-theme-section data-scheme={scheme}>
  <ItemGroup class="fields">
    {#each rows as field, i (field.key)}
      {#if i > 0}<ItemSeparator />{/if}
      <Item data-field={field.key} class="setting-item">
        <ItemContent>
          <ItemTitle class="field-label">
            <span>{field.label}</span>
            {#if field.key === liveKey}
              <!-- The block's one amber mark: which palette is actually showing.
                   Keyed on liveKey so it re-mounts (and replays its reveal) when it
                   moves between the two rows. -->
              <Badge class="in-use">In use</Badge>
            {/if}
          </ItemTitle>
          <ItemDescription>{field.description}</ItemDescription>
        </ItemContent>
        <ItemActions>
          {#if field.control.kind === "segmented"}
            <SettingSegmented
              value={String(values[field.key] ?? "")}
              options={field.control.options}
              onSelect={(v) => onApply(field, v)}
              ariaLabel={field.label}
            />
          {:else if field.control.kind === "select"}
            <SettingSelect
              value={String(values[field.key] ?? "")}
              options={field.control.options}
              onSelect={(v) => onApply(field, v)}
              ariaLabel={field.label}
            />
          {/if}
        </ItemActions>
      </Item>
    {/each}
  </ItemGroup>

  <!-- The resolved state in one sentence, so "why is it dark right now" never
       needs working out from the three controls above. -->
  <p class="resolved" data-theme-summary>{summary}</p>
</div>

<style>
  .theme-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  /* Match the pane's own field rhythm — the rows here and the Diff view rows
     below are one list, not two treatments. */
  .theme-section :global(.fields) {
    gap: 0;
  }
  .theme-section :global(.setting-item) {
    padding-left: 0;
    padding-right: 0;
  }
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
    animation: in-use-in var(--dur-fast) var(--ease-out);
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
