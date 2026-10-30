<script lang="ts">
  // The two-pane Settings shell (EXC-843): a shadcn Sidebar as the category rail
  // left, the selected category's pane right. Every edit applies IMMEDIATELY — the
  // pane calls onChange the moment a control changes and App persists + confirms
  // with a toast; there is no staged draft, no Save/Discard. A category's fields are
  // sub-grouped into labelled sections (Diff view lives as a section under
  // Appearance), each a FieldGroup of shadcn Fields.
  //
  // Two shadcn primitives carry the layout (compose-first, per doc/agents/shadcn-rules):
  //   • Sidebar (collapsible="none") — the static category rail, flat on the sheet. The
  //     SELECTED row is stamped into the sheet in full ink: a place you are, not a key.
  //     Below 640px the rail folds into a bar of a section picker, a search key and a
  //     close key.
  //   • Field / FieldSet (EXC-1112) — one Field per setting (label + description +
  //     control), hairline-separated within a FieldGroup recessed into the sheet, so a
  //     section reads as a table of settings. A LABELLED section wraps its
  //     FieldGroup in a FieldSet whose FieldLegend is the header; an unlabelled one
  //     stays a plain div, since a fieldset with no legend is a group with no name.
  //     The FieldLabel is a real <label>, so the visible text IS each control's
  //     accessible name and clicking it reaches the control; no settings control
  //     carries an aria-label. settingsRegistry.ts owns the label↔control id wiring.
  //
  // shadcn's Field spacing is looser than caret's dense rows, and the retune for it
  // lives HERE rather than in the vendored tv() recipe: shadcn-rules.md § Adding a
  // component that collides with the vendored tree makes a re-sync's revert
  // wholesale, so an edit inside field.svelte is undone silently with nothing to
  // catch it. Svelte does not scope-hash a class handed to a COMPONENT, so every one of
  // those rules is written in the `.settings :global(…)` form.
  //
  // The Dialog primitive is composed directly rather than Modal.svelte — Modal's
  // eyebrow/title/footer identity doesn't fit the two-pane layout — keeping a
  // visually-hidden Dialog.Title so the dialog's accessible name is "Settings".
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSeparator,
    FieldSet,
  } from "$lib/components/ui/field/index.js";
  import * as InputGroup from "$lib/components/ui/input-group/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { claimSlashForSearch } from "$lib/modalStack.ts";
  import { SETTINGS_SHORTCUTS, shortcuts } from "$lib/shortcuts/index.ts";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import {
    filterSettings,
    isStagedField,
    SETTINGS_CATEGORIES,
    type SettingEntry,
    settingLabelId,
    settingLabelTarget,
    type StagedField,
    THEME_SECTION,
    UPDATES_CATEGORY,
  } from "$lib/settingsRegistry.ts";
  import AdvancedPane from "@/components/AdvancedPane.svelte";
  import Icon from "@/components/Icon.svelte";
  import NotificationsPane from "@/components/NotificationsPane.svelte";
  import SettingControl from "@/components/SettingControl.svelte";
  import SettingSelect from "@/components/SettingSelect.svelte";
  import ThemeSection from "@/components/ThemeSection.svelte";
  import UpdatesPane from "@/components/UpdatesPane.svelte";
  import type { ThemeFileError, UpdateReport } from "@core/lib/types";

  interface Props {
    /** Controlled open — false while the dialog plays its exit. */
    open: boolean;
    /** The surface finished its exit and may be unmounted. */
    onClosed?: () => void;
    /** The registry, grouped into categories/sections and rendered by control kind. */
    entries: readonly SettingEntry[];
    /** Apply a setting's new value now (App: write + resync + confirming toast).
     * May be async — a daemon-backed field's write is a round trip (EXC-1206) — and
     * the shell awaits it before re-reading the field. */
    onChange: (field: StagedField, value: unknown) => void | Promise<void>;
    /** Dismiss (Escape / backdrop). App hides the modal. */
    onClose: () => void;
    /** Opens the What's new modal from the Updates pane. */
    onWhatsNew?: () => void;
    /** Whether an update is waiting, badging the Updates rail row (EXC-1207). */
    updatePending?: boolean;
    /** The daemon's update verdict, rendered by the Updates pane — the reviewer's live
     * `updates.check` already folded in. Null when it could not be read; the pane
     * degrades rather than erroring. */
    updateReport?: UpdateReport | null;
    /** The custom theme files that failed to load, listed in the Appearance pane. Empty
     * until the daemon's themes arrive, and when its read fails. */
    themeErrors?: readonly ThemeFileError[];
    /** Receives the folder's load errors as they stand after a theme upload saves. */
    onThemeErrors?: (errors: readonly ThemeFileError[]) => void;
  }
  let {
    open,
    onClosed,
    entries,
    onChange,
    onClose,
    onWhatsNew = () => {},
    updatePending = false,
    updateReport = null,
    themeErrors = [],
    onThemeErrors = () => {},
  }: Props = $props();

  // EXC-849: while Settings owns the view, publish its keyboard affordances into the shared
  // registry. Display-only (no run) — the modal handles `/` and Esc itself below. Registering
  // the reservations is what makes the scoped `?` help list exactly the shortcuts valid here,
  // and their "settings" scope is what suppresses the review shortcuts while this is open.
  $effect(() => {
    const offs = SETTINGS_SHORTCUTS.map((e) => shortcuts.register(e));
    return () => {
      for (const off of offs) off();
    };
  });

  // The search query (EXC-845): filters the registry across categories, mirroring
  // ShortcutsHelp's filter-then-group. The input is bound so the `/`-to-focus handler
  // can move focus into it.
  let query = $state("");
  let searchInput = $state<HTMLInputElement | null>(null);

  // Filter first, then derive. A category earns a nav row when it has ANY matching entry —
  // staged or search-only — so filtering drops emptied categories and an empty query
  // restores the full nav.
  const filtered = $derived(filterSettings(entries, query));
  const staged = $derived(filtered.filter(isStagedField));
  const categories = $derived(
    SETTINGS_CATEGORIES.filter((c) => filtered.some((e) => e.category === c.id)),
  );

  let selectedId = $state(SETTINGS_CATEGORIES[0]?.id ?? "");
  const selected = $derived(categories.find((c) => c.id === selectedId) ?? categories[0]);
  const paneFields = $derived(staged.filter((f) => f.category === selected?.id));
  const sectionOptions = $derived(categories.map((c) => ({ value: c.id, label: c.id })));

  // Sub-group the pane's fields into labelled sections, preserving registry order: a
  // new group starts whenever the section label changes (sectionless fields lead).
  const paneSections = $derived.by(() => {
    const groups: { label: string | undefined; fields: StagedField[] }[] = [];
    for (const f of paneFields) {
      const last = groups[groups.length - 1];
      if (last && last.label === f.section) last.fields.push(f);
      else groups.push({ label: f.section, fields: [f] });
    }
    return groups;
  });

  // A reactive mirror of each field's persisted value so the controls re-render when
  // a change applies (read() reads localStorage, which Svelte can't track). Seeded
  // once from read() (the registry is static within a mount, so capturing the initial
  // `entries` is intentional) and re-seeded per field after each change: on success it
  // reflects the new value, on a failed write it snaps the control back to unchanged.
  // ThemeSection reads the appearance's `$state` live instead, so it takes no `values`.
  // svelte-ignore state_referenced_locally
  let values = $state<Record<string, unknown>>(
    Object.fromEntries(entries.filter(isStagedField).map((f) => [f.key, f.read()])),
  );

  // Awaited: a daemon-backed field's write is a round trip (EXC-1206), so re-reading
  // before it settles would re-seed the control from the pre-write value and leave it
  // there. `finally` rather than a bare await, so the re-read happens however onChange
  // ends — on success it shows the new value, on a refusal it re-seeds from what is
  // actually persisted, which is the snap-back.
  async function apply(field: StagedField, value: unknown): Promise<void> {
    try {
      await onChange(field, value);
    } finally {
      values = { ...values, [field.key]: field.read() };
    }
  }

  function focusContent(): void {
    document.querySelector<HTMLElement>(".settings-content")?.focus();
  }

  // Land focus on the dialog content (not the first control), matching ShortcutsHelp:
  // Esc dismisses "with nothing focused", and EXC-845's `/` search relies on focus
  // resting on the content.
  function focusDialog(e: Event): void {
    e.preventDefault();
    focusContent();
  }

  // EXC-845 / EXC-849: while the modal is open, `/` focuses its search input rather
  // than the global plan search.
  $effect(() => claimSlashForSearch(() => searchInput));

  // EXC-845: Esc is two-stage. When the search input owns focus, Esc clears the query and
  // returns focus to the dialog content — preventDefault cancels bits-ui's close (its
  // Dialog.Content runs onEscapeKeydown, then closes only if the event wasn't
  // defaultPrevented). A second Esc, now with focus on the content rather than the input,
  // falls through and dismisses — matching ShortcutsHelp's "Esc with nothing focused".
  function onEscapeKeydown(e: KeyboardEvent): void {
    if (document.activeElement !== searchInput) return;
    e.preventDefault();
    query = "";
    focusContent();
  }
