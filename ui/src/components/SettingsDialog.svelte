<script lang="ts">
  // The two-pane Settings shell (EXC-843): a category sidebar (with per-category
  // dirty dots) left, the selected category's pane right, and a floating save chip
  // that rises when the draft is dirty. It renders the registry generically — a
  // SettingSelect for `select` fields, a Switch for `toggle` fields — and stages
  // every edit into the draft store; nothing persists until Save (theme + shortcut
  // hints apply live on Save via App's resync; the diff-view live re-apply is
  // EXC-846). Composes the shadcn Dialog primitive directly rather than Modal.svelte
  // — Modal's eyebrow/title/footer identity doesn't fit the two-pane + float-chip
  // layout — keeping a visually-hidden Dialog.Title so the dialog's accessible name
  // stays "Settings".
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
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

  // ⌘/Ctrl+Enter saves while dirty — a capture-phase window listener scoped to the
  // open modal (the ShortcutsHelp `/` pattern), so it fires even while a control or
  // the future search input (EXC-845) has focus. Gated on dirty so an empty ⌘↩ no-ops.
  $effect(() => {
    function onKeydown(e: KeyboardEvent): void {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.defaultPrevented) return;
      if (!draft.isDirty()) return;
      // Consume the chord fully (capture phase): stop it reaching the focused control
      // — a focused Switch/Button would otherwise ALSO activate on the Enter and
      // re-stage right after save() clears the draft, leaving the chip stuck open.
      e.preventDefault();
      e.stopPropagation();
      onSave();
    }
    window.addEventListener("keydown", onKeydown, { capture: true });
    return () => window.removeEventListener("keydown", onKeydown, { capture: true });
  });

  // Land focus on the dialog content (not the first control), matching ShortcutsHelp:
  // Esc dismisses "with nothing focused", and EXC-845's `/` search relies on focus
  // resting on the content. Take the LAST dialog-content — this modal portals after
  // any already-open dialog.
  function focusDialog(e: Event): void {
    e.preventDefault();
    const contents = document.querySelectorAll<HTMLElement>("[data-slot='dialog-content']");
    contents[contents.length - 1]?.focus();
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
      <nav class="settings-nav" aria-label="Settings categories">
        <ul class="nav-list">
          {#each categories as cat (cat.id)}
            <li>
              <button
                type="button"
                class="nav-item"
                data-category={cat.id}
                aria-current={cat.id === selected?.id ? "page" : undefined}
                onclick={() => (selectedId = cat.id)}
              >
                <span class="nav-label">{cat.id}</span>
                {#if categoryDirty(cat.id)}<span class="dirty-dot" aria-hidden="true"></span>{/if}
              </button>
            </li>
          {/each}
        </ul>
        <!-- Esc-dismisses hint, pinned bottom-left (mockup). -->
        <p class="nav-hint"><Kbd aria-hidden="true">esc</Kbd> <span>close</span></p>
      </nav>

      <section class="settings-pane">
        <header class="pane-head">
          <h2 class="pane-title">{selected?.id}</h2>
          <p class="pane-blurb">{selected?.blurb}</p>
        </header>

        <div class="fields">
          {#each paneFields as field (field.key)}
            <div class="field" data-field={field.key}>
              <div class="field-text">
                <span class="field-label">
                  {field.label}{#if dirtyKeys.has(field.key)}<span class="dirty-dot" aria-hidden="true"></span>{/if}
                </span>
                <span class="field-desc">{field.description}</span>
              </div>
              <div class="field-control">{@render control(field)}</div>
            </div>
          {/each}
        </div>

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
     rounded corners clip the sidebar fill; the pane scrolls internally when tall. */
  .settings {
    display: grid;
    grid-template-columns: 15rem 1fr;
    height: min(32rem, 80vh);
    min-height: 22rem;
    overflow: hidden;
    border-radius: inherit;
  }

  /* Sidebar: a quiet recessed rail, a hairline off the pane. */
  .settings-nav {
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    background: var(--paper);
    border-right: 1px solid var(--rule);
    overflow-y: auto;
  }
  .nav-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    flex: 1;
  }
  /* Nav row: label left, dirty dot right. Ink-soft at rest, chip-hover on hover,
     and an amber wash on the selected row — the "amber marks the selection"
     language the diff view and pickers use. */
  .nav-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    padding: 0.45rem 0.6rem;
    border-radius: var(--radius);
    appearance: none;
    border: none;
    background: none;
    text-align: left;
    font-size: var(--text-sm);
    color: var(--ink-soft);
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .nav-item:hover {
    background: var(--chip-hover);
    color: var(--ink);
  }
  .nav-item[aria-current="page"] {
    background: var(--accent-wash);
    color: var(--ink);
  }
  .nav-item:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  .nav-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The esc hint, pinned under the nav list. */
  .nav-hint {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.5rem 0 0;
    padding: 0 0.2rem;
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

  .fields {
    display: flex;
    flex-direction: column;
  }
  /* One setting: text block left, control flush right. A hairline separates rows;
     the first row drops its top rule so the header spacing owns the gap. */
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 1rem 0;
    border-top: 1px solid var(--rule);
  }
  .field:first-child {
    border-top: none;
    padding-top: 0;
  }
  .field-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .field-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .field-desc {
    font-size: var(--text-xs);
    color: var(--ink-soft);
  }
  .field-control {
    flex: none;
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
