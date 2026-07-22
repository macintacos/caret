<script lang="ts">
  // The two-pane Settings shell (EXC-843): a shadcn Sidebar as the category rail
  // (with per-category dirty dots) left, the selected category's pane right, and a
  // floating save chip that rises when the draft is dirty. It renders the registry
  // generically — a SettingSelect for `select` fields, a Switch for `toggle` fields,
  // each setting grouped into one shadcn Item within an ItemGroup — and stages every
  // edit into the draft store; nothing persists until Save (theme + shortcut hints
  // apply live on Save via App's resync; the diff-view live re-apply is EXC-846).
  //
  // Two shadcn primitives carry the layout (compose-first, per doc/agents/shadcn-rules):
  //   • Sidebar (collapsible="none") — the static category rail. The stock component
  //     folds hover and active into one --sidebar-accent; the rail below re-tints the
  //     SELECTED row to amber so caret's "amber marks the selection" language holds.
  //   • Item / ItemGroup — one Item per setting (title + description + control),
  //     hairline-separated within the group.
  // The Dialog primitive is composed directly rather than Modal.svelte — Modal's
  // eyebrow/title/footer identity doesn't fit the two-pane + float-chip layout —
  // keeping a visually-hidden Dialog.Title so the dialog's accessible name is "Settings".
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemGroup,
    ItemSeparator,
    ItemTitle,
  } from "$lib/components/ui/item/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { isStagedField, SETTINGS_CATEGORIES, type SettingEntry, type StagedField } from "$lib/settingsRegistry.ts";
  import type { SettingsDraft } from "@/state/settingsDraft.ts";
  import SettingSelect from "@/components/SettingSelect.svelte";

  interface Props {
    /** The staged-draft store (App owns the reactive backing store). */
    draft: SettingsDraft;
    /** The registry, grouped into categories and rendered by control kind. */
    entries: readonly SettingEntry[];
    /** The persisted shortcut-hints setting — gates the Save button's ⌘↩ caps,
     * matching every other key cap in the app. */
    showShortcutHints: boolean;
    /** Commit the draft (App: save + resync + success alert). Keeps the modal open. */
    onSave: () => void;
    /** Dismiss (Escape / backdrop). App discards the draft and hides the modal — a
     * dirty dismiss plainly discards until the guard child lands (EXC-844). */
    onClose: () => void;
  }
  let { draft, entries, showShortcutHints, onSave, onClose }: Props = $props();

  // Only staged fields carry controls; group them by category and keep the
  // SETTINGS_CATEGORIES order, dropping any category with no entries (so an empty
  // "General" never renders a nav row).
  const staged = $derived(entries.filter(isStagedField));
  const categories = $derived(
    SETTINGS_CATEGORIES.filter((c) => staged.some((f) => f.category === c.id)),
  );

  let selectedId = $state(SETTINGS_CATEGORIES[0]?.id ?? "");
  const selected = $derived(categories.find((c) => c.id === selectedId) ?? categories[0]);
  const paneFields = $derived(staged.filter((f) => f.category === selected?.id));

  // Dirty state drives the field + category dots and the chip; derived from the
  // draft's changes() so it tracks the injected reactive store.
  const dirtyKeys = $derived(new Set(draft.changes().map((c) => c.key)));
  const dirtyCount = $derived(draft.dirtyCount());
  const dirty = $derived(draft.isDirty());
  const categoryDirty = (id: string): boolean =>
    staged.some((f) => f.category === id && dirtyKeys.has(f.key));

  // ⌘/Ctrl+Enter saves while dirty. A capture-phase window listener (the ShortcutsHelp
  // `/` pattern) so it fires while any control in the modal has focus — but GUARDED to
  // events originating inside this modal's own content (`.settings-content`), so it
  // never swallows a ⌘↩ dispatched in a different dialog. The guard matters for the
  // shared-window test suite (real app: one modal at a time), where an unguarded
  // window listener intercepts another dialog's Cmd+Enter. Consumes the chord fully so
  // a focused Switch/Button doesn't ALSO activate on the Enter and re-stage right after
  // save() clears the draft. Gated on dirty so an empty ⌘↩ no-ops.
  $effect(() => {
    function onKeydown(e: KeyboardEvent): void {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.defaultPrevented) return;
      if (!draft.isDirty()) return;
      if (!(e.target as Element | null)?.closest?.(".settings-content")) return;
      e.preventDefault();
      e.stopPropagation();
      onSave();
    }
    window.addEventListener("keydown", onKeydown, { capture: true });
    return () => window.removeEventListener("keydown", onKeydown, { capture: true });
  });

  // Land focus on the dialog content (not the first control), matching ShortcutsHelp:
  // Esc dismisses "with nothing focused", and EXC-845's `/` search relies on focus
  // resting on the content.
  function focusDialog(e: Event): void {
    e.preventDefault();
    document.querySelector<HTMLElement>(".settings-content")?.focus();
  }
