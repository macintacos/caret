// The shortcut registry: the seam every keyboard shortcut is declared into and
// the source the help modal reads (EXC-786, foundation of the EXC-785 vim tree).
// Node-free and framework-agnostic — the DOM lives in the dispatcher, the events
// in the matcher; this file is just data plus a small register/list store.

import { uiLog } from "$lib/log.ts";

/** A modifier a chord can require. `mod` = ⌘ on macOS, Ctrl elsewhere — the same
 * platform-agnostic rule `keys.ts`'s `isSubmitChord` uses (`metaKey || ctrlKey`). */
export type Mod = "mod" | "ctrl" | "meta" | "shift" | "alt";

/** One key press: a `KeyboardEvent.key` value plus any required modifiers. `key`
 * is matched case-sensitively, so shifted characters (`V`, `G`, `?`) match the
 * shifted `key` directly. `cap` overrides the display glyph(s); when absent the
 * caps derive from `mods` + `key`. */
export interface Chord {
  key: string;
  mods?: Mod[];
  cap?: string | string[];
}

/** A shortcut's keys: one chord, or a two-key sequence (`gg`, `]]`, `[[`). */
export type KeySpec = Chord[];

/** The canonical shortcut groups (EXC-785's table). `editor` holds the existing
 * composer chords, surfaced read-only in the help modal. */
export type ShortcutGroup = "motion" | "commenting" | "actions" | "help" | "editor";

/** A registry entry. `run` is optional: an entry without it is display-only —
 * listed for the help modal but never dispatched (the existing editor chords,
 * which the composer already owns on focus). `enabled` gates dispatch and lets
 * the modal grey out entries. */
export interface ShortcutEntry {
  id: string;
  keys: KeySpec;
  group: ShortcutGroup;
  label: string;
  run?: () => void;
  enabled?: () => boolean;
}

export interface ShortcutRegistry {
  /** Register an entry (replacing any prior entry with the same id). Returns an
   * unregister function. */
  register(entry: ShortcutEntry): () => void;
  /** Every registered entry, in registration order. */
  list(): ShortcutEntry[];
}

function chordSignature(c: Chord): string {
  const mods = [...(c.mods ?? [])].sort().join("+");
  return mods ? `${mods}+${c.key}` : c.key;
}

/** A stable, order-normalized signature for a key spec — equal specs share one
 * string. Used for collision detection and by the canonical-keymap uniqueness
 * check. */
export function specSignature(spec: KeySpec): string {
  return spec.map(chordSignature).join(" ");
}

const MOD_CAP: Record<Mod, string> = {
  mod: "⌘", // platform glyph resolved below for the bare "mod" case
  meta: "⌘",
  ctrl: "Ctrl",
  shift: "⇧",
  alt: "⌥",
};

const KEY_CAP: Record<string, string> = {
  Enter: "↵",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  " ": "Space",
};

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform || navigator.userAgent || "");
}

function modCap(mod: Mod): string {
  if (mod === "mod") return isMac() ? "⌘" : "Ctrl";
  if (mod === "alt") return isMac() ? "⌥" : "Alt";
  return MOD_CAP[mod];
}

/** Render a key spec to display caps: one cap-list per chord, ready to map onto
 * `KbdGroup` → `Kbd`. An explicit `cap` on a chord wins; otherwise the caps are
 * its modifier glyphs followed by the key glyph. The help modal (EXC-787) styles
 * the final look; this only fixes the glyph strings. */
export function keyCaps(spec: KeySpec): string[][] {
  return spec.map((c) => {
    if (c.cap !== undefined) return Array.isArray(c.cap) ? c.cap : [c.cap];
    return [...(c.mods ?? []).map(modCap), KEY_CAP[c.key] ?? c.key];
  });
}

export function createShortcutRegistry(): ShortcutRegistry {
  const entries = new Map<string, ShortcutEntry>();

  return {
    register(entry) {
      // A collision is two *dispatchable* entries fighting for one key spec —
      // the bug this warns about (a display-only entry legitimately shares a key
      // with an action, e.g. the editor Esc vs. a future global-clear Esc). This
      // is the live guard behind "downstream tickets claim non-colliding keys".
      if (entry.run) {
        const sig = specSignature(entry.keys);
        for (const other of entries.values()) {
          if (other.id !== entry.id && other.run && specSignature(other.keys) === sig) {
            uiLog.warn("ui", "shortcut key collision", { id: entry.id, keys: sig, with: other.id });
            break;
          }
        }
      }
      entries.set(entry.id, entry);
      return () => {
        entries.delete(entry.id);
      };
    },
    list() {
      return [...entries.values()];
    },
  };
}
