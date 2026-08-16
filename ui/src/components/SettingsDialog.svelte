<script lang="ts">
  // The two-pane Settings shell (EXC-843): a shadcn Sidebar as the category rail
  // left, the selected category's pane right. Every edit applies IMMEDIATELY — the
  // pane calls onChange the moment a control changes and App persists + confirms
  // with a toast; there is no staged draft, no Save/Discard. A category's fields are
  // sub-grouped into labelled sections (Diff view lives as a section under
  // Appearance), each an ItemGroup of shadcn Items.
  //
  // Two shadcn primitives carry the layout (compose-first, per doc/agents/shadcn-rules):
  //   • Sidebar (collapsible="none") — the static category rail. The SELECTED row
  //     wears a solid amber rail + wash and bold ink (caret's "amber marks the
  //     selection" language), overriding shadcn's faint single-accent data-active
  //     treatment so the current pane is unmistakable.
  //   • Item / ItemGroup — one Item per setting (title + description + control),
  //     hairline-separated within each section group.
  // The Dialog primitive is composed directly rather than Modal.svelte — Modal's
  // eyebrow/title/footer identity doesn't fit the two-pane layout — keeping a
  // visually-hidden Dialog.Title so the dialog's accessible name is "Settings".
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as InputGroup from "$lib/components/ui/input-group/index.js";
  import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemGroup,
    ItemSeparator,
    ItemTitle,
  } from "$lib/components/ui/item/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { isTopmostDialog } from "$lib/modalStack.ts";
  import { SETTINGS_SHORTCUTS, shortcuts } from "$lib/shortcuts/index.ts";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import {
    filterSettings,
    isStagedField,
    SETTINGS_CATEGORIES,
    type SettingEntry,
    type StagedField,
    THEME_SECTION,
  } from "$lib/settingsRegistry.ts";
  import AdvancedPane from "@/components/AdvancedPane.svelte";
  import NotificationsPane from "@/components/NotificationsPane.svelte";
  import SettingSegmented from "@/components/SettingSegmented.svelte";
  import SettingSelect from "@/components/SettingSelect.svelte";
  import ThemeSection from "@/components/ThemeSection.svelte";

  interface Props {
    /** Controlled open — false while the dialog plays its exit. */
    open: boolean;
    /** The surface finished its exit and may be unmounted. */
    onClosed?: () => void;
    /** The registry, grouped into categories/sections and rendered by control kind. */
    entries: readonly SettingEntry[];
    /** Apply a setting's new value now (App: write + resync + confirming toast). */
    onChange: (field: StagedField, value: unknown) => void;
    /** Dismiss (Escape / backdrop). App hides the modal. */
    onClose: () => void;
    /** Copy a diagnostics block's text (the Advanced pane, EXC-848): App writes the
     * clipboard and fires the shared success alert. Defaults to a no-op so mounts
     * without the Advanced pane need not supply it. */
    onCopyDiagnostic?: (text: string) => void;
  }
  let { open, onClosed, entries, onChange, onClose, onCopyDiagnostic = () => {} }: Props = $props();

  // EXC-849: while Settings owns the view, publish its own keyboard affordances into the
  // shared registry. SETTINGS_SHORTCUTS is the settings-scoped reservation set from
  // CANONICAL_KEYMAP (the single source). Display-only (no run) — the modal owns `/`
  // (focus search) and Esc (close) through its own handlers below; registering the
  // reservations makes the scoped `?` help list exactly the shortcuts valid here, and their
  // "settings" scope tells the dispatcher to suppress the review shortcuts while this modal
  // is open (see App's activeScope + shortcuts/scope.ts).
  $effect(() => {
    const offs = SETTINGS_SHORTCUTS.map((e) => shortcuts.register(e));
    return () => {
      for (const off of offs) off();
    };
  });

  // The search query (EXC-845): filters the registry across categories, mirroring
  // ShortcutsHelp's filter-then-group. The search input, bound so the `/`-to-focus
  // handler can move focus into it (added below).
  let query = $state("");
  let searchInput = $state<HTMLInputElement | null>(null);

  // Filter first, then derive: staged fields carry controls; a live pane
  // (Notifications, EXC-847) contributes search-only entries and renders a custom pane
  // instead. A category earns a nav row when it has ANY matching registry entry — staged
  // or search-only — in SETTINGS_CATEGORIES order, so filtering drops emptied categories
  // and, at rest (empty query), the full nav is restored.
  const filtered = $derived(filterSettings(entries, query));
  const staged = $derived(filtered.filter(isStagedField));
  const categories = $derived(
    SETTINGS_CATEGORIES.filter((c) => filtered.some((e) => e.category === c.id)),
  );

  let selectedId = $state(SETTINGS_CATEGORIES[0]?.id ?? "");
  const selected = $derived(categories.find((c) => c.id === selectedId) ?? categories[0]);
  const paneFields = $derived(staged.filter((f) => f.category === selected?.id));

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
  // svelte-ignore state_referenced_locally
  let values = $state<Record<string, unknown>>(
    Object.fromEntries(entries.filter(isStagedField).map((f) => [f.key, f.read()])),
  );

  function apply(field: StagedField, value: unknown): void {
    onChange(field, value);
    values = { ...values, [field.key]: field.read() };
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

  // EXC-845 (the EXC-835 capture-phase pattern): while the modal is open, `/` focuses the
  // search input instead of falling through to the global plan-search binding
  // (actions.search). Capture phase so the preventDefault lands before the bubble-phase
  // global dispatcher (dispatcher.ts), which yields on defaultPrevented — the modal traps
  // focus on the dialog content (not an input), so isEditingContext() wouldn't otherwise
  // suppress the global `/`. Once the input owns focus, `/` types normally.
  //
  // EXC-849: yield unless Settings is the topmost dialog. When ShortcutsHelp stacks above
  // Settings (? over the settings modal), both register this capture handler; Settings'
  // fires first (registered first), so without this guard it would steal `/` from the modal
  // on top. isTopmostDialog gates on portal order instead of registration order, so `/`
  // reaches whichever modal is stacked highest.
  $effect(() => {
    function onKeydown(e: KeyboardEvent): void {
      if (e.key !== "/" || e.defaultPrevented) return;
      if (document.activeElement === searchInput) return;
      if (!isTopmostDialog(searchInput)) return;
      e.preventDefault();
      searchInput?.focus();
    }
    window.addEventListener("keydown", onKeydown, { capture: true });
    return () => window.removeEventListener("keydown", onKeydown, { capture: true });
  });

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

<!-- The host mounts this per open (ModalPresence) and keeps it through the exit;
     bits-ui's close intents (Escape, backdrop) route through onOpenChange to
     onClose, and onOpenChangeComplete reports the exit done so the host can drop
     the component. -->
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

    <div class="settings">
      <Sidebar.Root collapsible="none" class="settings-rail">
        <!-- Search atop the rail (EXC-845): filters the nav + fields across categories.
             The trailing `/` Kbd cap advertises the focus shortcut, mirroring
             ShortcutsHelp's search field; `/` focuses it from anywhere in the modal. The
             cap rides an InputGroup inline-end addon (EXC-1113), which is what reserves
             its track beside the control — so nothing pins it over the field and nothing
             pads the field out of its way. -->
        <Sidebar.Header>
          <InputGroup.Root>
            <InputGroup.Input
              type="text"
              placeholder="Search settings…"
              aria-label="Search settings"
              bind:value={query}
              bind:ref={searchInput}
            />
            <InputGroup.Addon align="inline-end">
              <Kbd aria-hidden="true">/</Kbd>
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
                </Sidebar.MenuItem>
              {/each}
            </Sidebar.Menu>
          </Sidebar.Group>
        </Sidebar.Content>
        <!-- Esc-dismisses hint, pinned bottom-left (mockup). -->
        <Sidebar.Footer>
          <p class="nav-hint"><Kbd aria-hidden="true">esc</Kbd> <span>close</span></p>
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

          {#if selected.id === "Notifications"}
            <!-- The live, read-only panes render their own surface instead of staged
                 fields: Notifications (EXC-847) reflects browser notification state,
                 Advanced (EXC-848) the read-only install diagnostics. Two id branches
                 beat a category→component map here — the panes take different props
                 (Advanced needs the copy callback), which a map can't thread. -->
            <NotificationsPane />
          {:else if selected.id === "Advanced"}
            <AdvancedPane {onCopyDiagnostic} />
          {:else}
            {#each paneSections as section, si (si)}
              <div class="section">
                {#if section.label === THEME_SECTION}
                  <!-- The theme controls render as one composite block rather than
                       three independent rows: the IN USE marker and the resolved-state
                       line only mean anything across all three. It carries no section
                       header — the pane's own "Appearance" header is that header. -->
                  <ThemeSection fields={section.fields} {values} onApply={apply} />
                {:else}
                  {#if section.label}<h3 class="section-head">{section.label}</h3>{/if}
                  <ItemGroup class="fields">
                    {#each section.fields as field, i (field.key)}
                      {#if i > 0}<ItemSeparator />{/if}
                      <Item data-field={field.key} class="setting-item">
                        <ItemContent>
                          <ItemTitle class="field-label">{field.label}</ItemTitle>
                          <ItemDescription>{field.description}</ItemDescription>
                        </ItemContent>
                        <ItemActions>{@render control(field)}</ItemActions>
                      </Item>
                    {/each}
                  </ItemGroup>
                {/if}
              </div>
            {/each}
          {/if}
        {/if}
      </section>
    </div>
  </Dialog.Content>
</Dialog.Root>

{#snippet control(field: StagedField)}
  {#if field.control.kind === "select"}
    <SettingSelect
      value={String(values[field.key] ?? "")}
      options={field.control.options}
      onSelect={(v) => apply(field, v)}
      ariaLabel={field.label}
    />
  {:else if field.control.kind === "segmented"}
    <SettingSegmented
      value={String(values[field.key] ?? "")}
      options={field.control.options}
      onSelect={(v) => apply(field, v)}
      ariaLabel={field.label}
    />
  {:else}
    <Switch
      checked={values[field.key] === true}
      onCheckedChange={(v) => apply(field, v)}
      aria-label={field.label}
    />
  {/if}
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

  /* The shadcn Sidebar as the category rail: a hairline off the pane, its rounded
     inner corners clipped by .settings. The rail surface (--sidebar → --paper) is a
     shade under the raised pane, reading as recessed. */
  .settings :global(.settings-rail) {
    border-right: 1px solid var(--rule);
  }
  /* Nav rows sit a little apart (the shadcn menu ships gap-0) so a hover tint on
     one doesn't crowd its neighbor. */
  .settings :global([data-slot="sidebar-menu"]) {
    gap: 0.25rem;
  }
  /* Nav row: quiet --ink-soft at rest, transparent. The SELECTED row is the single
     amber-filled row — a solid amber rail down its leading edge plus an amber wash
     and bold ink ("amber marks the selection") — so selection reads at a glance.
     `position: relative` anchors the rail pseudo-element.

     `background: transparent` is load-bearing: shadcn's SidebarMenuButton ships
     `data-active:bg-sidebar-accent`, and Tailwind matches that variant on the
     PRESENCE of data-active — Svelte serializes isActive={false} as
     data-active="false" (attribute present), so every unselected row would
     otherwise wear the grey accent fill at rest. This out-specifies it; the amber
     selected rule and the hover tint below paint over it where wanted. */
  .settings :global([data-slot="sidebar-menu-button"]) {
    position: relative;
    justify-content: flex-start;
    color: var(--ink-soft);
    background: transparent;
  }
  /* Unselected rows are transparent at rest; on hover they take --ink-wash, the
     shared neutral tint for a control the surface shows through — gentler than the
     app-wide --chip-hover (15% ink) the shadcn button ships, so it never rivals the
     selection's amber below. */
  .settings :global([data-slot="sidebar-menu-button"]:not([data-active="true"]):hover),
  .settings :global([data-slot="sidebar-menu-button"]:not([data-active="true"]):active) {
    background: var(--ink-wash);
    color: var(--ink);
  }
  .settings :global([data-slot="sidebar-menu-button"][data-active="true"]) {
    background: var(--accent-wash);
    color: var(--ink);
    font-weight: 600;
  }
  .settings :global([data-slot="sidebar-menu-button"][data-active="true"])::before {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    width: 0.1875rem;
    border-radius: 0 var(--radius) var(--radius) 0;
    background: var(--accent);
  }
  .nav-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The esc hint, in the sidebar footer. */
  .nav-hint {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    padding: 0 0.35rem;
    font-size: var(--text-xs);
    color: var(--ink-faint);
  }

  /* Content pane: the raised popover surface, its own scroll. Sections stack with a
     comfortable gap; each section hugs its own header. */
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
  /* The no-match empty state (EXC-845): quiet, left-aligned with the pane's content. */
  .pane-empty {
    margin: 0;
    padding: 1.5rem 0;
    font-size: var(--text-sm);
    color: var(--ink-faint);
  }

  /* A labelled sub-group of settings within the pane (e.g. "Diff view"). The header
     hugs its ItemGroup; the pane gap separates one section from the next. */
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .section-head {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-faint);
  }

  /* One setting = one shadcn Item (text block left, control flush right). Zero the
     Item's own horizontal padding so rows align to the pane's edge; a hairline
     ItemSeparator rules between them. */
  .settings :global(.fields) {
    gap: 0;
  }
  .settings :global(.setting-item) {
    padding-left: 0;
    padding-right: 0;
  }
  .settings :global(.setting-item .field-label) {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
</style>