</script>

<!-- The host mounts this per open (ModalPresence) and keeps it through the exit, so
     onOpenChangeComplete is what tells it the exit is done and the component may go. -->
<Dialog.Root
  {open}
  onOpenChange={(o) => { if (!o) onClose(); }}
  onOpenChangeComplete={(o) => { if (!o) onClosed?.(); }}
>
  <Dialog.Content
    showCloseButton={false}
    onOpenAutoFocus={focusDialog}
    {onEscapeKeydown}
    class="settings-content"
  >
    <!-- Visually hidden: keeps the dialog's accessible name "Settings" without a
         header band. The visible title is the per-category pane header. -->
    <Dialog.Title class="sr-only">Settings</Dialog.Title>

    <div class="settings" data-query={query === "" ? undefined : ""}>
      <Sidebar.Root collapsible="none" class="settings-rail">
        <!-- The narrow bar, shown below 640px in place of the rail's list. A phone has no
             Esc, so the close key is its way out. The search key only moves focus: the
             field reveals itself while focused or holding a query. -->
        <div class="settings-bar">
          <label for="settings-section" class="sr-only">Section</label>
          <div class="section-pick">
            <SettingSelect
              id="settings-section"
              value={selected?.id ?? ""}
              options={sectionOptions}
              onSelect={(id) => (selectedId = id)}
            />
          </div>
          <span class="tray">
            <Button
              variant="secondary"
              size="icon"
              class="float-chip"
              aria-label="Search settings"
              onclick={() => searchInput?.focus()}
            >
              <Icon name="search" size={15} />
            </Button>
          </span>
          <span class="tray">
            <Dialog.Close>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="secondary"
                  size="icon"
                  class="float-chip"
                  aria-label="Close settings"
                >
                  <Icon name="x" size={15} />
                </Button>
              {/snippet}
            </Dialog.Close>
          </span>
        </div>
        <!-- Search atop the rail (EXC-845), mirroring ShortcutsHelp's search field. The
             key hints ride an InputGroup inline-end addon (EXC-1113), which reserves its
             own track beside the control: `/` at rest, and `esc`, which clears the field,
             while it has focus. The addons carry the aria-hidden rather than their
             contents: each is a role="group", and one holding nothing announceable reads
             as an empty group. -->
        <Sidebar.Header class="settings-search">
          <InputGroup.Root class="field-well">
            <InputGroup.Addon align="inline-start" aria-hidden="true">
              <Icon name="search" size={14} />
            </InputGroup.Addon>
            <InputGroup.Input
              type="text"
              placeholder="Search settings…"
              aria-label="Search settings"
              bind:value={query}
              bind:ref={searchInput}
            />
            <InputGroup.Addon align="inline-end" aria-hidden="true">
              <Kbd class="key-rest">/</Kbd>
              <Kbd class="key-focused">esc</Kbd>
            </InputGroup.Addon>
          </InputGroup.Root>
        </Sidebar.Header>
        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.Menu>
              {#each categories as cat (cat.id)}
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton
                    isActive={cat.id === selected?.id}
                    data-category={cat.id}
                    aria-current={cat.id === selected?.id ? "page" : undefined}
                    onclick={() => (selectedId = cat.id)}
                  >
                    <span class="nav-label">{cat.id}</span>
                  </Sidebar.MenuButton>
                  <!-- The pending-update mark on the Updates row (EXC-1207). MenuBadge is
                       pointer-events:none, so it can't shadow the row's own click. It stays
                       decorative because the pane it points at says the same in words. -->
                  {#if updatePending && cat.id === UPDATES_CATEGORY}
                    <Sidebar.MenuBadge aria-hidden="true">
                      <span class="rail-dot"></span>
                    </Sidebar.MenuBadge>
                  {/if}
                </Sidebar.MenuItem>
              {/each}
            </Sidebar.Menu>
          </Sidebar.Group>
        </Sidebar.Content>
        <Sidebar.Footer>
          <p class="nav-hint" aria-hidden="true"><Kbd>esc</Kbd> <span>close</span></p>
        </Sidebar.Footer>
      </Sidebar.Root>

      <section class="settings-pane">
        {#if !selected}
          <!-- Empty state (EXC-845): a search that matches nothing lands here instead of
               a blank pane, so the dialog never reads as a broken dead-end. -->
          <p class="pane-empty">No settings match your search.</p>
        {:else}
          <header class="pane-head">
            <h2 class="pane-title">{selected.id}</h2>
            <p class="pane-blurb">{selected.blurb}</p>
          </header>

          <!-- Advanced's live pane replaces staged fields; Updates' and Notifications' sit
               ABOVE theirs, which stay ordinary registry fields. Id branches beat a
               category→component map here: the panes take different props, which a map
               can't thread. -->
          {#if selected.id === "Advanced"}
            <AdvancedPane />
          {:else}
            {#if selected.id === UPDATES_CATEGORY}
              <UpdatesPane report={updateReport} {onWhatsNew} />
            {:else if selected.id === "Notifications"}
              <NotificationsPane />
            {/if}
            {#each paneSections as section, si (si)}
              {#if section.label === THEME_SECTION}
                <!-- The composite theme block carries no section header of its own — the
                     pane's "Appearance" header is that header. -->
                <div class="section">
                  <ThemeSection
                    fields={section.fields}
                    errors={themeErrors}
                    onApply={apply}
                    {onThemeErrors}
                  />
                </div>
              {:else if section.label}
                <!-- Only a LABELLED section becomes a fieldset: a fieldset with no legend is
                     a grouping boundary announced for nothing, so sectionless fields stay a
                     plain div. The legend must be the fieldset's FIRST child for a browser
                     to render it as the group's legend. -->
                <FieldSet class="section">
                  <FieldLegend class="section-head settings-block-label">{section.label}</FieldLegend>
                  {@render rows(section.fields)}
                </FieldSet>
              {:else}
                <div class="section">{@render rows(section.fields)}</div>
              {/if}
            {/each}
          {/if}
        {/if}
      </section>
    </div>
  </Dialog.Content>
</Dialog.Root>

{#snippet rows(fields: StagedField[])}
  <FieldGroup class="fields">
    {#each fields as field, i (field.key)}
      {#if i > 0}<FieldSeparator />{/if}
      <!-- Field carries role="group"; naming it after the row's own label turns a
           nameless boundary into the row's structure. -->
      <Field
        orientation="horizontal"
        data-field={field.key}
        class="setting-item"
        aria-labelledby={settingLabelId(field.key)}
      >
        <FieldContent>
          <FieldLabel
            id={settingLabelId(field.key)}
            for={settingLabelTarget(field)}
            class="field-label">{field.label}</FieldLabel
          >
          <FieldDescription>{field.description}</FieldDescription>
        </FieldContent>
        <SettingControl {field} value={values[field.key]} onApply={apply} />
      </Field>
    {/each}
  </FieldGroup>
{/snippet}

<style>
  /* Reset the shadcn dialog-content's padding/gap to a full-bleed two-pane frame;
     keep its max-height + overflow-y-auto (so a short viewport caps + scrolls per
     dialog-narrow.e2e) by NOT touching overflow. The width beats the sm:max-w-sm
     default (cn() merges settings-content last). Authored as caret CSS, not a
     Tailwind utility — app.css scans only lib/components/ui. Rides the portalled
     content (no scope hash → :global). */
  :global(.settings-content) {
    width: min(52rem, calc(100vw - 2rem));
    max-width: min(52rem, calc(100vw - 2rem));
    padding: 0;
    gap: 0;
    overflow: hidden;
  }
  /* The two-pane body. A fixed height gives the roomy mockup framing (the pane keeps
     its shape with few fields) and, being taller than a tiny viewport, lets the
     dialog-content cap + scroll rather than clip. Its own overflow is hidden so the
     rounded corners clip the sidebar fill; the pane scrolls internally when tall.
     --sidebar-width is the single source for the rail column: the grid track AND the
     shadcn Sidebar's own w-(--sidebar-width) both read it, so they stay in lockstep. */
  .settings {
    --sidebar-width: 15rem;
    display: grid;
    grid-template-columns: var(--sidebar-width) 1fr;
    height: min(32rem, 80vh);
    min-height: 22rem;
    overflow: hidden;
    border-radius: inherit;
  }

  /* The shadcn Sidebar as the category rail, flat on the sheet: no column fill, no rule. */
  .settings :global(.settings-rail) {
    background: transparent;
  }
  /* Nav rows sit a little apart (the shadcn menu ships gap-0) so a hover tint on
     one doesn't crowd its neighbor. */
  .settings :global([data-slot="sidebar-menu"]) {
    gap: 0.25rem;
  }
  /* Nav row: quiet --ink-soft at rest. Unselected rows must stay at the inherited weight —
     the vendored `data-[active=true]:font-medium` would leave them at 500, reading as
     half-selected — so the weight axis carries selection on its own. */
  .settings :global([data-slot="sidebar-menu-button"]) {
    justify-content: flex-start;
    color: var(--ink-soft);
    transition:
      background-color var(--dur-state) var(--ease-out),
      color var(--dur-state) var(--ease-out),
      box-shadow var(--dur-state) var(--ease-out);
  }
  /* An unselected row is a ghost key: an --ink-wash under the pointer, and the ghost
     press's dimple while held. */
  .settings :global([data-slot="sidebar-menu-button"]:not([data-active="true"]):hover),
  .settings :global([data-slot="sidebar-menu-button"]:not([data-active="true"]):active) {
    background: var(--ink-wash);
    color: var(--ink);
  }
  .settings :global([data-slot="sidebar-menu-button"]:not([data-active="true"]):active) {
    box-shadow: inset 0 1px var(--press-blur) var(--press-shade);
  }
  /* The selected row is stamped into the sheet in full ink: where you are, not a key. */
  .settings :global([data-slot="sidebar-menu-button"][data-active="true"]) {
    background: var(--well-floor);
    box-shadow: var(--well-shade), var(--well-lip);
    color: var(--ink);
    font-weight: 600;
  }
  .nav-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The pending-update mark (EXC-1207): a bare disc, since an update either waits or it
     does not. It wears --attention, the novelty token the TopBar's pending counts already
     use; amber is kept for the primary action. */
  .rail-dot {
    width: 0.4375rem;
    height: 0.4375rem;
    border-radius: 50%;
    background: var(--attention);
  }
  /* The search glyph and the key hint stay quiet; the hint swaps to `esc` while the
     field has focus, since that is what clears it. */
  .settings :global(.settings-search [data-slot="input-group-addon"]) {
    color: var(--ink-faint);
  }
  .settings :global(.settings-search .key-focused),
  .settings :global(.settings-search:focus-within .key-rest) {
    display: none;
  }
  .settings :global(.settings-search:focus-within .key-focused) {
    display: inline-flex;
  }
  .settings-bar {
    display: none;
  }
  .nav-hint {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    padding: 0 0.35rem;
    font-size: var(--text-xs);
    color: var(--ink-faint);
  }

  .settings-pane {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.5rem 1.75rem;
    overflow-y: auto;
  }
  .pane-head {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .pane-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: var(--leading-tight);
    color: var(--ink);
  }
  .pane-blurb {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--ink-soft);
  }
  .pane-empty {
    margin: 0;
    padding: 1.5rem 0;
    font-size: var(--text-sm);
    color: var(--ink-faint);
  }

  /* A labelled section is a fieldset and an unlabelled one a plain div, so this sets the
     column layout both need — FieldSet ships it, a div does not. `min-inline-size: 0`
     cancels the fieldset's min-content default, which would otherwise let a wide row push
     the pane's grid track open. */
  .settings :global(.section) {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-inline-size: 0;
  }
  /* The header hugs its rows from its own bottom margin, not the fieldset's gap: a
     RENDERED <legend> is lifted out of its fieldset's flex flow, so a gap between it
     and the rows never lands. Carrying the space on the legend itself is the one
     spelling that holds whether or not an engine keeps it in flow. */
  .settings :global(.section-head) {
    margin: 0 0 0.5rem;
  }

  /* Each section's rows sit in a group recessed into the sheet, the plan's code-panel
     recess, with a full-bleed hairline between rows: a section reads as a table of
     settings. `align-items: center` out-specifies Field's own
     has-[field-content]:items-start, which would otherwise top-align the control against
     a two-line description. */
  .settings :global(.fields) {
    --group-pad: 0.9rem;
    gap: 0;
    padding: 0 var(--group-pad);
    border-radius: var(--radius-lg);
    background-color: var(--group-floor);
    box-shadow: var(--panel-recess);
  }
  .settings :global(.setting-item) {
    align-items: center;
    gap: 0.625rem;
    padding-block: 0.7rem;
  }
  .settings :global(.setting-item [data-slot="field-content"]) {
    gap: 0.25rem;
  }
  /* The separator ships as a 20px box with the rule floated through its middle. Shrink
     the box to the hairline itself and pin the rule to its top — half of a 1px box is a
     half-pixel offset, which renders the line soft. */
  .settings :global([data-slot="field-separator"]) {
    height: 1px;
    margin: 0 calc(-1 * var(--group-pad));
  }
  .settings :global([data-slot="field-separator"] [data-slot="separator"]) {
    top: 0;
  }
  .settings :global(.setting-item .field-label) {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }

  /* Below --w-tight the 15rem rail would leave the pane a sliver, so it folds into the
     bar, and a wide control drops under its label. The search field stays in the tab
     order but out of sight until it is focused or holds a query. */
  @media (max-width: 639px) {
    :global(.settings-content) {
      width: calc(100vw - 1rem);
      max-width: calc(100vw - 1rem);
    }
    .settings {
      --sidebar-width: 100%;
      display: flex;
      flex-direction: column;
      height: min(44rem, calc(100dvh - 1rem));
    }
    .settings :global(.settings-rail) {
      height: auto;
    }
    .settings-bar {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.6rem 0.6rem 0.2rem;
    }
    .section-pick {
      display: flex;
      flex: 1;
      min-width: 0;
    }
    .section-pick :global(.tray) {
      display: flex;
      flex: 1;
      min-width: 0;
    }
    .section-pick :global(.setting-trigger) {
      flex: 1;
      min-width: 0;
      justify-content: space-between;
      font-weight: 600;
    }
    .settings :global(.settings-search) {
      padding: 0.4rem 0.6rem 0;
    }
    .settings :global(.settings-rail [data-slot="sidebar-content"]),
    .settings :global(.settings-rail [data-slot="sidebar-footer"]) {
      display: none;
    }
    .settings:not([data-query]) :global(.settings-search:not(:focus-within)) {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .settings-pane {
      flex: 1;
      min-height: 0;
      padding: 1rem 1rem 1.25rem;
    }
    .settings :global(.fields) {
      --group-pad: 0.75rem;
    }
    .settings :global(.setting-item:not(:has([data-slot="switch"]))) {
      flex-direction: column;
      align-items: stretch;
      gap: 0.6rem;
    }
    .settings :global(.setting-item:not(:has([data-slot="switch"])) > :last-child) {
      align-self: flex-start;
    }
  }
</style>
