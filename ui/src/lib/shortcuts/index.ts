import { createShortcutRegistry } from "$lib/shortcuts/registry.ts";

export * from "$lib/shortcuts/caps.ts";
export * from "$lib/shortcuts/dispatcher.ts";
export * from "$lib/shortcuts/keymap.ts";
export * from "$lib/shortcuts/match.ts";
export * from "$lib/shortcuts/registry.ts";

/** The app-wide shortcut registry singleton. Downstream components register
 * their shortcuts into this instance; App.svelte wires the dispatcher to it and
 * registers the read-only editor chords. A global keyboard registry is genuinely
 * app-wide service state, so it lives as a module singleton — the factory,
 * `createShortcutRegistry`, stays exported for isolated unit tests. */
export const shortcuts = createShortcutRegistry();
