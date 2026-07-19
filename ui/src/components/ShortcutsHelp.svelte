<script lang="ts">
  // The keyboard-shortcuts help modal (EXC-787): every live-registered shortcut,
  // grouped by category, searchable, click-to-run. Composes the shared Modal
  // (kind="dialog": Escape + backdrop dismiss). The host gates this with
  // {#if showHelp} and passes shortcuts.list() at mount, so the list reflects
  // whatever is registered when it opens — it grows as later tickets register.
  import { Input } from "$lib/components/ui/input/index.js";
  import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
  import { filterShortcuts, groupShortcuts } from "$lib/shortcuts/help.ts";
  import { keyCaps, type ShortcutEntry } from "$lib/shortcuts/index.ts";
  import Modal from "@/components/Modal.svelte";

  interface Props {
    /** The shortcuts to list — the host passes shortcuts.list() at mount. */
    entries: ShortcutEntry[];
    /** Dismiss (Escape, backdrop, or after running a shortcut). */
    onClose: () => void;
  }
  let { entries, onClose }: Props = $props();

  let query = $state("");
  // Filter first, then group: an empty group (all its rows filtered out) drops
  // away, so a search collapses to only the sections that still match.
  const groups = $derived(groupShortcuts(filterShortcuts(entries, query)));

  // A row is activatable only when its entry carries a live run() and isn't
  // disabled; display-only entries (the editor chords) list but don't dispatch.
  function isRunnable(entry: ShortcutEntry): boolean {
    return entry.run !== undefined && entry.enabled?.() !== false;
  }
  function runEntry(entry: ShortcutEntry): void {
    entry.run?.();
    onClose();
  }

  // Don't autofocus the search input: ? toggles this modal, and a focused input
  // would swallow the ? (the shared dispatcher yields to editing contexts). Focus
  // the dialog content instead, so ? and Esc both dismiss while focus stays
  // trapped in the modal.
  function focusDialog(e: Event): void {
    e.preventDefault();
    // bits-ui invokes this with a synthetic event (no currentTarget), so reach the
    // just-mounted content by slot — only one dialog is open at a time.
    document.querySelector<HTMLElement>("[data-slot='dialog-content']")?.focus();
  }
</script>

<Modal
  kind="dialog"
  open
  eyebrow="Keyboard"
  title="Shortcuts"
  onDismiss={onClose}
  onOpenAutoFocus={focusDialog}
  contentClass="sm:max-w-xl"
>
  {#snippet description()}
    Search by action or keys; click a row to run it.
  {/snippet}

  <div class="help">
    <Input
      type="text"
      class="help-search"
      placeholder="Search shortcuts…"
      aria-label="Search shortcuts"
      bind:value={query}
    />

    {#if groups.length === 0}
      <p class="help-empty">No shortcuts match your search.</p>
    {:else}
      <div class="help-groups">
        {#each groups as group (group.group)}
          <section class="help-group">
            <h3 class="help-group-title eyebrow">{group.label}</h3>
            <ul class="help-list">
              {#each group.entries as entry (entry.id)}
                <li>
                  {#if isRunnable(entry)}
                    <button
                      type="button"
                      class="help-row is-runnable"
                      onclick={() => runEntry(entry)}
                    >
                      <span class="help-label">{entry.label}</span>
                      {@render caps(entry)}
                    </button>
                  {:else}
                    <div class="help-row" class:is-disabled={entry.enabled?.() === false}>
                      <span class="help-label">{entry.label}</span>
                      {@render caps(entry)}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {/if}
  </div>
</Modal>

<!-- One chord's caps render as adjacent Kbds; a two-key sequence (gg, ]]) is two
     chords, so its caps sit side by side. keyCaps already resolves the display
     glyphs (⌘, Esc, ↵), so this only lays them out. -->
{#snippet caps(entry: ShortcutEntry)}
  <KbdGroup class="help-caps">
    {#each keyCaps(entry.keys) as chordCaps}
      {#each chordCaps as cap}<Kbd>{cap}</Kbd>{/each}
    {/each}
  </KbdGroup>
{/snippet}

<style>
  .help {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  /* The grouped sections. The dialog content scrolls as a whole (shadcn
     dialog-content is max-height + overflow-y-auto), so a long keymap stays
     reachable without a nested scroller. */
  .help-groups {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .help-group-title {
    /* rides the global .eyebrow atom (uppercase, ink-soft); this only spaces it. */
    margin: 0 0 0.35rem;
  }
  .help-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  /* One shortcut: label on the left, its key caps on the right. A runnable row is
     a real button (reset back to the row) with a quiet hover; a display-only row
     is inert text at the same rhythm. */
  .help-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
    padding: 0.4rem 0.55rem;
    border-radius: var(--radius);
    text-align: left;
    font-size: var(--text-sm);
    color: var(--ink-soft);
  }
  .help-row.is-runnable {
    appearance: none;
    border: none;
    background: none;
    font: inherit;
    cursor: pointer;
    color: var(--ink);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .help-row.is-runnable:hover {
    background: var(--chip-hover);
  }
  .help-row.is-runnable:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  .help-row.is-disabled {
    opacity: 0.5;
  }
  .help-label {
    min-width: 0;
  }
  /* .help-caps rides KbdGroup's root, which carries no scope hash — reach it with
     :global, bounded under the scoped .help-row so the rule can't leak. */
  .help-row :global(.help-caps) {
    flex: none;
  }
  .help-empty {
    margin: 0;
    padding: 1.5rem 0;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--ink-faint);
  }
</style>
