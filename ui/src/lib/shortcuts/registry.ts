// The shortcut registry: the seam every keyboard shortcut is declared into and
// the source the help modal reads (EXC-786, foundation of the EXC-785 vim tree).
// Node-free and framework-agnostic — the DOM lives in the dispatcher, the events
// in the matcher; this file is just data plus a small register/list store.

import { uiLog } from "$lib/log.ts";

/** A command modifier a chord can require. `mod` = ⌘ on macOS, Ctrl elsewhere —
 * the same platform-agnostic rule `keys.ts`'s `isSubmitChord` uses
 * (`metaKey || ctrlKey`). Shift is deliberately absent: a shifted key is matched
 * by its shifted `key` value (`V`, `?`, `G`), never a modifier flag — so the
 * matcher and the caps stay in agreement about what a chord fires on. */
export type Mod = "mod" | "ctrl" | "meta" | "alt";

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
 * composer chords, surfaced read-only in the help modal. `settings` holds the
 * Settings modal's own affordances (EXC-849), listed only in the scoped help. */
export type ShortcutGroup = "motion" | "commenting" | "actions" | "settings" | "help" | "editor";

/** The view a shortcut is active in (EXC-849). Absent on an entry = the base
 * `"review"` surface (the plan-review view). `"global"` = active in every scope
 * (the `?` help toggle). A named modal scope (`"settings"`) is active only while
 * that modal owns the view. The dispatcher and the help modal both filter by the
 * active scope (see shortcuts/scope.ts), so an open modal suppresses the review
 * shortcuts and the help lists only the shortcuts valid in the current view. */
export type ShortcutScope = "global" | "review" | "settings";

/** A registry entry. `run` is optional: an entry without it is display-only —
 * listed for the help modal but never dispatched (the existing editor chords,
 * which the composer already owns on focus). `enabled` gates dispatch and lets
 * the modal grey out entries. `scope` gates by the active view (see ShortcutScope);
 * absent = the base review surface. */
export interface ShortcutEntry {
  id: string;
  keys: KeySpec;
  group: ShortcutGroup;
  label: string;
  run?: () => void;
  enabled?: () => boolean;
  scope?: ShortcutScope;
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
  switch (mod) {
    case "mod":
      return isMac() ? "⌘" : "Ctrl";
    case "meta":
      return "⌘";
    case "ctrl":
      return "Ctrl";
    case "alt":
      return isMac() ? "⌥" : "Alt";
  }
}

/** The display caps for a bare key glyph. A single A–Z letter renders as its
 * physical cap: a lowercase (unshifted) key as its bare capital (`j` → `J`), an
 * uppercase (shifted) key as the shift token plus the capital (`V` →
 * `["shift", "V"]`) — "shift" draws the global shift icon (caps.ts), so the case
 * of `key` is what encodes shift. Every other key keeps its literal glyph, via
 * KEY_CAP for the named specials (`Enter` → `↵`). */
function capsForKey(key: string): string[] {
  if (/^[a-z]$/.test(key)) return [key.toUpperCase()];
  if (/^[A-Z]$/.test(key)) return ["shift", key];
  return [KEY_CAP[key] ?? key];
}

/** Render a key spec to display caps: one cap-list per chord, ready to map onto
 * `KbdGroup` → `Kbd`. An explicit `cap` on a chord wins; otherwise the caps are
 * its modifier glyphs followed by the key's own caps (see `capsForKey`). The help
 * modal (EXC-787) styles the final look; this only fixes the glyph strings. */
export function keyCaps(spec: KeySpec): string[][] {
  return spec.map((c) => {
    if (c.cap !== undefined) return Array.isArray(c.cap) ? c.cap : [c.cap];
    return [...(c.mods ?? []).map(modCap), ...capsForKey(c.key)];
  });
}

/** Each command modifier in WAI-ARIA `aria-keyshortcuts` vocabulary. `mod` is
 * platform-dispatched at match time (⌘ on macOS, Ctrl elsewhere), so a static
 * attribute advertises BOTH — the same `Meta+Enter Control+Enter` the buttons used
 * to hand-write — rather than committing to one platform. */
const ARIA_MOD: Record<Mod, readonly string[]> = {
  mod: ["Meta", "Control"],
  meta: ["Meta"],
  ctrl: ["Control"],
  alt: ["Alt"],
};

/** Render a key spec to its `aria-keyshortcuts` attribute string (WAI-ARIA:
 * `+`-joined tokens, space-separated alternatives), derived from the SAME semantic
 * `key` + `mods` as `keyCaps` — so a button's advertised shortcut cannot drift from
 * the key the dispatcher fires on. A shifted letter (uppercase `key`, e.g. `C`/`V`)
 * surfaces its implicit `Shift`; `mod` expands to its two platform alternatives. The
 * display-only `cap` glyph (⌘↵, Esc) is intentionally ignored — the semantic key and
 * mods are the source. ARIA has no key-sequence syntax, so a two-key spec (`gg`) is
 * best-effort space-joined; no sequence drives an aria-keyshortcuts button. */
export function ariaKeyshortcuts(spec: KeySpec): string {
  return spec
    .map((c) => {
      // Each mod maps to one or more ARIA names (mod → Meta|Control); the cartesian
      // product across mods yields every alternative combination (one, in practice).
      const combos = (c.mods ?? []).reduce<string[][]>(
        (acc, m) => acc.flatMap((combo) => ARIA_MOD[m].map((name) => [...combo, name])),
        [[]],
      );
      const shift = /^[A-Z]$/.test(c.key) ? ["Shift"] : [];
      return combos.map((combo) => [...combo, ...shift, c.key].join("+")).join(" ");
    })
    .join(" ");
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
