<script lang="ts">
  import { isCancelKey } from "../lib/keys.ts";
  import { type ThemeId, THEME_IDS, THEMES } from "../lib/theme.ts";
  import Icon from "./Icon.svelte";

  interface Props {
    /** The theme currently applied — the dropdown's selected value. */
    current: ThemeId;
    /** Choose a theme. The host applies it immediately (with the wipe), so the
     * whole UI — this dialog included — retints in place; there is no Save. */
    onSelect: (id: ThemeId) => void;
    /** Dismiss the dialog. */
    onClose: () => void;
  }
  let { current, onSelect, onClose }: Props = $props();

  let dialog = $state<HTMLDivElement | undefined>();
  // Focus the panel so Escape lands here, not on the gear button behind it.
  $effect(() => {
    dialog?.focus();
  });

  function onKey(e: KeyboardEvent) {
    if (isCancelKey(e)) onClose();
  }

  function onPick(e: Event) {
    onSelect((e.currentTarget as HTMLSelectElement).value as ThemeId);
  }
</script>

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div
    class="dialog"
    bind:this={dialog}
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    tabindex="-1"
    onkeydown={onKey}
  >
    <header>
      <span class="eyebrow">Appearance</span>
      <h2>Settings</h2>
    </header>

    <div class="field">
      <label for="theme-select">Theme</label>
      <div class="select-wrap">
        <select id="theme-select" class="theme-select" value={current} onchange={onPick}>
          {#each THEME_IDS as id (id)}
            <option value={id}>{THEMES[id].label}</option>
          {/each}
        </select>
        <span class="chevron" aria-hidden="true"><Icon name="chevron-down" size={14} /></span>
      </div>
      <p class="hint">Switching the theme restyles the whole interface.</p>
    </div>

    <footer>
      <button class="done" onclick={onClose}>Done</button>
    </footer>
  </div>
</div>

<style>
  /* Mirrors the UnsentCommentsDialog scrim/panel idiom so caret's modals read as
     one system: blurred sunk scrim, raised-paper panel, the shared enter motion. */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: color-mix(in srgb, var(--paper-sunk) 70%, rgba(0, 0, 0, 0.4));
    backdrop-filter: blur(3px);
    display: grid;
    place-items: center;
    padding: 2rem;
    animation: fade var(--dur-fast) var(--ease-out);
  }
  .dialog {
    width: min(420px, 100%);
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    padding: 1.5rem;
    animation: rise var(--dur-base) var(--ease-out);
  }
  .dialog:focus {
    outline: none;
  }
  header {
    margin-bottom: 1.25rem;
  }
  .eyebrow {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  h2 {
    font-weight: 500;
    /* Display one-off: the dialog title sits above the chrome type scale, matching
       the other caret dialogs. */
    font-size: 1.35rem;
    margin: 0.25rem 0 0;
    color: var(--ink);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  /* The dropdown wears caret's own chrome (appearance:none) with the vendored
     chevron over it, so it matches the switcher and menus rather than showing a
     stock OS control. */
  .select-wrap {
    position: relative;
    display: flex;
  }
  .theme-select {
    appearance: none;
    width: 100%;
    background: var(--paper-sunk);
    color: var(--ink);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    padding: 0.5rem 2rem 0.5rem 0.75rem;
    font-size: var(--text-base);
    font-weight: 500;
    transition: border-color var(--dur-fast) var(--ease-out);
  }
  .theme-select:hover {
    border-color: var(--accent);
  }
  .chevron {
    position: absolute;
    right: 0.6rem;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    pointer-events: none;
    color: var(--ink-faint);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    color: var(--ink-faint);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 1.5rem;
  }
  /* Quiet dismiss — the theme is already applied live, so Done just closes; it
     warms to the ink→accent treatment the other dialogs' primary button uses. */
  .done {
    border-radius: var(--radius);
    font-size: var(--text-base);
    font-weight: 600;
    padding: 0.5rem 1.1rem;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .done:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.99);
    }
  }
</style>
