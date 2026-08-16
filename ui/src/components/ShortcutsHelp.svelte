<script lang="ts">
  // The keyboard-shortcuts help modal (EXC-787): every live-registered shortcut,
  // grouped by category, searchable, click-to-run. Composes the shared Modal
  // (kind="dialog": Escape + backdrop dismiss). The host mounts this per open
  // (ModalPresence) and passes shortcuts.list() at mount, so the list reflects
  // whatever is registered when it opens — it grows as later tickets register.
  import * as InputGroup from "$lib/components/ui/input-group/index.js";
  import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
  import { isTopmostDialog, topmostDialogContent } from "$lib/modalStack.ts";
  import { filterShortcuts, fitsSingleColumn, groupShortcuts } from "$lib/shortcuts/help.ts";
  import { isKbdKey, keyCaps, type ShortcutEntry } from "$lib/shortcuts/index.ts";
  import KbdCap from "@/components/KbdCap.svelte";
  import Modal from "@/components/Modal.svelte";

  interface Props {
    /** Controlled open — false while the modal plays its exit. */
    open: boolean;
    /** The surface finished its exit and may be unmounted. */
    onClosed?: () => void;
    /** The shortcuts to list — the host passes shortcuts.list() at mount. */
    entries: ShortcutEntry[];
    /** Dismiss (Escape, backdrop, or after running a shortcut). */
    onClose: () => void;
  }
  let { open, onClosed, entries, onClose }: Props = $props();

  let query = $state("");
  // The search input element, bound so the `/`-to-focus handler below can move
  // focus into it.
  let searchInput = $state<HTMLInputElement | null>(null);
  // Filter first, then group: an empty group (all its rows filtered out) drops
  // away, so a search collapses to only the sections that still match.
  const groups = $derived(groupShortcuts(filterShortcuts(entries, query)));
  // A small scoped keymap (the settings-view help, EXC-849) reads better as one narrow
  // column than the wide multi-column layout. Derived from the unfiltered entries, so
  // the modal keeps a stable width for a given open — a search narrows rows, not the frame.
  const compact = $derived(fitsSingleColumn(entries));

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
    // content by slot. The topmost (last-portalled) dialog-content is ours: this modal
    // portals after any modal already open (e.g. Settings). Shared with the `/` handler
    // below through modalStack.ts (EXC-849).
    topmostDialogContent()?.focus();
  }

  // EXC-835: while the modal is open, `/` focuses the search input instead of
  // falling through to the global plan-search binding (actions.search). Capture
  // phase so the preventDefault lands before the bubble-phase global dispatcher
  // (dispatcher.ts), which yields on defaultPrevented — the modal traps focus on
  // the dialog content (not an input), so isEditingContext() wouldn't otherwise
  // suppress the global `/`. Once the input owns focus, `/` types normally.
  //
  // EXC-849: yield unless this help modal is the topmost dialog. Stacked above
  // Settings (? over the settings modal), both register this capture handler; the
  // topmost-modal guard makes `/` route by portal order (this modal is on top)
  // rather than registration order, so it claims `/` over the Settings search.
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
</script>

<Modal
  kind="dialog"
  {open}
  {onClosed}
  eyebrow="Keyboard"
  title="Shortcuts"
  onDismiss={onClose}
  onOpenAutoFocus={focusDialog}
  contentClass={compact ? "shortcuts-content shortcuts-compact" : "shortcuts-content"}
>
  {#snippet description()}
    Search by action or keys; click a row to run it.
  {/snippet}

  <div class="help">
    <!-- The search field carries a trailing `/` Kbd cap (EXC-835): `/` focuses it
         (the input is not autofocused). The cap renders through the same shadcn
         Kbd as every other cap, in an InputGroup inline-end addon (EXC-1113) that
         gives it a track of its own beside the control. -->
    <InputGroup.Root class="help-search">
      <InputGroup.Input
        type="text"
        placeholder="Search shortcuts…"
        aria-label="Search shortcuts"
        bind:value={query}
        bind:ref={searchInput}
      />
      <!-- Decorative hint only; the field's aria-label already names it. The addon
           carries the aria-hidden rather than the cap, since an addon is a
           role="group" and one holding nothing announceable reads as an empty group. -->
      <InputGroup.Addon align="inline-end" aria-hidden="true">
        <Kbd>/</Kbd>
      </InputGroup.Addon>
    </InputGroup.Root>

    {#if groups.length === 0}
      <p class="help-empty">No shortcuts match your search.</p>
    {:else}
      <div class="help-groups" class:is-compact={compact}>
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
     chords, so its caps sit side by side. keyCaps resolves the glyph strings;
     isKbdKey routes the known keys (letters, shift) through the typed KbdCap
     renderer — so the shift key draws the global icon — while the rest (⌘, Esc,
     ↵) render as their own glyph text. -->
{#snippet caps(entry: ShortcutEntry)}
  <KbdGroup class="help-caps">
    {#each keyCaps(entry.keys) as chordCaps}
      {#each chordCaps as cap}<Kbd
          >{#if isKbdKey(cap)}<KbdCap key={cap} />{:else}{cap}{/if}</Kbd
        >{/each}
    {/each}
  </KbdGroup>
{/snippet}

<style>
  /* Cap the dialog to a roomy measure that fits the multi-column keymap (EXC-835)
     — the shadcn default widens to calc(100% - 2rem), and 56rem gives the ~3
     columns below room to breathe without running edge to edge. The class rides
     the portalled dialog content (no scope hash → :global); caret's unlayered
     component CSS beats shadcn's layered max-w-[calc(100%-2rem)] utility, and
     min() keeps it inside a narrow viewport. Authored here as caret CSS, not a
     Tailwind class: app.css scans only lib/components/ui, so a utility in this
     chrome file would never be emitted. */
  :global(.shortcuts-content) {
    max-width: min(56rem, calc(100vw - 2rem));
  }
  /* A scoped help of a section or two (over Settings, EXC-849) drops to one column
     below, so it wants a narrower measure than the multi-column keymap — the wide cap
     would strand the lone column in empty space. Later, equally-specific single :global
     class, so source order lets it win over .shortcuts-content (both unlayered caret CSS
     beating shadcn's layered utility). */
  :global(.shortcuts-compact) {
    max-width: min(28rem, calc(100vw - 2rem));
  }
  .help {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  /* The field recesses off the dialog's --paper-raised, the step every other recessed
     control in the chrome takes. The group's own fill is dark-scheme only, so without
     this the field would sit flush on the panel with just its hairline — the same
     reason command-input.svelte paints its own surface rather than taking the stock. */
  .help :global(.help-search) {
    background: var(--paper);
  }
  /* The grouped sections flow across up to three newspaper columns (EXC-835) so
     the whole keymap fits at a glance; the count drops as the viewport narrows.
     The dialog content still scrolls as a whole (shadcn dialog-content is
     max-height + overflow-y-auto) if the keymap ever outgrows the height. */
  .help-groups {
    columns: 16rem 3;
    column-gap: 1.5rem;
  }
  /* Compact keymaps (fitsSingleColumn) collapse to one column — the newspaper layout
     would leave a lone section stranded beside empty columns. Two-class selector, so it
     wins over .help-groups regardless of order. */
  .help-groups.is-compact {
    column-count: 1;
  }
  .help-group {
    /* Keep each group whole — never split its rows across a column boundary. */
    break-inside: avoid;
    /* Vertical rhythm between stacked groups (column-gap is horizontal only). */
    margin-bottom: 1rem;
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
    transition: background-color var(--dur-micro) var(--ease-out);
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