</script>

<!-- App gates this with {#if showSettings}, so it mounts open; bits-ui's close
     intents (Escape, backdrop) route through onOpenChange to onClose. -->
<Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
  <Dialog.Content showCloseButton={false} onOpenAutoFocus={focusDialog} class="settings-content">
    <!-- Visually hidden: keeps the dialog's accessible name "Settings" without a
         header band. The visible title is the per-category pane header. -->
    <Dialog.Title class="sr-only">Settings</Dialog.Title>

    <div class="settings">
      <Sidebar.Root collapsible="none" class="settings-rail">
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
                    {#if categoryDirty(cat.id)}<span class="dirty-dot" aria-hidden="true"></span>{/if}
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
        <header class="pane-head">
          <h2 class="pane-title">{selected?.id}</h2>
          <p class="pane-blurb">{selected?.blurb}</p>
        </header>

        <ItemGroup class="fields">
          {#each paneFields as field, i (field.key)}
            {#if i > 0}<ItemSeparator />{/if}
            <Item data-field={field.key} class="setting-item">
              <ItemContent>
                <ItemTitle class="field-label">
                  {field.label}{#if dirtyKeys.has(field.key)}<span class="dirty-dot" aria-hidden="true"></span>{/if}
                </ItemTitle>
                <ItemDescription>{field.description}</ItemDescription>
              </ItemContent>
              <ItemActions>{@render control(field)}</ItemActions>
            </Item>
          {/each}
        </ItemGroup>

        {#if dirty}
          <!-- The float-chip: unsaved count, Discard, Save ⌘↩. Rises over the pane
               when dirty (mockup). Discard reverts in place; Save keeps the modal
               open (App resyncs + toasts). -->
          <div class="save-chip" role="group" aria-label="Unsaved changes">
            <span class="chip-count">
              <span class="dirty-dot" aria-hidden="true"></span>
              {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
            </span>
            <Button variant="secondary" class="float-chip chip-discard" onclick={() => draft.discard()}>
              Discard
            </Button>
            <Button class="chip-save" onclick={onSave}>
              Save
              {#if showShortcutHints}<span class="save-caps"><Kbd aria-hidden="true">⌘</Kbd><Kbd aria-hidden="true">↩</Kbd></span>{/if}
            </Button>
          </div>
        {/if}
      </section>
    </div>
  </Dialog.Content>
</Dialog.Root>

{#snippet control(field: StagedField)}
  {#if field.control.kind === "select"}
    <SettingSelect
      value={String(draft.value(field.key) ?? "")}
      options={field.control.options}
      onSelect={(v) => draft.stage(field.key, v)}
      ariaLabel={field.label}
    />
  {:else}
    <Switch
      checked={draft.value(field.key) === true}
      onCheckedChange={(v) => draft.stage(field.key, v)}
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
  /* Nav row: quiet --ink-soft at rest, brightening to --ink on hover (the stock
     --sidebar-accent hover wash → --chip-hover). The SELECTED row is re-tinted to an
     amber wash — the "amber marks the selection" language the diff view and pickers
     use — overriding shadcn's single-accent data-active treatment. Label left, dirty
     dot right. */
  .settings :global([data-slot="sidebar-menu-button"]) {
    justify-content: space-between;
    color: var(--ink-soft);
  }
  .settings :global([data-slot="sidebar-menu-button"][data-active="true"]) {
    background: var(--accent-wash);
    color: var(--ink);
    font-weight: inherit;
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

  /* Content pane: the raised popover surface, its own scroll, and the anchor for the
     floating save chip. */
  .settings-pane {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
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

  /* One setting = one shadcn Item (text block left, control flush right). Zero the
     Item's own horizontal padding so rows align to the pane's edge; a hairline
     ItemSeparator rules between them. The label wears the field's dirty dot. */
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

  /* The amber dirty dot on a changed field and its category (and leading the chip
     count). Amber is the app's single accent, reserved for exactly this kind of
     "here's what changed" signal. */
  .dirty-dot {
    flex: none;
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: var(--accent);
  }

  /* The floating save chip: a raised card centered over the bottom of the pane,
     rising in when the draft turns dirty. */
  .save-chip {
    position: absolute;
    left: 50%;
    bottom: 1.25rem;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 0.65rem 0.55rem 1rem;
    border-radius: calc(var(--radius) + 0.25rem);
    background: var(--paper-raised);
    box-shadow: var(--shadow-card);
    white-space: nowrap;
    animation: chip-in var(--dur-base) var(--ease-out);
  }
  .chip-count {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--text-sm);
    color: var(--ink-soft);
  }
  .save-caps {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    margin-left: 0.35rem;
  }
  @keyframes chip-in {
    from {
      opacity: 0;
      transform: translate(-50%, 0.5rem);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>
